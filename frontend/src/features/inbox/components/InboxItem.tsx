import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { plainText, relative } from '@/lib/format';
import { channelIcons, channelNames, priorityLabels } from '@/lib/labels';
import { needsReply } from '../hooks';
import type { ConversationSummary } from '../types';

/* One conversation in the inbox list: a plain row, not a card of chips. Who (with the channel's icon) and when, the
   subject, the last message, then one quiet line of what matters: "รอเราตอบ" (the only colour in the row), urgency,
   the case number and the company. Markup: pages/inbox-calm.css (staff-chat-item). */

/** Where a conversation stands, in the team's words (the case page and other lists use the tones). */
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
  const guest = c.guest ? ' · ผู้เยี่ยมชม (ไม่ได้เข้าสู่ระบบ)' : '';
  const foot = [c.ticket_number ? `BD-${c.ticket_number}` : null, c.company, c.status === 'closed' ? 'ปิดแล้ว' : null].filter((x): x is string => Boolean(x));
  return (
    <Link
      className={`inbox-item staff-chat-item${selected ? ' selected' : ''}${waiting ? ' needs-reply' : ''}`}
      href={`/inbox/${c.id}`}
      aria-current={selected ? 'true' : undefined}
    >
      <div className="inbox-top">
        <span className="inbox-channel" title={`${channelName}${guest}`}>
          <Icon name={channelIcons[c.channel] || 'chat'} />
          <span className="sr-only">{channelName}: </span>
        </span>
        <span className="inbox-name">{c.contact_name}</span>
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
      {(waiting || urgent || foot.length > 0) && (
        <p className="inbox-foot">
          {waiting && <span className="inbox-waiting">รอเราตอบ</span>}
          {urgent && <span className={`inbox-urgent ${c.ticket_priority}`}>{priorityLabels[c.ticket_priority!]}</span>}
          {foot.map((part) => (
            <span key={part}>{part}</span>
          ))}
        </p>
      )}
    </Link>
  );
}
