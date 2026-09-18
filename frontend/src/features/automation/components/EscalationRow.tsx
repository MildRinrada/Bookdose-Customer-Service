'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { relative } from '@/lib/format';
import { escalationReasons } from '@/lib/labels';
import { useMemberName } from '@/lib/session';
import type { Escalation } from '../types';

/** One escalated case (automation page, dashboard manager view). Markup: pages/automation/escalation-row. */
export function EscalationRow({ escalation: e }: { escalation: Escalation }) {
  const memberName = useMemberName();
  const tone = e.reason === 'unclaimed' ? 'warn' : 'danger';
  const to = e.to_user_id ? memberName(e.to_user_id) : 'ไม่พบเจ้าขององค์กร';
  return (
    <div className={`sla-item escalation-row ${tone}`}>
      <div className="flex between">
        <span className="ticket-id">BD-{e.number}</span>
        <time className="tiny muted" dateTime={e.escalated_at}>
          {relative(e.escalated_at)}
        </time>
      </div>
      <Link href={`/tickets/${e.ticket_id}`} className="truncate">
        {e.subject}
      </Link>
      <div className="time">
        <Icon name="bolt" /> {escalationReasons[e.reason] || e.reason} · {to}
      </div>
    </div>
  );
}
