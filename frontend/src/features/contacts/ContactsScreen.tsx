'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Avatar, EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { useDialogs } from '@/components/ui/Dialogs';
import { FilterPill, FilterSelect, SearchInput } from '@/components/ui/filters';
import { Pager, usePager } from '@/components/ui/Pager';
import { useToast } from '@/components/ui/Toast';
import { useOpenNewTicket } from '@/features/tickets/components/NewTicket';
import type { TicketRow } from '@/features/tickets/types';
import { AUDIT_PATH } from '@/features/audit/api';
import { GuestBadge } from '@/features/inbox/components/GuestBadge';
import { TRASH_PATH } from '@/features/trash/api';
import { date, relative } from '@/lib/format';
import { channelIcons, channelNames } from '@/lib/labels';
import { useApi, useInvalidate } from '@/lib/query';
import { useStaffTickets, useWork } from '@/lib/session';
import { useUiState } from '@/lib/ui-state';
import { CONTACTS_PATH, deleteContact } from './api';
import { ContactHistory } from './components/ContactHistory';
import { useContactModal } from './components/ContactForm';
import { ContactMerge } from './components/ContactMerge';
import { ContactPeek, CopyButton, useContactPeek } from './components/ContactPeek';
import {
  compareContacts,
  contactBadges,
  contactMood,
  contactSortColumns,
  contactTagLabels,
  contactTicketStats,
  duplicateEmails,
  emailKey,
  type ContactSortKey,
  type ContactStats,
} from './labels';
import type { Contact, ContactsPage } from './types';

/* Customers (the old pages/contacts/contacts.js): search, quick filters, organization filter, sorting (name, contact,
   cases, last contact) and pages; row quick actions; add/edit with a duplicate-email warning; a customer's case
   history; merging duplicates. Markup: pages/contacts/. */

export function ContactsScreen() {
  const list = useApi<ContactsPage>(CONTACTS_PATH);
  const tickets = (useStaffTickets().data?.tickets ?? []) as TicketRow[];
  const work = useWork();
  const canEdit = work.role !== 'agent';
  const toast = useToast();
  const refresh = useInvalidate();
  const { openModal, confirmDelete } = useDialogs();
  const contactModal = useContactModal();
  const openNewTicket = useOpenNewTicket();
  // The search starts empty every time the screen opens (the other choices are kept), unless the address names a
  // customer (/contacts?q=, from ค้นหาด่วน in the top bar); a new one from there replaces what is typed.
  const addressQ = useSearchParams().get('q') ?? '';
  const [query, setQuery] = useState(addressQ);
  const [seenQ, setSeenQ] = useState(addressQ);
  if (seenQ !== addressQ) {
    setSeenQ(addressQ);
    setQuery(addressQ);
  }
  const [tag, setTag] = useUiState('contacts:filter', 'all');
  const [company, setCompany] = useUiState('contacts:company', '');
  const [sort, setSort] = useUiState<{ key: ContactSortKey; direction: 1 | -1 }>('contacts:sort', { key: 'name', direction: 1 });
  const peek = useContactPeek();
  // A customer named in the address is shown whatever quick filter or organization was chosen last time.
  useEffect(() => {
    if (!addressQ) return;
    setTag('all');
    setCompany('');
  }, [addressQ, setTag, setCompany]);

  const contacts = list.data?.contacts ?? [];
  const stats = contactTicketStats(contacts, tickets);
  const duplicates = duplicateEmails(contacts);
  const counts: Record<string, number> = {
    all: contacts.length,
    open: contacts.filter((c) => stats.get(c.id)!.open).length,
    late: contacts.filter((c) => stats.get(c.id)!.late).length,
    duplicate: contacts.filter((c) => duplicates.has(emailKey(c))).length,
  };
  const companies = [...new Set(contacts.map((c) => c.company).filter((name): name is string => Boolean(name)))].sort((a, b) =>
    a.localeCompare(b, 'th'),
  );
  // Choices that no longer match anything fall back to "all" (as the old screen did when it opened).
  const ready = Boolean(list.data);
  const activeTag = !counts.duplicate && tag === 'duplicate' ? 'all' : tag;
  const activeCompany = companies.includes(company) ? company : '';
  useEffect(() => {
    if (!ready) return;
    if (activeTag !== tag) setTag(activeTag);
    if (activeCompany !== company) setCompany(activeCompany);
  }, [ready, activeTag, tag, activeCompany, company, setTag, setCompany]);

  const q = query.toLowerCase();
  const records = contacts
    .filter((c) => {
      const s = stats.get(c.id)!;
      return (
        (!q || [c.name, c.email, c.company, c.phone, ...(c.profile?.tags ?? [])].some((v) => String(v || '').toLowerCase().includes(q))) &&
        (!activeCompany || c.company === activeCompany) &&
        (activeTag === 'all' ||
          (activeTag === 'open' && s.open > 0) ||
          (activeTag === 'late' && s.late > 0) ||
          (activeTag === 'duplicate' && duplicates.has(emailKey(c))))
      );
    })
    .sort((a, b) => compareContacts(a, b, sort.key, stats) * sort.direction);
  const slice = usePager('contacts', records, { size: 25 });

  if (list.error && !list.data) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  if (!list.data) return <PageLoading />;

  const history = (c: Contact) => openModal('เคสของ ' + c.name, <ContactHistory contactId={c.id} />);
  const merge = (c: Contact) => {
    const key = emailKey(c);
    const group = contacts.filter((x) => emailKey(x) === key).sort((a, b) => a.created_at.localeCompare(b.created_at));
    openModal('รวมข้อมูลลูกค้าที่ซ้ำกัน', <ContactMerge group={group} stats={stats} />);
  };
  const remove = (c: Contact) => {
    const cases = tickets.filter((t) => t.contact_id === c.id).length;
    confirmDelete({
      title: 'ลบข้อมูลลูกค้า',
      warning: `“${c.name}” จะถูกย้ายไปถังขยะ`,
      effects: cases
        ? [`ลูกค้ารายนี้ยังมีเคสบริการ ${cases} รายการ จึงลบไม่ได้`, 'ให้รวมรายชื่อซ้ำ หรือลบเคสของลูกค้ารายนี้ก่อน']
        : ['ข้อมูลติดต่อและหมายเหตุจะหายไปจากรายชื่อลูกค้า', 'กู้คืนได้จากเมนูถังขยะภายใน 30 วัน หลังจากนั้นระบบจะลบถาวร', 'การลบจะถูกบันทึกในประวัติการทำงาน'],
      confirmLabel: 'ย้ายไปถังขยะ',
      run: async () => {
        await deleteContact(c.id);
        toast('ย้ายข้อมูลลูกค้าไปถังขยะแล้ว · กู้คืนได้ที่เมนูถังขยะ');
        await refresh(CONTACTS_PATH, TRASH_PATH, AUDIT_PATH);
      },
    });
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>ข้อมูลลูกค้า</h1>
          <p>รู้จักลูกค้าของคุณ พร้อมประวัติการดูแลในองค์กร</p>
        </div>
        <div className="flex">
          <button type="button" className="btn primary" onClick={() => contactModal()}>
            <Icon name="plus" />
            เพิ่มลูกค้า
          </button>
        </div>
      </div>
      <section className="card">
        <div className="filters contact-filters">
          <SearchInput
            id="contact-search"
            label="ค้นหาลูกค้า"
            placeholder="ค้นหาชื่อ อีเมล เบอร์โทร หรือองค์กร"
            value={query}
            onChange={(value) => {
              setQuery(value);
              slice.setPage(1);
            }}
          />
          <FilterSelect
            id="contact-company"
            label="กรองตามองค์กร"
            value={activeCompany}
            any="ทุกองค์กร"
            options={companies.map((name) => ({ value: name, label: name }))}
            onChange={(value) => {
              setCompany(value);
              slice.setPage(1);
            }}
          />
          <div className="contact-tags" role="group" aria-label="ตัวกรองด่วน">
            {Object.entries(contactTagLabels)
              .filter(([key]) => key !== 'duplicate' || counts.duplicate)
              .map(([key, label]) => (
                <FilterPill
                  key={key}
                  value={key}
                  label={label}
                  count={counts[key]}
                  pressed={activeTag === key}
                  warning={key === 'duplicate'}
                  onClick={(value) => {
                    setTag(value);
                    slice.setPage(1);
                  }}
                />
              ))}
          </div>
        </div>
        {counts.duplicate > 0 && activeTag !== 'duplicate' && (
          <div className="dup-banner" role="status">
            <span className="dup-banner-icon" aria-hidden="true">
              <Icon name="users" />
            </span>
            <span>
              <strong>พบอีเมลซ้ำ {counts.duplicate} รายชื่อ ({duplicates.size} กลุ่ม)</strong>
              <span className="muted"> · รวมเป็นรายชื่อเดียวเพื่อให้ประวัติเคสอยู่ที่เดียวกัน</span>
            </span>
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                setTag('duplicate');
                slice.setPage(1);
              }}
            >
              ดูรายชื่อซ้ำ
            </button>
          </div>
        )}
        <div id="contacts-table">
          {!records.length ? (
            contacts.length ? (
              <EmptyState title="ไม่พบลูกค้าที่ตรงกับตัวกรอง" description="ลองเปลี่ยนคำค้นหา หรือเลือก “ทั้งหมด”" icon="users" />
            ) : (
              <EmptyState title="ยังไม่มีข้อมูลลูกค้า" description="เพิ่มลูกค้าหรือรับเรื่องผ่านหน้าลูกค้า" icon="users" />
            )
          ) : (
            <>
              <div className="table-scroll contacts-list">
                <table>
                  <thead>
                    <tr>
                      {contactSortColumns.map(([key, label]) => {
                        const current = sort.key === key;
                        const ascending = sort.direction === 1;
                        return (
                          <th key={key} aria-sort={current ? (ascending ? 'ascending' : 'descending') : 'none'}>
                            <button
                              type="button"
                              className="sort-button"
                              data-sort={key}
                              onClick={() => setSort((s) => ({ key, direction: s.key === key ? (s.direction === 1 ? -1 : 1) : 1 }))}
                            >
                              {label} {current ? (ascending ? '↑' : '↓') : '↕'}
                            </button>
                          </th>
                        );
                      })}
                      <th className="contact-actions-head">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slice.shown.map((c, i) => (
                      <ContactRow
                        key={c.id}
                        c={c}
                        index={slice.start + i}
                        stats={stats.get(c.id)!}
                        duplicate={duplicates.has(emailKey(c))}
                        canEdit={canEdit}
                        onHistory={() => history(c)}
                        onMerge={() => merge(c)}
                        onNewTicket={() => void openNewTicket(c.id)}
                        onEdit={() => contactModal(c)}
                        onDelete={() => remove(c)}
                        onPeek={(el, now) => peek.show(c, stats.get(c.id)!, el, now)}
                        onUnpeek={peek.hide}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager slice={slice} unit="รายชื่อ" />
            </>
          )}
        </div>
      </section>
      <ContactPeek peek={peek.peek} onKeep={peek.keep} onHide={peek.hide} />
    </>
  );
}

/** Markup: pages/contacts/contact-row. */
function ContactRow({
  c,
  index,
  stats: s,
  duplicate,
  canEdit,
  onHistory,
  onMerge,
  onNewTicket,
  onEdit,
  onDelete,
  onPeek,
  onUnpeek,
}: {
  c: Contact;
  index: number;
  stats: ContactStats;
  duplicate: boolean;
  canEdit: boolean;
  onHistory: () => void;
  onMerge: () => void;
  onNewTicket: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPeek: (anchor: HTMLElement, now?: boolean) => void;
  onUnpeek: () => void;
}) {
  const phoneHref = String(c.phone || '').replace(/[^\d+]/g, '');
  const mood = contactMood(c);
  const badges = contactBadges(c, s);
  return (
    <tr className={s.late ? 'contact-late' : undefined}>
      <td className="contact-main">
        <div
          className="contact-person"
          onMouseEnter={(e) => onPeek(e.currentTarget)}
          onMouseLeave={onUnpeek}
          onFocus={(e) => onPeek(e.currentTarget, true)}
          onBlur={onUnpeek}
        >
          <span className="contact-avatar">
            <Avatar name={c.name} index={index} />
            {mood && (
              <span className={`contact-mood ${mood.tone}`} title={`${mood.label} · คะแนนเฉลี่ย ${c.satisfaction!.average}/5 จาก ${c.satisfaction!.count} ครั้ง`}>
                {mood.face}
              </span>
            )}
          </span>
          <div className="contact-id">
            <div className="contact-name">
              <strong title={c.name} tabIndex={0}>
                {c.name}
              </strong>
              <GuestBadge guest={c.guest} />
              {duplicate &&
                (canEdit ? (
                  <button
                    type="button"
                    className="badge pending_customer dup-badge"
                    aria-label={`รวมข้อมูลซ้ำของ ${c.name}`}
                    title="มีลูกค้ารายอื่นใช้อีเมลเดียวกัน · กดเพื่อรวมเป็นรายชื่อเดียว"
                    onClick={onMerge}
                  >
                    อีเมลซ้ำ
                  </button>
                ) : (
                  <span className="badge pending_customer" title="มีลูกค้ารายอื่นใช้อีเมลเดียวกัน">
                    อีเมลซ้ำ
                  </span>
                ))}
            </div>
            {c.company ? (
              <div className="contact-org muted" title={c.company}>
                {c.company}
              </div>
            ) : (
              <div className="contact-org muted">ไม่ระบุองค์กร</div>
            )}
            {c.profile?.warning && (
              <div className="contact-warning-line" title={`คำเตือนถึงทีม: ${c.profile.warning}`}>
                <Icon name="bell" />
                {c.profile.warning}
              </div>
            )}
            {(badges.length > 0 || Boolean(c.profile?.tags.length)) && (
              <div className="contact-badges">
                {badges.map((b) => (
                  <span key={b.key} className={`contact-badge ${b.tone}`} title={b.title}>
                    {b.label}
                  </span>
                ))}
                {c.profile?.tags.map((t) => (
                  <span key={`tag:${t}`} className="contact-tag" title="แท็กของทีม">
                    #{t}
                  </span>
                ))}
              </div>
            )}
            {c.notes && (
              <div className="contact-note" title={c.notes}>
                <Icon name="edit" />
                {c.notes}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="contact-reach">
        {c.main_channel && (
          <span className="contact-channel" title={`ติดต่อผ่าน${channelNames[c.main_channel] ?? c.main_channel}บ่อยที่สุด`}>
            <Icon name={channelIcons[c.main_channel] ?? 'chat'} />
            {channelNames[c.main_channel] ?? c.main_channel}
          </span>
        )}
        {c.email && (
          <div className="contact-line">
            <Icon name="mail" />
            <a href={`mailto:${c.email}`} aria-label={`ส่งอีเมลถึง ${c.email}`} title={`ส่งอีเมลถึง ${c.email}`}>
              {c.email}
            </a>
            <CopyButton value={c.email} label="อีเมล" />
          </div>
        )}
        {c.phone && (
          <div className="contact-line">
            <Icon name="phone" />
            <a href={`tel:${phoneHref}`} aria-label={`โทรหา ${c.phone}`} title={`โทรหา ${c.phone}`}>
              {c.phone}
            </a>
            <CopyButton value={c.phone} label="เบอร์โทร" />
          </div>
        )}
        {!c.email && !c.phone && <span className="muted">ยังไม่มีช่องทางติดต่อ</span>}
      </td>
      <td className="contact-cases">
        <div className="case-cell">
          {s.total ? (
            <button
              type="button"
              className="case-count"
              aria-label={`ดูประวัติเคสของ ${c.name} (${s.total} เคส)`}
              title={`ดูประวัติเคสของ ${c.name}`}
              onClick={onHistory}
            >
              {s.total} เคส
            </button>
          ) : (
            <span className="muted">ยังไม่มีเคส</span>
          )}
          {s.late ? (
            <Link className="badge suspended badge-link" href={`/tickets?contact=${c.id}&filter=overdue`} title="เปิดเคสเกิน SLA ของลูกค้ารายนี้">
              ⚠ {s.late} เกิน SLA
            </Link>
          ) : s.open ? (
            <Link className="badge pending_customer badge-link" href={`/tickets?contact=${c.id}&filter=active`} title="เปิดเคสค้างของลูกค้ารายนี้">
              {s.open} เคสค้าง
            </Link>
          ) : null}
        </div>
      </td>
      <td className="contact-last">
        {s.last ? (
          <span title={`อัปเดตเคสล่าสุด ${date(s.last, true)}`}>{relative(s.last)}</span>
        ) : (
          <span className="muted" title={`เพิ่มเข้าระบบเมื่อ ${date(c.created_at)}`}>
            -
          </span>
        )}
      </td>
      <td className="contact-actions">
        <div className="row-actions" role="group" aria-label={`จัดการ ${c.name}`}>
          <button type="button" className="btn sm" aria-label={`สร้างเคสใหม่ให้ ${c.name}`} title="สร้างเคสใหม่" onClick={onNewTicket}>
            <Icon name="plus" />
            <span>เคสใหม่</span>
          </button>
          {canEdit && (
            <>
              <button type="button" className="btn sm" aria-label={`แก้ไข ${c.name}`} title="แก้ไขข้อมูลลูกค้า" onClick={onEdit}>
                <Icon name="edit" />
              </button>
              <button type="button" className="btn sm danger-tool" aria-label={`ลบ ${c.name}`} title="ลบข้อมูลลูกค้า" onClick={onDelete}>
                <Icon name="close" />
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
