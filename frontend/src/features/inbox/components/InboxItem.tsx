import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { plainText, relative } from '@/lib/format';
import { channelIcons, channelNames, priorityLabels } from '@/lib/labels';
import { needsReply } from '../hooks';
import { GuestBadge } from './GuestBadge';
import type { ConversationSummary } from '../types';

/* One conversation in the inbox list, laid out as a chat in the customer's แชทของฉัน (features/customer/ChatsScreen.tsx):
   who and when on top (channel, customer, the waiting dot), the subject, the last message, then a row of chips - where
   it stands, the company, urgency and the case number. Markup: pages/inbox/inbox-item, pages/customer.css (the chip
   row and the card look, shared with the customer's list). */

/** Where a conversation stands, in the team's words, in the tones of the customer's list. */
export function inboxState(c: Pick<ConversationSummary, 'status' | 'last_public_kind'>): { label: string; tone: string } {
  if (c.status === 'closed') return { label: 'ปิดแล้ว', tone: 'done' };
  if (needsReply(c)) return { label: 'รอเราตอบ', tone: 'waiting' };
  if (c.last_public_kind === 'reply') return { label: 'ตอบแล้ว รอลูกค้า', tone: 'working' };
  return { label: 'เปิดอยู่', tone: 'received' };
}

export function InboxItem({ c, selected }: { c: ConversationSummary; selected: boolean }) {
  const waiting = needsReply(c);
  const urgent = ['high', 'urgent'].includes(c.ticket_priority ?? '');
  const channelName = channelNames[c.channel] || c.channel;
  const state = inboxState(c);
  return (
    <Link
      className={`inbox-item staff-chat-item${selected ? ' selected' : ''}${waiting ? ' needs-reply' : ''}`}
      href={`/inbox/${c.id}`}
      aria-current={selected ? 'true' : undefined}
    >
      <div className="inbox-top">
        {/* Where the customer's list names the organization, the team's names the customer (and the channel). */}
        <span className={`customer-org-badge staff-contact-badge channel-${c.channel}`} title={`${c.contact_name} · ${channelName}`}>
          <Icon name={channelIcons[c.channel] || 'chat'} />
          <span className="sr-only">{channelName}: </span>
          <span className="inbox-name">{c.contact_name}</span>
        </span>
        {waiting && (
          <span className="unread-dot" title="รอตอบกลับ">
            <span className="sr-only">รอตอบกลับ</span>
          </span>
        )}
        <time className="inbox-time" dateTime={c.updated_at}>
          {relative(c.updated_at)}
        </time>
      </div>
      <h3>{c.subject}</h3>
      <p className="inbox-preview">
        {c.last_kind === 'reply' && 'ทีมงาน: '}
        {c.last_kind === 'note' && 'บันทึกภายใน: '}
        {plainText(c.preview || '').slice(0, 90) || 'ยังไม่มีข้อความ'}
      </p>
      <div className="customer-chat-meta">
        <span className={`customer-state tone-${state.tone}`}>{state.label}</span>
        <GuestBadge guest={c.guest} />
        {c.company && <span className="customer-category-tag">{c.company}</span>}
        {urgent && (
          <span className={`customer-category-tag priority-tag ${c.ticket_priority}`}>
            <span className={`priority-dot ${c.ticket_priority}`} aria-hidden="true" />
            {priorityLabels[c.ticket_priority!]}
          </span>
        )}
        {c.ticket_number ? <span className="inbox-case">BD-{c.ticket_number}</span> : null}
      </div>
    </Link>
  );
}
