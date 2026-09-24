'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Avatar, Badge, EmptyState, PriorityTag } from '@/components/ui/display';
import { MoodTag } from '@/components/ui/MoodTag';
import { Pager, usePager } from '@/components/ui/Pager';
import { useToast } from '@/components/ui/Toast';
import { date, formatDuration, isDone } from '@/lib/format';
import { escalationReasons, statusLabels } from '@/lib/labels';
import { useInvalidate } from '@/lib/query';
import { useMemberName, useStaffUser, useWork } from '@/lib/session';
import { useUiState } from '@/lib/ui-state';
import { claimSound } from '@/features/staff-account/celebrate';
import { TICKET_PREFIXES, updateTicket } from '../api';
import { isSnoozed, lateBy, snoozeUntilText } from '../labels';
import type { TicketChanges, TicketRow } from '../types';
import { SnoozeChip, useWakeTicket } from './SnoozeCard';
import { useTicketPreview } from './TicketPreview';

/* The case table (the old ticketTable): the full list pages through 25 at a time with row selection and quick
   actions shown on hover or focus; `compact` is the overview's short list whose actions sit in a ⋯ popover menu.
   Markup: pages/tickets/ticket-table, ticket-row, ticket-quick-actions. */

export type TicketSelection = {
  selected: ReadonlySet<string>;
  onToggle: (id: string, checked: boolean) => void;
  /** How many of the listed (filtered) cases are selected, for the header box. */
  all: 'all' | 'some' | 'none';
  onToggleAll: (checked: boolean) => void;
};

export const DENSITY_KEY = 'tickets:density';

export function TicketTable({
  tickets,
  compact = false,
  selection,
}: {
  tickets: TicketRow[];
  /** The overview's short list: no pager, no selection, actions in a popover. */
  compact?: boolean;
  /** The cases screen: a check box per row and one for all listed cases. */
  selection?: TicketSelection;
}) {
  const [density] = useUiState(DENSITY_KEY, 'comfortable');
  if (!tickets.length) return <EmptyState title="ยังไม่มีเคสในรายการนี้" description="ลองล้างตัวกรองหรือเปิดเคสใหม่" icon="ticket" />;
  if (compact) return <TableView rows={tickets} density={density} compact />;
  return <PagedTable tickets={tickets} density={density} selection={selection} />;
}

function PagedTable({ tickets, density, selection }: { tickets: TicketRow[]; density: string; selection?: TicketSelection }) {
  const slice = usePager('tickets', tickets, { size: 25 });
  return (
    <>
      <TableView rows={slice.shown} density={density} selection={selection} />
      <Pager slice={slice} unit="เคส" />
    </>
  );
}

function SelectAll({ selection }: { selection: TicketSelection }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = selection.all === 'some';
  }, [selection.all]);
  return (
    <input
      ref={ref}
      type="checkbox"
      data-select-all=""
      aria-label="เลือกเคสที่แสดงทั้งหมด"
      checked={selection.all === 'all'}
      onChange={(e) => selection.onToggleAll(e.target.checked)}
    />
  );
}

function TableView({ rows, density, compact = false, selection }: { rows: TicketRow[]; density: string; compact?: boolean; selection?: TicketSelection }) {
  const selectable = !compact && Boolean(selection);
  // A menu placed for the old window size would sit in the wrong place: close it instead.
  useEffect(() => {
    if (!compact) return;
    const close = () => document.querySelectorAll<HTMLElement>('.dashboard-quick-menu:popover-open').forEach((menu) => menu.hidePopover());
    window.addEventListener('resize', close);
    return () => window.removeEventListener('resize', close);
  }, [compact]);
  return (
    <div className={`table-scroll density-${density}${compact ? ' dashboard-table' : ' ticket-list'}`}>
      <table>
        {compact ? (
          <colgroup>
            <col className="col-subject" />
            <col className="col-customer" />
            <col className="col-status" />
            <col className="col-priority" />
            <col className="col-actions" />
          </colgroup>
        ) : (
          <colgroup>
            {selectable && <col className="col-check" />}
            <col className="col-subject" />
            <col className="col-customer" />
            <col className="col-status" />
            <col className="col-priority" />
            <col className="col-assignee" />
            <col className="col-updated" />
          </colgroup>
        )}
        <thead>
          <tr>
            {selectable && selection && (
              <th>
                <SelectAll selection={selection} />
              </th>
            )}
            <th>เรื่อง / หมายเลขเคส</th>
            <th className="customer-col">ลูกค้า</th>
            <th>สถานะ</th>
            <th>ความเร่งด่วน</th>
            {compact ? (
              <th>
                <span className="sr-only">จัดการเคส</span>
              </th>
            ) : (
              <>
                <th>ผู้รับผิดชอบ</th>
                <th>อัปเดต / SLA</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => (
            <TicketRowView key={t.id} t={t} index={i} compact={compact} selection={selectable ? selection : undefined} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TicketRowView({ t, index, compact, selection }: { t: TicketRow; index: number; compact: boolean; selection?: TicketSelection }) {
  const memberName = useMemberName();
  const late = lateBy(t);
  const escalated = t.escalated_at && !isDone(t) ? escalationReasons[t.escalation_reason ?? ''] || 'ยกระดับแล้ว' : '';
  // Not late yet, but the queue in front of it will not reach it in time at the team's pace now.
  const forecast = !late && !isDone(t) ? t.forecast : null;
  const assignee = memberName(t.assignee_id);
  const paused = isSnoozed(t);
  return (
    <tr className={paused ? 'snoozed-row' : undefined}>
      {selection && (
        <td>
          <input
            type="checkbox"
            data-ticket-select={t.id}
            checked={selection.selected.has(t.id)}
            onChange={(e) => selection.onToggle(t.id, e.target.checked)}
            aria-label={`เลือกเคส BD-${t.number}`}
          />
        </td>
      )}
      <td>
        <Link className="ticket-title" href={`/tickets/${t.id}`} title={t.subject}>
          {t.subject}
        </Link>
        <span className="ticket-id">
          BD-{t.number} · {t.category}
        </span>
        {escalated && (
          <span className="badge escalated" title={`ยกระดับอัตโนมัติ: ${escalated}`}>
            <Icon name="bolt" />
            ยกระดับ
          </span>
        )}
        {forecast && (
          <span
            className="badge forecast-tag"
            title={`คาดว่า${forecast.kind === 'response' ? 'ตอบครั้งแรก' : 'ปิดเคส'}ช้ากว่ากำหนดราว ${formatDuration(forecast.late_minutes)} · คิวก่อนหน้า ${forecast.ahead} เคส · กำหนด ${date(forecast.due, true)}`}
          >
            <Icon name="clock" />
            น่าจะเกิน · ช้าราว {formatDuration(forecast.late_minutes)}
          </span>
        )}
        {!isDone(t) && <MoodTag mood={t} className="ticket-mood" />}
        {paused && <SnoozeChip until={t.snoozed_until as string} note={t.snooze_note} />}
      </td>
      <td className="customer-col">
        <div className="flex">
          <Avatar name={t.contact_name} index={index} />
          <div>
            <div className="customer-name" title={t.contact_name}>
              {t.contact_name}
            </div>
            <div className="muted">{t.company || '-'}</div>
          </div>
        </div>
      </td>
      <td>
        <Badge status={t.status} />
      </td>
      <td>
        <PriorityTag value={t.priority} />
      </td>
      {compact ? (
        <td className="dashboard-action-cell">
          <ActionMenu t={t} />
        </td>
      ) : (
        <>
          <td className="assignee-cell" title={assignee}>
            {assignee}
          </td>
          <td className="quick-cell">
            {late ? (
              <span className="sla-late" title={`เกิน SLA มาแล้ว ${late}`}>
                <Icon name="clock" />+{late}
                <span className="sr-only"> เกิน SLA</span>
              </span>
            ) : (
              date(t.updated_at)
            )}
            <QuickActions t={t} />
          </td>
        </>
      )}
    </tr>
  );
}

/** Where the popover goes: under the ⋯ button (right edges aligned), or above it when there is no room below,
    always inside the window. Set through the CSSOM, which the CSP allows (no style attribute in the markup). */
function placeMenu(button: HTMLElement, menu: HTMLElement) {
  const anchor = button.getBoundingClientRect();
  const box = menu.getBoundingClientRect();
  const gap = 6;
  const edge = 12;
  menu.style.left = `${Math.max(edge, Math.min(anchor.right - box.width, innerWidth - box.width - edge))}px`;
  const below = anchor.bottom + gap;
  menu.style.top = `${Math.max(edge, Math.min(below + box.height <= innerHeight - edge ? below : anchor.top - box.height - gap, innerHeight - box.height - edge))}px`;
}

/** The overview's ⋯ button and its native popover (click-away and Escape close it without covering the row). */
function ActionMenu({ t }: { t: TicketRow }) {
  const toggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = `dashboard-actions-${t.id}`;
  useEffect(() => {
    const node = menu.current;
    if (!node) return;
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === 'open' && toggle.current) placeMenu(toggle.current, node);
    };
    node.addEventListener('toggle', onToggle);
    return () => node.removeEventListener('toggle', onToggle);
  }, []);
  return (
    <>
      <button
        ref={toggle}
        type="button"
        className="icon-btn dashboard-action-toggle"
        popoverTarget={id}
        aria-label={`จัดการเคส BD-${t.number}`}
        title="จัดการเคส"
      >
        <span aria-hidden="true">⋯</span>
      </button>
      <div ref={menu} id={id} className="dashboard-quick-menu" popover="auto" aria-label={`จัดการเคส BD-${t.number}`}>
        <QuickActions
          t={t}
          menu
          onPreview={() => menu.current?.hidePopover()}
          // The old overview was drawn again after a change, closing the menu; focus returns to its button.
          onDone={() => {
            if (menu.current?.matches(':popover-open')) menu.current.hidePopover();
            toggle.current?.focus();
          }}
        />
      </div>
    </>
  );
}

/** Quick view, claim, status and assignee without opening the case. Every control of the row is disabled while a
    change is sent; afterwards the list is read again and focus returns to the control that was used. */
function QuickActions({ t, menu = false, onPreview, onDone }: { t: TicketRow; menu?: boolean; onPreview?: () => void; onDone?: () => void }) {
  const work = useWork();
  const me = useStaffUser().id;
  const memberName = useMemberName();
  const toast = useToast();
  const refresh = useInvalidate();
  const preview = useTicketPreview();
  const wake = useWakeTicket();
  const root = useRef<HTMLDivElement>(null);
  const refocus = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waking, setWaking] = useState(false);
  // The value just picked stays in the dropdown until the list has been read again.
  const [pending, setPending] = useState<TicketChanges>({});
  const canClaim = !isDone(t) && t.assignee_id !== me && work.members.some((m) => m.id === me && m.active && m.team_id === t.team_id);
  const members = work.members.filter((m) => m.active && m.team_id === t.team_id);
  const owner = pending.assignee_id ?? t.assignee_id ?? '';

  useEffect(() => {
    if (busy || refocus.current === null) return;
    const focused = refocus.current;
    refocus.current = null;
    if (menu) return onDone?.();
    const row = root.current;
    (row?.querySelector<HTMLElement>(`[data-quick="${focused}"]`) ?? row?.querySelector<HTMLElement>('[data-id]'))?.focus();
  }, [busy, menu, onDone]);

  const run = async (changes: TicketChanges, message: string) => {
    const active = document.activeElement as HTMLElement | null;
    const focused = active && root.current?.contains(active) ? active.dataset.quick || 'claim' : null;
    setPending(changes);
    setBusy(true);
    try {
      await updateTicket(t.id, changes, t);
      if (changes.assignee_id && changes.assignee_id === me) claimSound();
      toast(`${message} · BD-${t.number}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      await refresh(...TICKET_PREFIXES);
      setPending({});
      refocus.current = focused ?? (menu ? 'menu' : null);
      setBusy(false);
    }
  };

  return (
    <div ref={root} className="row-actions" role="group" aria-label={`จัดการด่วน BD-${t.number}`}>
      <button
        type="button"
        className="btn sm"
        data-id={t.id}
        disabled={busy}
        aria-label={`ดูตัวอย่าง BD-${t.number}`}
        title="ดูตัวอย่าง (Quick View)"
        onClick={() => {
          onPreview?.();
          void preview(t.id);
        }}
      >
        <Icon name="eye" />
        {menu && 'ดูตัวอย่างเคส'}
      </button>
      {/* A paused case is back in the list only to be looked at: the one thing to offer is taking the pause off. */}
      {isSnoozed(t) && (
        <button
          type="button"
          className="btn sm"
          data-quick="wake"
          data-id={t.id}
          disabled={busy || waking}
          aria-label={`เอา BD-${t.number} กลับเข้าคิว`}
          title={`พักถึง ${snoozeUntilText(t.snoozed_until)} · กดเพื่อเอากลับเข้าคิวเลย`}
          onClick={async () => {
            setWaking(true);
            if (!(await wake(t.id, t.number))) setWaking(false);
          }}
        >
          <Icon name="restore" />
          {menu && 'เอากลับเข้าคิว'}
        </button>
      )}
      {canClaim && (
        <button type="button" className="btn sm primary" data-id={t.id} disabled={busy} onClick={() => void run({ assignee_id: me }, 'รับเคสแล้ว')}>
          <Icon name="check" />
          รับเคส
        </button>
      )}
      <select
        className="quick-select"
        data-quick="status"
        data-id={t.id}
        disabled={busy}
        aria-label={`เปลี่ยนสถานะ BD-${t.number}`}
        title="เปลี่ยนสถานะ"
        value={pending.status ?? t.status}
        onChange={(e) => void run({ status: e.target.value }, `เปลี่ยนสถานะเป็น “${statusLabels[e.target.value]}” แล้ว`)}
      >
        {Object.entries(statusLabels).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <select
        className="quick-select"
        data-quick="assignee_id"
        data-id={t.id}
        disabled={busy}
        aria-label={`มอบหมาย BD-${t.number}`}
        // The box is too narrow for every name, so the name it is showing is also the tooltip - a cut-off name is
        // readable in full without changing anything.
        title={owner ? `มอบหมาย (Assign) · ตอนนี้: ${memberName(owner)}` : 'มอบหมาย (Assign) · ยังไม่มอบหมาย'}
        value={owner}
        onChange={(e) => {
          const value = e.target.value;
          void run({ assignee_id: value }, value ? `มอบหมายให้ ${memberName(value)} แล้ว` : 'ยกเลิกการมอบหมายแล้ว');
        }}
      >
        <option value="">ยังไม่มอบหมาย</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </div>
  );
}
