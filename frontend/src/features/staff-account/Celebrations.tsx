'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useStaffAlerts } from '@/lib/session';
import { playSound } from './alerts';
import { celebrate, onCelebrate, setFeedbackPrefs, type Celebration } from './celebrate';
import { usePreferences } from './prefs';

/* The staff frame's celebrations: confetti over the page and a card at the bottom when the member closes a case (one
   card for several closed together) or a customer gives their case five stars. Five stars given while the page was
   closed are celebrated the next time it opens; the first visit only remembers what is already there. Reduced motion
   keeps the card without confetti. Styles: styles/pages/celebrations.css. */

const CHEERS = ['เยี่ยมมาก!', 'สุดยอด!', 'เก่งมาก!', 'ทำได้ดีมาก!'];
const COLORS = ['#1c1c1e', '#e5484d', '#f5b942', '#2f9e6b', '#3b82f6', '#a1a1a6'];
const SHOW_MS = 4500;

export function Celebrations({ userId }: { userId: string }) {
  const notify = usePreferences().data?.preferences.notify;
  const [card, setCard] = useState<(Celebration & { count: number; cheer: string }) | null>(null);
  const [burst, setBurst] = useState(0);
  const pending = useRef<Celebration[]>([]);

  useEffect(() => {
    if (notify) setFeedbackPrefs({ sound: notify.sound, celebrate: notify.celebrate });
  }, [notify]);

  // Events arriving together (closing several cases at once) make one card.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = onCelebrate((item) => {
      pending.current.push(item);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const items = pending.current;
        pending.current = [];
        const first = items[items.length - 1];
        const resolved = items.filter((i) => i.kind === 'resolved').length;
        const shown =
          items.length > 1 && resolved === items.length ? { kind: 'resolved' as const, title: `ปิดเคสสำเร็จ ${resolved} เคส`, detail: 'ลูกค้าได้รับการดูแลครบแล้ว' } : first;
        setCard({ ...shown, count: items.length, cheer: CHEERS[Math.floor(Math.random() * CHEERS.length)] });
        setBurst((b) => b + 1);
        if (notify?.sound) playSound('success');
      }, 500);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [notify?.sound]);

  useEffect(() => {
    if (!card) return;
    const timer = setTimeout(() => setCard(null), SHOW_MS);
    return () => clearTimeout(timer);
  }, [card]);

  usePraise(userId, Boolean(notify?.celebrate));

  return (
    <>
      {burst > 0 && <Confetti key={burst} />}
      {card && (
        <div className={`celebration-card ${card.kind}`} role="status">
          <span className="celebration-icon" aria-hidden="true">
            <Icon name={card.kind === 'praise' ? 'star' : 'checkCircle'} />
          </span>
          <span className="celebration-text">
            <small>{card.kind === 'praise' ? 'ลูกค้าให้ ★★★★★' : card.cheer}</small>
            <strong>{card.title}</strong>
            {card.detail && <span>{card.detail}</span>}
          </span>
          <button type="button" className="icon-btn" aria-label="ปิด" onClick={() => setCard(null)}>
            <Icon name="close" />
          </button>
        </div>
      )}
    </>
  );
}

/** New five-star answers on the member's cases (the alerts' "praise"), remembered per member in this browser. */
function usePraise(userId: string, enabled: boolean) {
  const praise = useStaffAlerts().data?.praise;
  useEffect(() => {
    if (!enabled || !praise) return;
    const key = `bd-praise-seen:${userId}`;
    let seen: string[] | null = null;
    try {
      seen = JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
      /* Storage off: nothing is remembered and nothing old is celebrated. */
    }
    const fresh = seen ? praise.filter((p) => !seen.includes(p.id)) : [];
    try {
      localStorage.setItem(key, JSON.stringify(praise.map((p) => p.id)));
    } catch {
      /* Private window. */
    }
    if (!seen) return;
    for (const p of fresh.slice(0, 3))
      celebrate({ kind: 'praise', title: `BD-${p.number} ได้ 5 ดาว`, detail: p.comment ? `“${p.comment.slice(0, 80)}”` : p.subject });
  }, [praise, userId, enabled]);
}

/** Paper falling from above the page for about three seconds, drawn on a canvas that takes no clicks. */
function Confetti() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setDone(true);
    const scale = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    el.width = width * scale;
    el.height = height * scale;
    ctx.scale(scale, scale);
    const pieces = Array.from({ length: 150 }, (_, i) => ({
      x: width / 2 + (Math.random() - 0.5) * width * 0.5,
      y: height * 0.35 + (Math.random() - 0.5) * 60,
      vx: (Math.random() - 0.5) * 14,
      vy: -(6 + Math.random() * 12),
      size: 6 + Math.random() * 7,
      spin: Math.random() * Math.PI,
      turn: (Math.random() - 0.5) * 0.3,
      color: COLORS[i % COLORS.length],
      round: Math.random() < 0.3,
    }));
    const started = performance.now();
    let frame = 0;
    const draw = (time: number) => {
      const t = time - started;
      ctx.clearRect(0, 0, width, height);
      ctx.globalAlpha = Math.max(0, Math.min(1, (3200 - t) / 800));
      for (const p of pieces) {
        p.vy += 0.32;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += Math.min(p.vy, 7);
        p.spin += p.turn;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.fillStyle = p.color;
        if (p.round) {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2.6, 0, Math.PI * 2);
          ctx.fill();
        } else ctx.fillRect(-p.size / 2, -p.size / 4, p.size, (p.size / 2) * Math.abs(Math.cos(p.spin)) + 1);
        ctx.restore();
      }
      if (t < 3200) frame = requestAnimationFrame(draw);
      else setDone(true);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);
  return done ? null : <canvas ref={canvas} className="confetti" aria-hidden="true" />;
}
