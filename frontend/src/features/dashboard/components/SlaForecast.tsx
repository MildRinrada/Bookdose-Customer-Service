'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { PriorityTag } from '@/components/ui/display';
import { clockTime, formatDuration } from '@/lib/format';
import { useMemberName } from '@/lib/session';
import type { SlaForecast as Forecast } from '../types';

/* คาดว่าจะเกิน SLA: the cases that have not broken their SLA yet but will at the pace the team is going - the queue in
   front of each and how many cases an hour are being cleared (backend/modules/automation/forecast.py). SLA Watch
   says what is late or due now; this says what will be, early enough to move a case to someone free or take it
   first. Markup: pages/dashboard-widgets (sla-watch, sla-forecast). */

const KIND = { response: 'ตอบครั้งแรก', resolution: 'ปิดเคส' } as const;

/** "~3 เคส/ชม." (one decimal below ten), or per day when under one an hour: "~0 เคส/ชม." tells nobody anything. */
function pace(perHour: number) {
  if (perHour >= 1) return `~${perHour < 10 ? perHour.toFixed(1).replace(/\.0$/, '') : Math.round(perHour)} เคส/ชม.`;
  const perDay = perHour * 24;
  return perDay >= 1 ? `~${perDay < 10 ? perDay.toFixed(1).replace(/\.0$/, '') : Math.round(perDay)} เคส/วัน` : 'ไม่ถึง 1 เคส/วัน';
}

/** "15:40", or "พรุ่งนี้ 09:10" / "26 ก.ย. 09:10" when not today. */
function when(iso: string) {
  const at = new Date(iso);
  const days = Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5);
  if (days === 0) return clockTime(at);
  if (days === 1) return `พรุ่งนี้ ${clockTime(at)}`;
  return `${new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' }).format(at)} ${clockTime(at)}`;
}

export function SlaForecast({ forecast, shown }: { forecast: Forecast | null | undefined; shown: number }) {
  const memberName = useMemberName();
  const [all, setAll] = useState(false);
  const cases = forecast?.cases ?? [];
  const list = all ? cases : cases.slice(0, shown);
  const more = cases.length - list.length;

  return (
    <section className="card action-needed sla-watch sla-forecast" aria-labelledby="sla-forecast-title">
      <div className="card-header">
        <div>
          <h2 id="sla-forecast-title">คาดว่าจะเกิน SLA</h2>
          <p>
            จากคิวและความเร็วทีมตอนนี้
            {forecast?.response_per_hour ? ` · ทีมตอบครั้งแรก ${pace(forecast.response_per_hour)}` : ''}
          </p>
        </div>
        <span className={`badge${cases.length ? ' pending_customer' : ''}`}>{cases.length} เคส</span>
      </div>
      <div className="card-body">
        {list.length ? (
          <ul className="sla-watch-list">
            {list.map((f) => (
              <li key={f.id} className="sla-watch-item warn">
                <span className="sla-timer" title={`คาดว่าจะ${KIND[f.kind]}ช้ากว่ากำหนด`}>
                  <small>ช้าราว</small>
                  {formatDuration(f.late_minutes)}
                </span>
                <div className="sla-watch-body">
                  <div className="flex between">
                    <span className="ticket-id">BD-{f.number}</span>
                    <PriorityTag value={f.priority} />
                  </div>
                  <Link href={`/tickets/${f.id}`} className="truncate">
                    {f.subject}
                  </Link>
                  <span className="sla-watch-reason">
                    {KIND[f.kind]} · คิวก่อนหน้า {f.ahead} เคส · {pace(f.per_hour)}
                  </span>
                  <span className="sla-watch-reason">
                    คาดว่า {when(f.expected)} · กำหนด {when(f.due)} · {f.assignee_id ? memberName(f.assignee_id) : 'ยังไม่มีผู้รับ'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : forecast?.unknown ? (
          <div className="empty-mini">ยังคำนวณไม่ได้ · ทีมยังไม่มีการตอบหรือปิดเคสใน 7 วันที่ผ่านมา</div>
        ) : (
          <div className="empty-mini forecast-clear">
            <Icon name="checkCircle" />
            ตามความเร็วตอนนี้ ทุกเคสทันกำหนด
          </div>
        )}
        {(more > 0 || all) && cases.length > shown && (
          <button type="button" className="btn subtle small forecast-more" onClick={() => setAll(!all)}>
            {all ? 'แสดงน้อยลง' : `ดูอีก ${more} เคส`}
          </button>
        )}
      </div>
    </section>
  );
}
