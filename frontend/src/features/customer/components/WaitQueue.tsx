'use client';

import { Icon } from '@/components/Icon';
import { useRunAction } from '@/components/ui/actions';
import { useToast } from '@/components/ui/Toast';
import { setNoRush } from '../api';
import type { PortalQueue } from '../types';

/* Under the customer's latest message while they wait for the team (backend conversations/queue.py): their place in
   the queue and about how long, from the team's real replies over the last week - so nobody writes again only to
   ask whether anyone is there. With nobody available it says so instead of a time the team would not keep. The chat
   is read again every ten seconds, so the place moves up as the team answers.

   ไม่รีบ (backend portal/no_rush.py): a customer who can wait says a reply tomorrow is fine. They go behind the ones
   in a hurry and are told the reply promised instead of a guess; they can take it back while they wait. Markup:
   pages/wait-queue.css. */

/** "ภายในไม่กี่นาที", "ในราว 15 นาที", "ในราว 2 ชั่วโมง": about, never to the minute. */
export function waitText(minutes: number) {
  if (minutes <= 2) return 'ภายในไม่กี่นาที';
  if (minutes < 55) return `ในราว ${Math.ceil(minutes / 5) * 5} นาที`;
  if (minutes < 24 * 60) return `ในราว ${Math.max(1, Math.round(minutes / 60))} ชั่วโมง`;
  return 'ในอีกมากกว่า 1 วัน';
}

export function WaitQueue({
  queue,
  base,
  conversationId,
  onChanged,
}: {
  queue: PortalQueue | null | undefined;
  /** /api/public/<org> for a signed-in customer, …/guest for a visitor. */
  base: string;
  conversationId: string;
  onChanged: () => Promise<unknown> | void;
}) {
  const run = useRunAction();
  const toast = useToast();
  if (!queue) return null;
  const ahead = queue.position - 1;
  const unhurried = queue.no_rush;
  const say = (on: boolean) =>
    run(async () => {
      const result = await setNoRush(base, conversationId, on);
      await onChanged();
      toast(on && result.no_rush ? `รับทราบค่ะ ทีมจะตอบภายใน${result.no_rush.text}` : 'กลับไปรอตามคิวปกติแล้ว');
    });
  const title = unhurried
    ? `ทีมจะตอบภายใน${unhurried.text}`
    : queue.away
      ? 'ตอนนี้ไม่มีเจ้าหน้าที่ออนไลน์'
      : queue.wait_minutes != null
        ? `ทีมน่าจะตอบ${waitText(queue.wait_minutes)}`
        : 'ข้อความของคุณถึงทีมแล้ว';
  const hint = unhurried
    ? 'คุณบอกว่าไม่รีบ ลูกค้าที่รีบจะได้คำตอบก่อน ไม่ต้องส่งข้อความซ้ำ'
    : queue.away
      ? 'ข้อความของคุณอยู่ในคิวแล้ว ทีมจะตอบเมื่อกลับมา ไม่ต้องส่งซ้ำ'
      : ahead > 0
        ? `มีลูกค้ารอก่อนคุณ ${ahead} คน · ไม่ต้องส่งข้อความซ้ำ ลำดับของคุณไม่หายไป`
        : 'คุณเป็นคิวถัดไป · ไม่ต้องส่งข้อความซ้ำ';
  return (
    <div className={`wait-queue${queue.away && !unhurried ? ' is-away' : ''}${unhurried ? ' is-unhurried' : ''}`} role="status" aria-live="polite">
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
        {unhurried ? (
          <button type="button" className="btn sm wait-queue-rush" onClick={() => void say(false)}>
            ขอให้ตอบตามคิวปกติ
          </button>
        ) : (
          <button
            type="button"
            className="btn sm wait-queue-rush"
            title="ลูกค้าที่รีบจะได้คำตอบก่อน ทีมจะตอบภายในสิ้นวันทำการถัดไป"
            onClick={() => void say(true)}
          >
            ไม่รีบ ตอบพรุ่งนี้ก็ได้
          </button>
        )}
      </div>
    </div>
  );
}
