'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { Icon } from '@/components/Icon';
import { Badge, PriorityTag } from '@/components/ui/display';
import { useDialogs } from '@/components/ui/Dialogs';
import { useToast } from '@/components/ui/Toast';
import { Messages } from '@/features/inbox/components/MessageThread';
import { api } from '@/lib/api/client';
import { date } from '@/lib/format';
import { useMemberName, useWork } from '@/lib/session';
import { ticketPath } from '../api';
import { lateBy } from '../labels';
import type { TicketDetail } from '../types';

/** The quick view of a case in the side drawer: its state, the customer and the last three messages.
    Markup: pages/tickets/ticket-preview. */
export function TicketPreview({ data }: { data: TicketDetail }) {
  const work = useWork();
  const memberName = useMemberName();
  const { ticket: t, contact: c } = data;
  const messages = data.conversations
    .flatMap((conv) => conv.messages)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(-3);
  const late = lateBy(t);
  return (
    <div className="ticket-preview">
      <h3>{t.subject}</h3>
      <p className="muted">
        {t.category} · เปิดเมื่อ {date(t.created_at, true)}
      </p>
      <dl className="preview-meta">
        <div>
          <dt>สถานะ</dt>
          <dd>
            <Badge status={t.status} />
          </dd>
        </div>
        <div>
          <dt>ความเร่งด่วน</dt>
          <dd>
            <PriorityTag value={t.priority} />
          </dd>
        </div>
        <div>
          <dt>ผู้รับผิดชอบ</dt>
          <dd>{memberName(t.assignee_id)}</dd>
        </div>
        <div>
          <dt>ทีม</dt>
          <dd>{work.teams.find((team) => team.id === t.team_id)?.name || '-'}</dd>
        </div>
        <div>
          <dt>กำหนดแก้ไข</dt>
          <dd>
            {date(t.resolution_due_at, true)}
            {late && (
              <>
                {' '}
                <span className="sla-late">
                  <Icon name="clock" />
                  เกิน {late}
                </span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>ลูกค้า</dt>
          <dd>
            {c.name}
            <span className="muted preview-contact">
              {c.email || '-'} · {c.phone || '-'}
            </span>
          </dd>
        </div>
      </dl>
      <h4>ข้อความล่าสุด</h4>
      <div className="preview-thread">
        <Messages messages={messages} />
      </div>
      <div className="form-actions">
        <Link className="btn primary" href={`/tickets/${t.id}`}>
          <Icon name="arrow" />
          เปิดเคสเต็มหน้า
        </Link>
      </div>
    </div>
  );
}

/** const preview = useTicketPreview(); preview(id) loads the case and opens its quick view in the drawer. */
export function useTicketPreview() {
  const { openModal } = useDialogs();
  const toast = useToast();
  return useCallback(
    async (id: string) => {
      try {
        const data = await api<TicketDetail>(ticketPath(id));
        openModal(`BD-${data.ticket.number}`, <TicketPreview data={data} />, { drawer: true });
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), true);
      }
    },
    [openModal, toast],
  );
}
