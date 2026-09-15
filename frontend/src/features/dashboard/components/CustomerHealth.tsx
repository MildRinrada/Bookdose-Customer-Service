'use client';

import Link from 'next/link';
import { CustomerNone } from '@/components/ui/display';
import { date } from '@/lib/format';
import { healthStateLabels, healthStates, healthStateTones } from '../labels';
import type { CustomerDashboard, ProjectHealth } from '../types';

/* The health of each signed project: its state against the plan (contracts/health.py on the server), the work done
   next to the work that should be done by today, the next delivery and the late ones. Markup: pages/dashboard-customer.css. */

export function HealthSummary({ summary }: { summary: CustomerDashboard['health']['summary'] }) {
  return (
    <ul className="cdash-health-summary" aria-label="สรุปสถานะโครงการ">
      {healthStates.map((s) => (
        <li key={s}>
          <span className={`customer-state tone-${healthStateTones[s]}`}>{healthStateLabels[s]}</span>
          <strong>{summary[s]}</strong>
        </li>
      ))}
    </ul>
  );
}

function Meter({ label, value, planned = false }: { label: string; value: number; planned?: boolean }) {
  return (
    <div className="cdash-meter">
      <span className="muted">{label}</span>
      <progress className={`project-meter sm${planned ? ' cdash-planned' : ''}`} max={100} value={value} aria-label={`${label} ${value}%`}>
        {value}%
      </progress>
      <strong>{value}%</strong>
    </div>
  );
}

function HealthNote({ p }: { p: ProjectHealth }) {
  if (p.finished_at) return <span className="muted">ส่งมอบครบ {date(p.finished_at)}{p.final_due ? ` · กำหนดเสร็จ ${date(p.final_due)}` : ''}</span>;
  return (
    <>
      {p.next && (
        <span className="muted">
          งวดถัดไป: {p.next.title}
          {p.next.due_date ? ` · ครบกำหนด ${date(p.next.due_date)}` : ''}
        </span>
      )}
      {p.late.map((l) => (
        <span key={l.title} className="cdash-late">
          ล่าช้า {l.days_late} วัน: {l.title} (กำหนด {date(l.due_date)})
        </span>
      ))}
    </>
  );
}

export function HealthList({ projects }: { projects: ProjectHealth[] }) {
  if (!projects.length) return <CustomerNone title="ไม่มีโครงการในองค์กรนี้" hint="เลือก “ทุกองค์กร” เพื่อดูทั้งหมด" />;
  return (
    <ul className="cdash-health">
      {projects.map((p) => {
        const gap = p.progress - p.planned;
        return (
          <li key={`${p.org_slug}:${p.contract_id}`}>
            <div className="cdash-health-head">
              <div className="grow">
                <Link className="customer-case-title" href={`/customer/documents/${p.org_slug}/${p.contract_id}`} title={p.title}>
                  {p.title}
                </Link>
                <span className="customer-case-id">
                  {p.reference} · {p.org_name}
                </span>
              </div>
              <span className={`customer-state tone-${healthStateTones[p.state]}`}>{healthStateLabels[p.state]}</span>
            </div>
            <div className="cdash-meters">
              <Meter label="ผลงานจริง" value={p.progress} />
              <Meter label="ตามแผน" value={p.planned} planned />
            </div>
            <div className="cdash-health-notes">
              {!p.finished_at && p.state !== 'not_started' && gap !== 0 && (
                <span className={gap < 0 ? 'cdash-late' : 'cdash-good'}>
                  {gap < 0 ? `ช้ากว่าแผน ${-gap}%` : `เร็วกว่าแผน ${gap}%`}
                </span>
              )}
              <HealthNote p={p} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
