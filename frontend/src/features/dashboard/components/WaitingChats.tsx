'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { AllClear } from '@/features/inbox/components/AllClear';
import { needsReply } from '@/features/inbox/hooks';
import { useCachedConversations } from '@/features/notifications/items';
import { plainText } from '@/lib/format';
import { channelIcons } from '@/lib/labels';

/* แชทรอตอบ: conversations whose last message is the customer's, with or without a case, longest wait first - the
   cases do not show a chat nobody opened a case for. The first three, then a link to the inbox. Markup:
   dashboard-extras (waiting-card). */

const SHOWN = 3;

const waitedSince = (at: string | null | undefined, fallback: string) => new Date(at || fallback).getTime();

/** "12 นาที", "5 ชม.", "3 วัน": short enough for the side column. */
export function waitText(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 60) return `${minutes} นาที`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} ชม.`;
  return `${Math.floor(minutes / 1440)} วัน`;
}

export function WaitingChats({ now }: { now: number }) {
  const conversations = useCachedConversations(true);
  const waiting = (conversations.data?.conversations ?? [])
    .filter(needsReply)
    .map((c) => ({ c, since: waitedSince(c.last_public_at, c.updated_at) }))
    .sort((a, b) => a.since - b.since);
  const longest = waiting[0];
  const noCase = waiting.filter((w) => !w.c.ticket_id).length;

  return (
    <section className="card waiting-card" aria-labelledby="waiting-title">
      <div className="card-header">
        <div>
          <h2 id="waiting-title">แชทรอตอบ</h2>
          <p>{longest ? `รอนานสุด ${waitText(now - longest.since)}${noCase ? ` · ${noCase} แชทยังไม่เปิดเคส` : ''}` : 'ลูกค้าที่ยังไม่มีใครตอบ'}</p>
        </div>
        <span className={`badge${waiting.length ? ' pending_customer' : ''}`}>{waiting.length} แชท</span>
      </div>
      <div className="card-body">
        {conversations.isPending ? (
          <div className="empty-mini">กำลังโหลด…</div>
        ) : longest ? (
          <>
            <ul className="waiting-list">
              {waiting.slice(0, SHOWN).map(({ c, since }) => (
                <li key={c.id}>
                  <Link href={`/inbox/${c.id}`} className="waiting-row">
                    <Icon name={channelIcons[c.channel] || 'chat'} />
                    <span className="waiting-who">
                      <strong className="truncate">{c.contact_name}</strong>
                      <span className="tiny muted truncate">{plainText(c.preview ?? c.subject).slice(0, 80)}</span>
                    </span>
                    <span className="tiny waiting-time">{waitText(now - since)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="waiting-actions">
              <Link className="btn primary small" href={`/inbox/${longest.c.id}`}>
                <Icon name="send" /> ตอบคนที่รอนานสุด
              </Link>
              {waiting.length > SHOWN && (
                <Link className="small" href="/inbox">
                  ดูอีก {waiting.length - SHOWN} แชท →
                </Link>
              )}
            </div>
          </>
        ) : (
          <AllClear compact seed={(conversations.data?.conversations ?? []).length} />
        )}
      </div>
    </section>
  );
}
