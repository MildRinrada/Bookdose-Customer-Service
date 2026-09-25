'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import type { TicketRow } from '@/features/tickets/types';
import { date, formatDuration, relative, starsText } from '@/lib/format';
import { channelIcons, channelNames } from '@/lib/labels';
import { reportTrend } from '../labels';
import { backlog, bySource, firstResponse, longDuration, resolution, satisfaction, type SourceRow } from '../insights';
import type { ReportFilter } from '../types';

/* The service report's second half (insights.ts): time to solve, customer satisfaction, where the cases come from
   and how long the open ones have waited. Markup: pages/reports (report-*). */

function Bar({ label, count, max, tone = '', note }: { label: ReactNode; count: number; max: number; tone?: string; note?: string }) {
  return (
    <div className={`bar-row${tone ? ` ${tone}` : ''}`} title={`${count}${note ? ` · ${note}` : ''}`}>
      <span className="bar-label">{label}</span>
      <progress value={count} max={Math.max(1, max)} aria-label={`${typeof label === 'string' ? label : ''} ${count}`} />
      <span className="bar-value">
        {count}
        {note && <small className="muted"> · {note}</small>}
      </span>
    </div>
  );
}

type Times = { median: number | null; p90: number | null; avg: number | null; sla: number | null };

/* The typical time (median), the time nine in ten were within (P90), the average and how many were in time: the
   average alone is pulled up by the few cases left for days, so it is never shown by itself. */
function TimeFigures({ now, before, done }: { now: Times; before: Times; done: string }) {
  const hours = (m: number | null) => m && m / 60;
  return (
    <div className="report-figures four">
      <div>
        <span>ครึ่งหนึ่ง{done}ภายใน</span>
        <strong>{longDuration(now.median)}</strong>
        <small>ค่ากลาง · {reportTrend(hours(now.median), hours(before.median), 'ชม.')}</small>
      </div>
      <div>
        <span>9 ใน 10 เคส{done}ภายใน</span>
        <strong>{longDuration(now.p90)}</strong>
        <small>P90 · {reportTrend(hours(now.p90), hours(before.p90), 'ชม.')}</small>
      </div>
      <div>
        <span>เฉลี่ย</span>
        <strong>{longDuration(now.avg)}</strong>
        <small>{reportTrend(hours(now.avg), hours(before.avg), 'ชม.')}</small>
      </div>
      <div className={now.sla != null && now.sla < 80 ? 'warn' : ''}>
        <span>{done}ทันกำหนด</span>
        <strong>{now.sla == null ? '-' : `${now.sla.toFixed(0)}%`}</strong>
        <small>{reportTrend(now.sla, before.sla, '%')}</small>
      </div>
    </div>
  );
}

export function FirstResponseCard({ all, f }: { all: TicketRow[]; f: ReportFilter }) {
  const now = firstResponse(all, f);
  const before = firstResponse(all, f, true);
  return (
    <section className="card report-card">
      <div className="card-header">
        <div>
          <h2>เวลาตอบกลับครั้งแรก</h2>
          <p>
            เคสที่เปิดในช่วงนี้และตอบแล้ว {now.count} เคส{now.waiting ? ` · ยังไม่ได้ตอบ ${now.waiting} เคส (ไม่นับ)` : ''} · นับจากเปิดเคสจนทีมตอบครั้งแรก
          </p>
        </div>
        <Icon name="clock" />
      </div>
      <div className="card-body">
        {now.count ? (
          <>
            <TimeFigures now={now} before={before} done="ตอบ" />
            {now.buckets.map((b) => (
              <Bar key={b.label} label={b.label} count={b.count} max={now.count} note={`${((100 * b.count) / now.count).toFixed(0)}%`} />
            ))}
          </>
        ) : (
          <p className="empty-mini">ยังไม่มีเคสที่ตอบแล้วในช่วงนี้</p>
        )}
      </div>
    </section>
  );
}

export function ResolutionCard({ all, f }: { all: TicketRow[]; f: ReportFilter }) {
  const now = resolution(all, f);
  const before = resolution(all, f, true);
  return (
    <section className="card report-card">
      <div className="card-header">
        <div>
          <h2>เวลาแก้ไขเคสจนเสร็จ</h2>
          <p>เคสที่แก้ไขเสร็จในช่วงนี้ {now.count} เคส · นับจากเปิดเคสจนแก้ไขเสร็จ</p>
        </div>
        <Icon name="checkCircle" />
      </div>
      <div className="card-body">
        {now.count ? (
          <>
            <TimeFigures now={now} before={before} done="เสร็จ" />
            {now.buckets.map((b) => (
              <Bar key={b.label} label={b.label} count={b.count} max={now.count} note={`${((100 * b.count) / now.count).toFixed(0)}%`} />
            ))}
          </>
        ) : (
          <p className="empty-mini">ยังไม่มีเคสที่แก้ไขเสร็จในช่วงนี้</p>
        )}
      </div>
    </section>
  );
}

export function SatisfactionCard({ all, f }: { all: TicketRow[]; f: ReportFilter }) {
  const s = satisfaction(all, f);
  const before = satisfaction(all, f, true);
  const most = Math.max(1, ...s.stars.map((x) => x.count));
  return (
    <section className="card report-card">
      <div className="card-header">
        <div>
          <h2>ความพึงพอใจลูกค้า (CSAT)</h2>
          <p>คำตอบแบบประเมินที่ได้รับในช่วงนี้ {s.count} คำตอบ</p>
        </div>
        <Icon name="star" />
      </div>
      <div className="card-body">
        {s.count ? (
          <>
            <div className="report-figures">
              <div>
                <span>คะแนนเฉลี่ย</span>
                <strong>
                  {s.average!.toFixed(1)}
                  <em className="report-stars" aria-hidden="true">
                    {starsText(Math.round(s.average!))}
                  </em>
                </strong>
                <small>{reportTrend(s.average, before.average, 'คะแนน')}</small>
              </div>
              <div className={s.satisfied != null && s.satisfied < 70 ? 'warn' : ''}>
                <span>พอใจ (4-5 ดาว)</span>
                <strong>{s.satisfied!.toFixed(0)}%</strong>
                <small>{reportTrend(s.satisfied, before.satisfied, '%')}</small>
              </div>
            </div>
            {s.stars.map((x) => (
              <Bar key={x.star} label={`${x.star} ★`} count={x.count} max={most} tone={`stars-${x.star}`} />
            ))}
            {s.weeks.length > 1 && (
              <div className="report-weeks" aria-label="คะแนนเฉลี่ยตามช่วงเวลา">
                {s.weeks.map((w) => (
                  <div key={w.start.toISOString()} className="report-week" title={`ช่วงเริ่ม ${date(w.start)} · ${w.count} คำตอบ`}>
                    <span className={`report-week-score${w.average == null ? ' none' : w.average < 3 ? ' low' : ''}`}>
                      {w.average == null ? '–' : w.average.toFixed(1)}
                    </span>
                    <span className="report-week-day">{date(w.start)}</span>
                  </div>
                ))}
              </div>
            )}
            {s.comments.length > 0 && (
              <>
                <h3 className="report-subhead">ความเห็นจากลูกค้า (คะแนนต่ำขึ้นก่อน)</h3>
                <ul className="report-comments">
                  {s.comments.map((c) => (
                    <li key={c.ticket.id} className={c.rating <= 2 ? 'low' : ''}>
                      <span className="report-comment-stars">{'★'.repeat(c.rating)}</span>
                      <span className="report-comment-body">
                        {c.comment ? `“${c.comment}”` : <span className="muted">ไม่ได้เขียนความเห็น</span>}
                        <Link href={`/tickets/${c.ticket.id}`}>
                          BD-{c.ticket.number} · {c.ticket.contact_name} · {relative(c.at)}
                        </Link>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : (
          <p className="empty-mini">ยังไม่มีคำตอบแบบประเมินในช่วงนี้ · ระบบส่งให้ลูกค้าเมื่อปิดเคส (ตั้งค่าได้ที่ระบบอัตโนมัติ)</p>
        )}
      </div>
    </section>
  );
}

function SourceTable({ rows, kind }: { rows: SourceRow[]; kind: 'channel' | 'category' }) {
  const total = rows.reduce((n, r) => n + r.total, 0);
  return (
    <div className="table-scroll">
      <table className="report-source">
        <thead>
          <tr>
            <th>{kind === 'channel' ? 'ช่องทาง' : 'หมวดหมู่'}</th>
            <th>เคส</th>
            <th>ยังดูแลอยู่</th>
            <th>เกิน SLA</th>
            <th>ตอบแรกเฉลี่ย</th>
            <th>ตอบทัน SLA</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>
                <span className="report-source-name">
                  {kind === 'channel' && <Icon name={channelIcons[r.key] ?? 'chat'} />}
                  {kind === 'channel' ? (channelNames[r.key] ?? r.key) : r.key}
                </span>
                <progress className="report-share" value={r.total} max={Math.max(1, total)} aria-hidden="true" />
              </td>
              <td>
                <strong>{r.total}</strong> <small className="muted">{((100 * r.total) / Math.max(1, total)).toFixed(0)}%</small>
              </td>
              <td>{r.open}</td>
              <td>{r.late ? <span className="badge suspended">{r.late}</span> : <span className="muted">0</span>}</td>
              <td>{formatDuration(r.avg)}</td>
              <td className={r.sla != null && r.sla < 80 ? 'report-low' : ''}>{r.sla == null ? '-' : `${r.sla.toFixed(0)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SourcesCard({ tickets }: { tickets: TicketRow[] }) {
  const channels = bySource(tickets, 'channel');
  const categories = bySource(tickets, 'category');
  const worst = [...channels, ...categories].filter((r) => r.total >= 3 && r.sla != null).sort((a, b) => (a.sla ?? 100) - (b.sla ?? 100))[0];
  return (
    <section className="card report-card">
      <div className="card-header">
        <div>
          <h2>เคสมาจากไหน</h2>
          <p>แยกตามช่องทางที่ลูกค้าติดต่อเข้ามา และหมวดหมู่ของเรื่อง</p>
        </div>
        <Icon name="chart" />
      </div>
      {worst && worst.sla != null && worst.sla < 80 && (
        <p className="notice warning report-hint">
          <Icon name="clock" />
          <span>
            “{channelNames[worst.key] ?? worst.key}” ตอบทัน SLA เพียง {worst.sla.toFixed(0)}% · ลองจัดคนดูแลช่องทางหรือหมวดนี้เพิ่ม
          </span>
        </p>
      )}
      <SourceTable rows={channels} kind="channel" />
      <SourceTable rows={categories} kind="category" />
    </section>
  );
}

export function BacklogCard({ all, f }: { all: TicketRow[]; f: ReportFilter }) {
  const b = backlog(all, f);
  return (
    <section className="card report-card">
      <div className="card-header">
        <div>
          <h2>เคสค้างนานแค่ไหน</h2>
          <p>เคสที่ยังไม่เสร็จตอนนี้ {b.total} เคส (ทุกช่วงเวลา) · แยกตามจำนวนวันที่รอ</p>
        </div>
        <Icon name="clock" />
      </div>
      <div className="card-body">
        {b.total ? (
          <>
            <div className="report-aging">
              {b.buckets.map((x) => (
                <div key={x.label} className={`report-age ${x.tone}${x.count ? '' : ' zero'}`}>
                  <strong>{x.count}</strong>
                  <span>{x.label}</span>
                </div>
              ))}
            </div>
            <h3 className="report-subhead">รอนานที่สุด</h3>
            <ul className="report-oldest">
              {b.oldest.map(({ t, days }) => (
                <li key={t.id}>
                  <Link href={`/tickets/${t.id}`}>
                    <span className="ticket-id">BD-{t.number}</span>
                    <span className="truncate">{t.subject}</span>
                  </Link>
                  <span className={`report-days${days >= 7 ? ' bad' : days >= 3 ? ' warn' : ''}`}>{days < 1 ? 'วันนี้' : `${Math.floor(days)} วัน`}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="empty-mini">ไม่มีเคสค้าง ✨</p>
        )}
      </div>
    </section>
  );
}
