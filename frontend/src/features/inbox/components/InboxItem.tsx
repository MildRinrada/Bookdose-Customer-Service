import Link from 'next/link';
import { Avatar } from '@/components/ui/display';
import { MoodTag } from '@/components/ui/MoodTag';
import { plainText, relative } from '@/lib/format';
import { channelNames, priorityLabels } from '@/lib/labels';
import { needsReply } from '../hooks';
import type { ConversationSummary } from '../types';

/* One conversation in the inbox list: the customer's avatar, who and when, the subject, the last message, then one
   line of what matters: "รอเราตอบ", urgency, the channel, the case number and the company. What waits for us is bold.
   Markup: pages/inbox-fresh.css (inbox-row). */

/** Where a conversation stands, in the team's words (the case page and other lists use the tones). */
export function inboxState(c: Pick<ConversationSummary, 'status' | 'last_public_kind'>): { label: string; tone: string } {
  if (c.status === 'closed') return { label: 'ปิดแล้ว', tone: 'done' };
  if (needsReply(c)) return { label: 'รอเราตอบ', tone: 'waiting' };
  if (c.last_public_kind === 'reply') return { label: 'ตอบแล้ว รอลูกค้า', tone: 'working' };
  return { label: 'เปิดอยู่', tone: 'received' };
}

/** The same customer keeps the same avatar colour everywhere in the list. */
export const avatarIndex = (id: string) => [...id].reduce((n, ch) => n + ch.charCodeAt(0), 0);

export function CustomerAvatar({ name, id }: { name: string; id: string }) {
  return (
    <span className="inbox-avatar">
      <Avatar name={name} index={avatarIndex(id)} />
    </span>
  );
}

export function InboxItem({ c, selected }: { c: ConversationSummary; selected: boolean }) {
  const waiting = needsReply(c);
  const urgent = ['high', 'urgent'].includes(c.ticket_priority ?? '');
  // How the customer feels only matters while the conversation is open.
  const upset = c.status !== 'closed' && Boolean(c.mood_level || c.mood_urgent);
  const channelName = channelNames[c.channel] || c.channel;
  const guest = c.guest ? ' · ผู้เยี่ยมชม (ไม่ได้เข้าสู่ระบบ)' : '';
  const foot = [channelName, c.ticket_number ? `BD-${c.ticket_number}` : null, c.company, c.status === 'closed' ? 'ปิดแล้ว' : null].filter((x): x is string => Boolean(x));
  return (
    <Link
      className={`inbox-item staff-chat-item inbox-row${selected ? ' selected' : ''}${waiting ? ' needs-reply' : ''}`}
      href={`/inbox/${c.id}`}
      aria-current={selected ? 'true' : undefined}
      title={`${channelName}${guest}`}
    >
      <CustomerAvatar name={c.contact_name} id={c.contact_id} />
      <span className="inbox-row-body">
        <span className="inbox-top">
          <span className="inbox-name">{c.contact_name}</span>
          <time className="inbox-time" dateTime={c.updated_at}>
            {relative(c.updated_at)}
          </time>
        </span>
        <h3>{c.subject}</h3>
        <span className="inbox-preview">
          {c.last_kind === 'reply' && <span className="inbox-preview-who">คุณ: </span>}
          {c.last_kind === 'note' && <span className="inbox-preview-who">บันทึกภายใน: </span>}
          {plainText(c.preview || '').slice(0, 90) || 'ยังไม่มีข้อความ'}
        </span>
        {(waiting || urgent || upset || foot.length > 0) && (
          <span className="inbox-foot">
            {waiting && <span className="inbox-waiting">รอเราตอบ</span>}
            {upset && <MoodTag mood={c} />}
            {urgent && <span className={`inbox-urgent ${c.ticket_priority}`}>{priorityLabels[c.ticket_priority!]}</span>}
            {foot.map((part) => (
              <span key={part}>{part}</span>
            ))}
          </span>
        )}
      </span>
    </Link>
  );
}
