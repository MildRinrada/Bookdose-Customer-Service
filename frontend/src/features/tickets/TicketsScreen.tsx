'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { FilterLink, FilterSelect, SearchInput } from '@/components/ui/filters';
import { usePager } from '@/components/ui/Pager';
import { useToast } from '@/components/ui/Toast';
import { priorityLabels, statusLabels } from '@/lib/labels';
import { useInvalidate } from '@/lib/query';
import { useMemberName, useStaffTickets, useStaffUser, useWork } from '@/lib/session';
import { useUiState } from '@/lib/ui-state';
import { exportTickets, TICKET_PREFIXES, updateTicket } from './api';
import { NewTicketButton } from './components/NewTicket';
import { DENSITY_KEY, TicketTable, type TicketSelection } from './components/TicketTable';
import { useDownloadTicketsCSV } from './csv';
import { densityLabels, FILTER_KEYS, inScope, matchesTicketFilters, ticketScopes, ticketsHref, type TicketFilter } from './labels';
import type { TicketChanges, TicketRow } from './types';

/* The case list (the old ticketsPage): search, status and priority filters, quick scopes with counts, a customer
   filter from the address, row density, selection with bulk assign / close / export, and the full CSV export.
   Filters live in the address (/tickets?q=&status=&priority=&contact=&filter=) so a filtered list can be shared;
   the global search in the top bar opens /tickets?q=<text>. Markup: pages/tickets/tickets, ticket-toolbar. */

const toArray = (value: string | null) => value ?? '';

export function TicketsScreen() {
  const params = useSearchParams();
  const me = useStaffUser().id;
  const work = useWork();
  const memberName = useMemberName();
  const toast = useToast();
  const refresh = useInvalidate();
  const saveCSV = useDownloadTicketsCSV();
  const tickets = useStaffTickets();
  const all = (tickets.data?.tickets ?? []) as TicketRow[];

  const fromAddress: TicketFilter = Object.fromEntries(FILTER_KEYS.map((key) => [key, toArray(params.get(key))]));
  // The search box answers every key at once; the address follows it.
  const addressQ = fromAddress.q ?? '';
  const [q, setQ] = useState(addressQ);
  // A new ?q= from elsewhere (the global search, a link) replaces what is typed.
  const [seenQ, setSeenQ] = useState(addressQ);
  if (seenQ !== addressQ) {
    setSeenQ(addressQ);
    setQ(addressQ);
  }
  const filter: TicketFilter = { ...fromAddress, q };

  const [selectedIds, setSelected] = useUiState<string[]>('tickets:selected', []);
  const [density, setDensity] = useUiState(DENSITY_KEY, 'comfortable');
  const [bulkBusy, setBulkBusy] = useState(false);

  const matching = all.filter((t) => matchesTicketFilters(t, filter));
  const visible = matching.filter((t) => inScope(t, filter.filter, me));
  const pager = usePager('tickets', visible, { size: 25 });

  // Selected cases that the filters hide are let go (the old refreshTicketFilter).
  const visibleKey = visible.map((t) => t.id).join(',');
  useEffect(() => {
    if (!tickets.data) return;
    const ids = new Set(visibleKey ? visibleKey.split(',') : []);
    setSelected((s) => (s.every((id) => ids.has(id)) ? s : s.filter((id) => ids.has(id))));
  }, [visibleKey, tickets.data, setSelected]);

  if (tickets.error && !tickets.data) return <ErrorState error={tickets.error} onRetry={() => void tickets.refetch()} />;
  if (!tickets.data) return <PageLoading />;

  const selected = new Set(selectedIds);
  const count = selected.size;
  const picked = all.filter((t) => selected.has(t.id));

  const setFilter = (key: keyof TicketFilter, value: string) => {
    if (key === 'q') setQ(value);
    // The native history API keeps Next's router in step without asking the server for the page again.
    window.history.replaceState(null, '', ticketsHref({ ...filter, [key]: value }));
    pager.setPage(1);
  };

  const selection: TicketSelection = {
    selected,
    onToggle: (id, checked) => setSelected((s) => (checked ? [...new Set([...s, id])] : s.filter((x) => x !== id))),
    all: (() => {
      const n = visible.filter((t) => selected.has(t.id)).length;
      return n > 0 && n === visible.length ? 'all' : n > 0 ? 'some' : 'none';
    })(),
    onToggleAll: (checked) => {
      const ids = visible.map((t) => t.id);
      setSelected((s) => (checked ? [...new Set([...s, ...ids])] : s.filter((id) => !ids.includes(id))));
    },
  };

  // One PATCH per case that would change; the ones that failed stay selected and the first reason is shown.
  const bulkUpdate = async (changes: TicketChanges, message: string) => {
    const failed: Array<{ t: TicketRow; error: unknown }> = [];
    const pending = picked.filter((t) =>
      Object.entries(changes).some(([key, value]) => String((t as Record<string, unknown>)[key] || '') !== (value || '')),
    );
    setBulkBusy(true);
    try {
      for (const t of pending) {
        try {
          await updateTicket(t.id, changes);
        } catch (error) {
          failed.push({ t, error });
        }
      }
    } finally {
      await refresh(...TICKET_PREFIXES);
      setSelected(failed.map((f) => f.t.id));
      setBulkBusy(false);
    }
    if (failed.length) {
      const reason = failed[0].error instanceof Error ? failed[0].error.message : String(failed[0].error);
      throw new Error(`${message} ${pending.length - failed.length} จาก ${pending.length} เคส · BD-${failed[0].t.number}: ${reason}`);
    }
    toast(`${message} · ${picked.length} เคส`);
  };
  const bulk = (changes: TicketChanges, message: string) => void bulkUpdate(changes, message).catch((error: Error) => toast(error.message, true));

  // An assignee must belong to the case's team, so members are offered only when every selected case is in one team.
  const teams = new Set(picked.map((t) => t.team_id));
  const bulkMembers = teams.size === 1 ? work.members.filter((m) => m.active && teams.has(m.team_id)) : [];

  const filtered = Boolean(filter.q || filter.status || filter.priority || filter.contact || (filter.filter && filter.filter !== 'all'));
  const contactName = filter.contact ? all.find((t) => t.contact_id === filter.contact)?.contact_name || 'ที่เลือก' : '';
  const currentScope = filter.filter || 'all';

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>เคสบริการ</h1>
          <p>ติดตาม จัดลำดับ และมอบหมายทุกเรื่องให้ทีมของคุณ</p>
        </div>
        <div className="flex">
          <button
            type="button"
            className="btn subtle"
            onClick={() =>
              void exportTickets()
                .then(() => toast('ดาวน์โหลดรายงานเคสทั้งหมดตามสิทธิ์แล้ว'))
                .catch((error: Error) => toast(error.message, true))
            }
          >
            <Icon name="download" />
            ส่งออก CSV
          </button>
          <NewTicketButton />
        </div>
      </div>
      <section className="card">
        <div className="filters">
          <SearchInput id="ticket-search" label="ค้นหาเคส" placeholder="ค้นหาหมายเลขเคส เรื่อง หรือลูกค้า" value={q} onChange={(value) => setFilter('q', value)} />
          <FilterSelect
            id="ticket-status"
            label="กรองสถานะ"
            any="ทุกสถานะ"
            value={filter.status ?? ''}
            options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))}
            onChange={(value) => setFilter('status', value)}
          />
          <FilterSelect
            id="ticket-priority"
            label="กรองความเร่งด่วน"
            any="ทุกความเร่งด่วน"
            value={filter.priority ?? ''}
            options={Object.entries(priorityLabels).map(([value, label]) => ({ value, label }))}
            onChange={(value) => setFilter('priority', value)}
          />
        </div>
        <div className="filters ticket-toolbar" data-filter-bar="" hidden={count > 0}>
          <div className="filter-chips" role="group" aria-label="ตัวกรองด่วน">
            {Object.entries(ticketScopes).map(([scope, label]) => (
              <FilterLink
                key={scope}
                href={ticketsHref({ ...filter, filter: scope === 'all' ? '' : scope })}
                value={scope}
                label={label}
                active={currentScope === scope}
                count={matching.filter((t) => inScope(t, scope, me)).length}
              />
            ))}
          </div>
          {contactName && (
            <Link className="filter-pill active contact-chip" href="/tickets" aria-current="true" title="ล้างตัวกรองลูกค้า">
              ลูกค้า: {contactName} ✕
            </Link>
          )}
          {filtered && (
            <Link className="btn subtle" href="/tickets">
              ล้างตัวกรองทั้งหมด
            </Link>
          )}
          <div className="display-options">
            <span id="ticket-count">{visible.length} เคส</span>
            <label>
              ระยะห่างแถว{' '}
              <select data-density="" aria-label="ระยะห่างแถว" value={density} onChange={(e) => setDensity(e.target.value)}>
                {Object.entries(densityLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="filters bulk-bar" data-bulk-bar="" role="toolbar" aria-label="จัดการเคสที่เลือก" hidden={!count}>
          <strong data-selection-count="">เลือก {count} เคส</strong>
          <select
            className="quick-select"
            data-bulk-assign=""
            aria-label="เปลี่ยนผู้รับผิดชอบพร้อมกัน"
            value=""
            disabled={bulkBusy}
            onChange={(e) => {
              const value = e.target.value === 'none' ? '' : e.target.value;
              if (e.target.value) bulk({ assignee_id: value }, value ? `มอบหมายให้ ${memberName(value)} แล้ว` : 'ยกเลิกการมอบหมายแล้ว');
            }}
          >
            <option value="">{teams.size > 1 ? 'มอบหมาย: เลือกเคสจากทีมเดียวกัน' : 'เปลี่ยนผู้รับผิดชอบ…'}</option>
            <option value="none">ยกเลิกการมอบหมาย</option>
            {bulkMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn sm" disabled={bulkBusy} onClick={() => bulk({ status: 'closed' }, 'ปิดเคสแล้ว')}>
            <Icon name="checkCircle" />
            ปิดเคสพร้อมกัน
          </button>
          <button
            type="button"
            className="btn sm"
            disabled={bulkBusy}
            onClick={() => {
              const records = visible.filter((t) => selected.has(t.id));
              if (!records.length) toast('กรุณาเลือกเคสที่ต้องการส่งออก', true);
              else saveCSV(records, 'selected-tickets.csv');
            }}
          >
            <Icon name="download" />
            ส่งออกเคสที่เลือก
          </button>
          <button
            type="button"
            className="btn subtle"
            disabled={bulkBusy}
            onClick={() => {
              setSelected([]);
              requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-select-all]')?.focus());
            }}
          >
            ยกเลิกการเลือก
          </button>
        </div>
        <div id="ticket-table">
          <TicketTable tickets={visible} selection={selection} />
        </div>
        <div className="table-footer">
          <span>ข้อมูลตามองค์กรและทีมที่คุณมีสิทธิ์</span>
        </div>
      </section>
    </>
  );
}
