'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { PriorityTag } from '@/components/ui/display';
import type { NeededItem } from '../labels';

/* SLA Watch (was "เคสที่ต้องดำเนินการทันที"): the cases to act on now, each with a clock that ticks every second -
   red and counting up once its SLA has passed, amber and counting down in the last two hours - then the ones whose
   customer answered last or that are urgent without an owner. Markup: pages/dashboard-widgets (sla-watch). */

/** "01:12:05", or "2 วัน 03:12" past a day. */
function clock(ms: number) {
  const total = Math.floor(Math.abs(ms) / 1000);
  const days = Math.floor(total / 86400);
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  return days ? `${days} วัน ${pad(h)}:${pad(m)}` : `${pad(h)}:${pad(m)}:${pad(total % 60)}`;
}

export function SlaWatch({ needed, shown }: { needed: NeededItem[]; shown: number }) {
  const [now, setNow] = useState(() => Date.now());
  const ticking = needed.some((n) => n.tone !== 'info');
  useEffect(() => {
    if (!ticking) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [ticking]);
  const late = needed.filter((n) => n.tone === 'danger').length;
  const more = Math.max(0, needed.length - shown);

  return (
    <section className="card action-needed sla-watch" aria-labelledby="sla-watch-title">
      <div className="card-header">
        <div>
          <h2 id="sla-watch-title">SLA Watch</h2>
          <p>{needed.length ? `เกินแล้ว ${late} · ใกล้ครบหรือรอคุณ ${needed.length - late}` : 'เคสที่ต้องดำเนินการทันที'}</p>
        </div>
        <span className={`badge${late ? ' suspended' : needed.length ? ' pending_customer' : ''}`}>{needed.length} เคส</span>
      </div>
      <div className="card-body">
        {needed.length ? (
          <ul className="sla-watch-list">
            {needed.slice(0, shown).map(({ t, reason, tone, symbol, due }) => (
              <li key={t.id} className={`sla-watch-item ${tone}`}>
                {tone === 'info' ? (
                  <span className="sla-timer info" aria-hidden="true">
                    <Icon name={symbol} />
                  </span>
                ) : (
                  <span className="sla-timer" title={tone === 'danger' ? 'เกิน SLA มาแล้ว' : 'เหลือเวลาก่อนครบ SLA'}>
                    <small>{tone === 'danger' ? 'เกินมา' : 'เหลือ'}</small>
                    {clock(due - now)}
                  </span>
                )}
                <div className="sla-watch-body">
                  <div className="flex between">
                    <span className="ticket-id">BD-{t.number}</span>
                    <PriorityTag value={t.priority} />
                  </div>
                  <Link href={`/tickets/${t.id}`} className="truncate">
                    {t.subject}
                  </Link>
                  <span className="sla-watch-reason">{reason.split(' · ')[0]}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-mini">ไม่มีเคสที่ต้องเร่งดำเนินการ ✨</div>
        )}
        {more > 0 && (
          <Link className="small" href="/tickets?filter=active">
            ดูอีก {more} เคส →
          </Link>
        )}
      </div>
    </section>
  );
}
