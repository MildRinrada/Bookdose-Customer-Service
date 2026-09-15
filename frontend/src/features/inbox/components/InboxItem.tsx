import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { plainText, shortAgo } from '@/lib/format';
import { channelIcons, channelNames, priorityLabels } from '@/lib/labels';
import { needsReply } from '../hooks';
import type { ConversationSummary } from '../types';

/* One conversation in the inbox list: channel, customer, the waiting dot and time; the subject; then the last
   message with urgency, case number and "closed". Markup: pages/inbox/inbox-item. */

export function InboxItem({ c, selected }: { c: ConversationSummary; selected: boolean }) {
  const waiting = needsReply(c);
  const urgent = ['high', 'urgent'].includes(c.ticket_priority ?? '');
  const channelName = channelNames[c.channel] || c.channel;
  return (
    <Link
      className={`inbox-item${selected ? ' selected' : ''}${waiting ? ' needs-reply' : ''}`}
      href={`/inbox/${c.id}`}
      aria-current={selected ? 'true' : undefined}
    >
      <div className="inbox-top">
        <span className={`channel-dot channel-${c.channel}`} title={channelName}>
          <Icon name={channelIcons[c.channel] || 'chat'} />
          <span className="sr-only">{channelName}</span>
        </span>
        <strong className="inbox-name">{c.contact_name}</strong>
        {waiting && (
          <span className="unread-dot" title="รอตอบกลับ">
            <span className="sr-only">รอตอบกลับ</span>
          </span>
        )}
        <span className="inbox-time">{shortAgo(c.updated_at)}</span>
      </div>
      <h3>{c.subject}</h3>
      <div className="inbox-bottom">
        <p className="inbox-preview">
          {c.last_kind === 'reply' && 'ตอบแล้ว: '}
          {c.last_kind === 'note' && 'บันทึกภายใน: '}
          {plainText(c.preview) || 'ยังไม่มีข้อความ'}
        </p>
        {urgent && (
          <span
            className={`priority-dot ${c.ticket_priority}`}
            role="img"
            aria-label={`ความเร่งด่วน: ${priorityLabels[c.ticket_priority!]}`}
            title={`ความเร่งด่วน: ${priorityLabels[c.ticket_priority!]}`}
          />
        )}
        {c.ticket_number ? <span className="inbox-case">BD-{c.ticket_number}</span> : null}
        {c.status === 'closed' && <span className="badge closed">ปิดแล้ว</span>}
      </div>
    </Link>
  );
}
