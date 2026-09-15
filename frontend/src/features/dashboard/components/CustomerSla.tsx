'use client';

import { formatDuration } from '@/lib/format';
import type { OrgServiceLevel } from '../types';

/* How fast each organization answered and finished the customer's own cases, against the times it promised, and
   how the customer rated them. Markup: pages/dashboard-customer.css. */

function OnTime({ label, average, pct }: { label: string; average: string; pct: number | null }) {
  return (
    <div className="cdash-sla-row">
      <span className="muted">{label}</span>
      <strong>{average}</strong>
      {pct == null ? (
        <span className="muted">ยังไม่มีข้อมูล</span>
      ) : (
        <span className="project-mini">
          <progress className="project-meter sm" max={100} value={pct} aria-label={`ตรงเวลา ${pct}%`}>
            {pct}%
          </progress>
          ตรงเวลา {pct}%
        </span>
      )}
    </div>
  );
}

export function SlaCards({ orgs }: { orgs: OrgServiceLevel[] }) {
  return (
    <div className="cdash-sla">
      {orgs.map((o) => (
        <section key={o.org_slug} className="card cdash-sla-card">
          <div className="card-header">
            <div>
              <h3>{o.org_name}</h3>
              <p>
                {o.cases} เคส · เปิดอยู่ {o.open}
              </p>
            </div>
            {o.csat_avg != null && (
              <span className="cdash-csat" title="คะแนนความพึงพอใจเฉลี่ยจากแบบสอบถาม">
                ★ {o.csat_avg.toFixed(1)}
                <small>/5</small>
              </span>
            )}
          </div>
          <div className="card-body">
            <OnTime label="ตอบกลับครั้งแรกเฉลี่ย" average={formatDuration(o.first_response_avg_minutes)} pct={o.first_response_on_time_pct} />
            <OnTime
              label="แก้ไขเสร็จเฉลี่ย"
              average={o.resolution_avg_hours == null ? '-' : formatDuration(o.resolution_avg_hours * 60)}
              pct={o.resolution_on_time_pct}
            />
          </div>
        </section>
      ))}
    </div>
  );
}
