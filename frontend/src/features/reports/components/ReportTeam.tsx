'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/ui/display';
import { heatmapParts } from '@/features/dashboard';
import type { TicketRow } from '@/features/tickets/types';
import { relative } from '@/lib/format';
import { useMemberName, useWork } from '@/lib/session';
import { reportTrend } from '../labels';
import { reopening, workload } from '../insights';
import type { ReportExtras, ReportFilter } from '../types';

/* The report's team part: cases that came back after being closed, how the open cases are spread over the team, and
   the busy hours of the period. Markup: pages/report-insights (report-*), the heatmap of pages/automation. */

export function ReopenCard({ all, f }: { all: TicketRow[]; f: ReportFilter }) {
  const now = reopening(all, f);
  const before = reopening(all, f, true);
  const memberName = useMemberName();
  return (
    <section className="card report-card">
      <div className="card-header">
        <div>
          <h2 className="report-title">
            <Icon name="restore" />
            เคสที่ถูกเปิดซ้ำ
          </h2>
          <p>เคสที่แก้ไขเสร็จหรือปิดแล้วแต่กลับมาเปิดอีก เพราะลูกค้าทักกลับหรือทีมเปิดเอง</p>
        </div>
      </div>
      <div className="card-body">
        {now.finished ? (
          <>
            <div className="report-figures">
              <div className={now.rate != null && now.rate >= 15 ? 'warn' : ''}>
                <span>อัตราเปิดซ้ำ</span>
                <strong>{now.rate == null ? '-' : `${now.rate.toFixed(0)}%`}</strong>
                <small>{reportTrend(now.rate, before.rate, '%')}</small>
              </div>
              <div>
                <span>เปิดซ้ำ</span>
                <strong>{now.reopened} เคส</strong>
                <small>จากที่ปิดไป {now.finished} เคส</small>
              </div>
            </div>
            {now.cases.length > 0 ? (
              <>
                <h3 className="report-subhead">เปิดซ้ำล่าสุด</h3>
                <ul className="report-oldest">
                  {now.cases.map((t) => (
                    <li key={t.id}>
                      <Link href={`/tickets/${t.id}`}>
                        <span className="ticket-id">BD-{t.number}</span>
                        <span className="truncate">
                          {t.subject}
                          <small className="muted"> · {memberName(t.assignee_id)} · {relative(t.reopened_at)}</small>
                        </span>
                      </Link>
                      <span className={`report-days${(t.reopens ?? 0) >= 2 ? ' bad' : ''}`}>{t.reopens} ครั้ง</span>
                    </li>
                  ))}
                </ul>
                <p className="tiny muted report-note">อัตราสูงมักแปลว่าปิดเคสเร็วไปก่อนลูกค้าหายสงสัย ลองถามลูกค้าก่อนปิดว่าเรียบร้อยแล้วหรือยัง</p>
              </>
            ) : (
              <p className="empty-mini">ไม่มีเคสที่ถูกเปิดซ้ำในช่วงนี้ ✨</p>
            )}
          </>
        ) : (
          <p className="empty-mini">ยังไม่มีเคสที่แก้ไขเสร็จในช่วงนี้</p>
        )}
      </div>
    </section>
  );
}

export function WorkloadCard({ all, f }: { all: TicketRow[]; f: ReportFilter }) {
  const work = useWork();
  const memberName = useMemberName();
  const load = workload(all, f, work.members);
  const most = Math.max(1, ...load.people.map((p) => p.open), load.unassigned);
  const heavy = load.people.filter(load.heavy);
  return (
    <section className="card report-card">
      <div className="card-header">
        <div>
          <h2 className="report-title">
            <Icon name="users" />
            ภาระงานของทีม
          </h2>
          <p>เคสที่ยังไม่เสร็จตอนนี้ของแต่ละคน · เฉลี่ยคนละ {load.average.toFixed(1)} เคส</p>
        </div>
      </div>
      {heavy.length > 0 && (
        <p className="notice warning report-hint">
          <Icon name="bolt" />
          <span>
            {heavy.map((p) => memberName(p.id)).join(', ')} ถือเคสมากกว่าค่าเฉลี่ยของทีมมาก · ลองกระจายเคสให้คนที่ว่างกว่า
          </span>
        </p>
      )}
      <div className="card-body">
        {load.people.length || load.unassigned ? (
          <ul className="report-load">
            {load.people.map((p, i) => (
              <li key={p.id} className={load.heavy(p) ? 'heavy' : ''}>
                <span className="report-load-name">
                  <Avatar name={memberName(p.id)} index={i} />
                  <span className="truncate">{memberName(p.id)}</span>
                </span>
                <progress className="report-share" value={p.open} max={most} aria-label={`${memberName(p.id)} ${p.open} เคส`} />
                <span className="report-load-count">
                  <strong>{p.open}</strong>
                  {p.late > 0 && <span className="badge suspended">เกิน SLA {p.late}</span>}
                  {p.urgent > 0 && <span className="badge">ด่วน {p.urgent}</span>}
                </span>
              </li>
            ))}
            {load.unassigned > 0 && (
              <li className="unassigned">
                <span className="report-load-name">
                  <span className="report-load-none">
                    <Icon name="inbox" />
                  </span>
                  <span className="truncate">ยังไม่มีคนรับ</span>
                </span>
                <progress className="report-share" value={load.unassigned} max={most} aria-label={`ยังไม่มีคนรับ ${load.unassigned} เคส`} />
                <span className="report-load-count">
                  <strong>{load.unassigned}</strong>
                </span>
              </li>
            )}
          </ul>
        ) : (
          <p className="empty-mini">ยังไม่มีสมาชิกในทีมนี้</p>
        )}
      </div>
    </section>
  );
}

export function BusyHoursCard({ hours, f }: { hours: ReportExtras['hours'] | undefined; f: ReportFilter }) {
  if (!hours) return null;
  const heat = heatmapParts({ weeks: 1, counts: hours.counts }, true);
  return (
    <section className="card report-card">
      <div className="card-header">
        <div>
          <h2 className="report-title">
            <Icon name="calendar" />
            ช่วงเวลาที่ลูกค้าติดต่อเข้ามา
          </h2>
          <p>
            บทสนทนาใหม่ {hours.total} เรื่องในช่วงนี้ (ทุกช่องทาง{f.team ? ' ของทีมที่เลือก' : ''}) · แยกตามวันและชั่วโมงตามเวลาเครื่องของคุณ
          </p>
        </div>
      </div>
      <div className="card-body">
        {hours.total ? (
          <>
            <div className="heatmap-scroll">
              <div className="heatmap" role="img" aria-label={heat.summary}>
                <span className="heat-corner" />
                {Array.from({ length: 24 }, (_, h) => (
                  <span key={`h${h}`} className="heat-hour">
                    {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
                  </span>
                ))}
                {heat.rows.map((row) => [
                  <span key={`d${row.day}`} className="heat-day">
                    {row.day}
                  </span>,
                  ...row.cells.map((cell, h) => <span key={`${row.day}${h}`} className={`heat-cell lv-${cell.level}`} title={cell.tip} />),
                ])}
              </div>
            </div>
            <div className="heat-legend" aria-hidden="true">
              <span>น้อย</span>
              <i className="lv-0" />
              <i className="lv-1" />
              <i className="lv-2" />
              <i className="lv-3" />
              <i className="lv-4" />
              <span>มาก</span>
            </div>
            <div className="peak-grid">
              <div>
                <h3>ช่วงพีค (ช่วงละ 3 ชั่วโมง)</h3>
                <ol className="peak-list">
                  {heat.peaks.map((p) => (
                    <li key={p.label}>
                      <strong>{p.label}</strong>
                      <span className="tiny muted">{p.detail}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <h3>คำแนะนำจัดกะ</h3>
                <ul className="peak-list">
                  {heat.advice.map((p) => (
                    <li key={p.label}>
                      <strong>{p.label}</strong>
                      <span className="tiny muted">{p.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        ) : (
          <p className="empty-mini">ยังไม่มีลูกค้าติดต่อเข้ามาในช่วงนี้</p>
        )}
      </div>
    </section>
  );
}
