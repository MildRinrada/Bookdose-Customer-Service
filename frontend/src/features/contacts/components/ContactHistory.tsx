'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { Badge, EmptyState } from '@/components/ui/display';
import { useDialogs } from '@/components/ui/Dialogs';
import type { TicketRow } from '@/features/tickets/types';
import { date, overdue } from '@/lib/format';
import { useMemberName, useStaffTickets } from '@/lib/session';

/** A customer's cases in the modal (the old contactHistory); clicking a row opens the case.
    Markup: pages/contacts/contact-history, contact-history-row. */
export function ContactHistory({ contactId }: { contactId: string }) {
  const router = useRouter();
  const { closeModal } = useDialogs();
  const memberName = useMemberName();
  const tickets = ((useStaffTickets().data?.tickets ?? []) as TicketRow[]).filter((t) => t.contact_id === contactId);
  if (!tickets.length) return <EmptyState title="ยังไม่มีเคส" description="ลูกค้ารายนี้ยังไม่มีเคสบริการ" icon="ticket" />;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>เคส</th>
            <th>สถานะ</th>
            <th>ผู้รับผิดชอบ</th>
            <th>วันที่สร้าง / อัปเดต</th>
            <th>รายละเอียด</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr
              key={t.id}
              className="linked-row"
              data-href={`/tickets/${t.id}`}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('a,button')) return;
                closeModal();
                router.push(`/tickets/${t.id}`);
              }}
            >
              <td>
                {t.subject}
                <div>BD-{t.number}</div>
              </td>
              <td>
                <Badge status={t.status} /> {overdue(t) && <span className="badge suspended">⚠ เกิน SLA</span>}
              </td>
              <td>{memberName(t.assignee_id)}</td>
              <td>
                {date(t.created_at)}
                <div className="muted">อัปเดต {date(t.updated_at)}</div>
              </td>
              <td>
                <Link className="btn subtle" href={`/tickets/${t.id}`} aria-label={`เปิดเคส BD-${t.number}`}>
                  <Icon name="arrow" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
