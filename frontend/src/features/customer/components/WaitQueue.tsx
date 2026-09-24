'use client';

import { Icon } from '@/components/Icon';
import type { PortalQueue } from '../types';

/* Under the customer's latest message while they wait for the team (backend conversations/queue.py): their place in
   the queue and about how long, from the team's real replies over the last week - so nobody writes again only to
   ask whether anyone is there. With nobody available it says so instead of a time the team would not keep. The chat
   is read again every ten seconds, so the place moves up as the team answers. Markup: pages/wait-queue.css. */

/** "ภายในไม่กี่นาที", "ในราว 15 นาที", "ในราว 2 ชั่วโมง": about, never to the minute. */
export function waitText(minutes: number) {
  if (minutes <= 2) return 'ภายในไม่กี่นาที';
  if (minutes < 55) return `ในราว ${Math.ceil(minutes / 5) * 5} นาที`;
  if (minutes < 24 * 60) return `ในราว ${Math.max(1, Math.round(minutes / 60))} ชั่วโมง`;
  return 'ในอีกมากกว่า 1 วัน';
}

export function WaitQueue({ queue }: { queue: PortalQueue | null | undefined }) {
  if (!queue) return null;
  const ahead = queue.position - 1;
  const title = queue.away
    ? 'ตอนนี้ไม่มีเจ้าหน้าที่ออนไลน์'
    : queue.wait_minutes != null
      ? `ทีมน่าจะตอบ${waitText(queue.wait_minutes)}`
      : 'ข้อความของคุณถึงทีมแล้ว';
  const hint = queue.away
    ? 'ข้อความของคุณอยู่ในคิวแล้ว ทีมจะตอบเมื่อกลับมา ไม่ต้องส่งซ้ำ'
    : ahead > 0
      ? `มีลูกค้ารอก่อนคุณ ${ahead} คน · ไม่ต้องส่งข้อความซ้ำ ลำดับของคุณไม่หายไป`
      : 'คุณเป็นคิวถัดไป · ไม่ต้องส่งข้อความซ้ำ';
  return (
    <div className={`wait-queue${queue.away ? ' is-away' : ''}`} role="status" aria-live="polite">
      <span className="wait-queue-place" aria-label={`ลำดับคิวที่ ${queue.position}`}>
        <small>คิวที่</small>
        <strong>{queue.position}</strong>
      </span>
      <div className="wait-queue-text">
        <p className="wait-queue-title">
          <Icon name="clock" />
          {title}
        </p>
        <p className="wait-queue-hint">{hint}</p>
      </div>
    </div>
  );
}
