'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/ui/Toast';
import { download } from '@/lib/api/client';
import { Avatar, ChartColumn, EmptyState, StatCard } from '@/components/ui/display';
import { FilterPill } from '@/components/ui/filters';
import { Form } from '@/components/ui/Form';
import { visibleTeams } from '@/components/ui/pickers';
import { usePreferences } from '@/features/staff-account/prefs';
import { useDownloadTicketsCSV } from '@/features/tickets/csv';
import type { TicketRow } from '@/features/tickets/types';
import { date, formatDuration } from '@/lib/format';
import { priorityLabels, statusLabels } from '@/lib/labels';
import { useApi } from '@/lib/query';
import { useMemberName, useStaffTickets, useWork } from '@/lib/session';
import { useUiState } from '@/lib/ui-state';
import { ArticlesCard, AssistantReportCard, BotReportCard } from './components/ReportAi';
import { HISTORY_NEEDED, HISTORY_WEEKS, unusualDays, type DayFlag } from './analysis';
import { PivotCard, SpeedSatisfactionCard } from './components/ReportAnalysis';
import { ConversationCard, MoodCard } from './components/ReportConversation';
import { ReportDocument } from './components/ReportDocument';
import { ForecastCard } from './components/ReportForecast';
import { GoalsCard } from './components/ReportGoals';
import { reaches, targetsFor, useGoals } from './goals';
import { forecast } from './forecast';
import { BacklogCard, FirstResponseCard, ResolutionCard, SatisfactionCard } from './components/ReportInsights';
import { StaffingCard } from './components/ReportStaffing';
import { TagBarsCard } from './components/ReportTags';
import { BusyHoursCard, ReopenCard, WorkloadCard } from './components/ReportTeam';
import {
  defaultReportFilter,
  reportDatasetPath,
  reportExtrasPath,
  reportMetrics,
  reportRange,
  reportRanges,
  reportTickets,
  reportTrend,
} from './labels';
import type { ReportExtras, ReportFilter } from './types';

/** Who may take the period's tables away (backend reports/service.LEADS). */
const LEADS = ['admin', 'manager'];

/* Service report: a period to look at, the numbers for it against the period before, the shape of the work
   (per day, by status, by priority) and how the team did. Built from the case list (/api/tickets), which the
   server already limits to what the member may see. Markup: pages/reports/reports, bar-row, person-row. */

export function ReportsScreen() {
  const work = useWork();
  const memberName = useMemberName();
  const saveCSV = useDownloadTicketsCSV();
  const loaded = useStaffTickets().data?.tickets as TicketRow[] | undefined;
  const [f, setFilter] = useUiState<ReportFilter>('reports:filter', defaultReportFilter());
  const extras = useApi<ReportExtras>(reportExtrasPath(f), { keepPrevious: true }).data;
  // Each case with what only its messages tell (next-reply waits, replies, how upset its customer got).
  const caseStats = extras?.case_stats;
  const all = useMemo(() => (loaded ?? []).map((t) => (caseStats?.[t.id] ? { ...t, stats: caseStats[t.id] } : t)), [loaded, caseStats]);
  const owner = work.role === 'admin' && !work.read_only;
  const prefs = usePreferences(owner).data;
  const weeklyOn = Boolean(prefs?.preferences.notify.email && prefs.preferences.notify.events.weekly_report);
  const slaTarget = targetsFor(useGoals(), f.team || (work.role === 'agent' ? (work.team_id ?? '') : '')).response_sla;
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  // พยากรณ์จำนวนเคส of the team picked, from today whatever the period: the forecast card and the staffing card.
  const ahead = useMemo(() => forecast(f.team ? all.filter((t) => t.team_id === f.team) : all), [all, f.team]);

  const tickets = reportTickets(all, f);
  const m = reportMetrics(tickets);
  const earlier = reportTickets(all, f, true);
  const before = reportMetrics(earlier);
  const days = Math.max(1, Math.round((new Date(f.to).getTime() - new Date(f.from).getTime()) / 86400000) + 1);
  const counts = [...Array(days)].map((_, i) => {
    const day = new Date(f.from + 'T00:00:00');
    day.setDate(day.getDate() + i);
    return { day, count: tickets.filter((t) => new Date(t.created_at).toDateString() === day.toDateString()).length };
  });
  const max = Math.max(1, ...counts.map((c) => c.count));
  const busiest = counts.reduce((a, b) => (b.count > a.count ? b : a), counts[0]);
  // วันที่ผิดปกติ: against the same weekday before, over every case of the team and owner picked (not only the period).
  const unusual = unusualDays(
    all.filter((t) => (!f.team || t.team_id === f.team) && (!f.assignee || t.assignee_id === f.assignee)),
    counts,
  );
  const flagged = [...unusual.flags.values()];

  const bars = (labels: Record<string, string>, key: 'status' | 'priority', tone: string) =>
    Object.entries(labels).map(([value, label]) => {
      const count = tickets.filter((t) => t[key] === value).length;
      const pct = (tickets.length ? (100 * count) / tickets.length : 0).toFixed(1);
      return (
        <div key={value} className="bar-row" title={`${count} เคส (${pct}%)`}>
          <span className="bar-label">
            <span className={`bar-swatch ${tone}-${value}`} />
            {label}
          </span>
          <progress value={count} max={tickets.length || 1} aria-label={`${label}: ${count} เคส (${pct}%)`} />
          <span className="bar-value">
            {count}
            <small className="muted"> · {pct}%</small>
          </span>
        </div>
      );
    });

  const range = (value: string) => {
    const n = Number(value);
    setFilter({ ...f, ...reportRange(n), days: n });
  };

  const submit = (values: Record<string, string>) => {
    if (values.from > values.to) throw new Error('วันเริ่มต้นต้องไม่อยู่หลังวันสิ้นสุด');
    setFilter({ from: values.from, to: values.to, team: values.team ?? '', assignee: values.assignee ?? '', days: 0 });
  };

  return (
    <>
      <div className="page-heading report-heading">
        <div>
          <h1>รายงานการบริการ</h1>
          <p>
            {date(f.from)} - {date(f.to)} · เทียบกับช่วงก่อนหน้าที่ยาวเท่ากัน
          </p>
          {owner && prefs && (
            <p className="report-weekly-note">
              <Icon name="mail" />
              {weeklyOn ? (
                <span>ส่งสรุปรายสัปดาห์ทางอีเมลให้คุณทุกวันจันทร์ 8 โมง</span>
              ) : (
                <span>
                  รับสรุปรายสัปดาห์ทางอีเมลทุกวันจันทร์ได้ เปิดที่ <Link href="/account?tab=notifications">ตั้งค่าบัญชี → การแจ้งเตือน</Link>
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex wrap report-actions">
          <button type="button" className="btn subtle" onClick={() => window.print()}>
            <Icon name="file" />
            พิมพ์หรือบันทึก PDF
          </button>
          <button type="button" className="btn subtle" onClick={() => saveCSV(tickets, 'report-tickets.csv')}>
            <Icon name="download" />
            ดาวน์โหลด CSV
          </button>
          {LEADS.includes(work.role) && (
            <button
              type="button"
              className="btn"
              disabled={exporting}
              title="ตารางเคส บทสนทนา ข้อความ (ไม่มีเนื้อความ) CSAT การเปิดซ้ำ และการยกระดับ ของช่วงที่เลือก พร้อมคำอธิบายทุกคอลัมน์ ไม่มีชื่อหรือช่องทางติดต่อลูกค้า"
              onClick={() => {
                setExporting(true);
                void download(reportDatasetPath(f), `bookdose-dataset-${f.from}-${f.to}.zip`)
                  .then(() => toast('ดาวน์โหลดชุดข้อมูลแล้ว'))
                  .catch((error: Error) => toast(error.message, true))
                  .finally(() => setExporting(false));
              }}
            >
              <Icon name="download" />
              {exporting ? 'กำลังเตรียมไฟล์…' : 'ชุดข้อมูลสำหรับวิเคราะห์ (ZIP)'}
            </button>
          )}
        </div>
      </div>
      {/* Keyed by the filter so the fields show a range picked with the pills. */}
      <Form key={`${f.from}|${f.to}|${f.team}|${f.assignee}`} className="filters report-filters" onSubmit={submit}>
        <div className="filter-pills" role="group" aria-label="ช่วงเวลา">
          {Object.entries(reportRanges).map(([value, label]) => (
            <FilterPill key={value} value={value} label={label} pressed={String(f.days) === value} onClick={range} />
          ))}
        </div>
        <div className="report-fields">
          <label className="report-field">
            <span>ตั้งแต่</span>
            <input type="date" name="from" defaultValue={f.from} required />
          </label>
          <label className="report-field">
            <span>ถึง</span>
            <input type="date" name="to" defaultValue={f.to} required />
          </label>
          <label className="report-field">
            <span>ทีม</span>
            <select name="team" defaultValue={f.team}>
              <option value="">ทุกทีมที่มีสิทธิ์</option>
              {visibleTeams(work).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="report-field">
            <span>ผู้รับผิดชอบ</span>
            <select name="assignee" defaultValue={f.assignee}>
              <option value="">ทุกคนที่มีสิทธิ์</option>
              {work.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" type="submit">
            แสดงรายงาน
          </button>
        </div>
      </Form>
      {m.late > 0 && (
        <Link className="notice warning report-alert" href="/tickets?filter=overdue">
          <Icon name="clock" />
          ช่วงนี้มี {m.late} เคสเกิน SLA · เปิดรายการเคสเกิน SLA ทั้งหมด <Icon name="arrow" />
        </Link>
      )}
      {m.total ? (
        <>
          <div className="stats-grid">
            <StatCard label="เคสทั้งหมด" value={m.total} icon="ticket" foot={reportTrend(m.total, before.total, 'เคส')} href="/tickets" />
            <StatCard label="ยังดูแลอยู่" value={m.open} icon="users" foot={reportTrend(m.open, before.open, 'เคส')} href="/tickets?filter=active" />
            <StatCard
              label="ตอบกลับครั้งแรก (ค่ากลาง)"
              value={formatDuration(m.median)}
              icon="clock"
              foot={reportTrend(m.median, before.median, 'นาที')}
              href="/tickets"
            />
            <StatCard
              label="ตอบทัน SLA"
              value={m.sla == null ? '-' : m.sla.toFixed(1) + '%'}
              icon="checkCircle"
              // Against the team's goal when there is one (เป้าหมาย below), else the usual 90%.
              color={m.sla != null && (slaTarget != null ? reaches('response_sla', m.sla, slaTarget) : m.sla >= 90) ? 'green' : 'amber'}
              foot={slaTarget != null ? `${reportTrend(m.sla, before.sla, '%')} เป้า ${slaTarget}%` : reportTrend(m.sla, before.sla, '%')}
              href="/tickets?filter=overdue"
            />
          </div>
          <GoalsCard all={all} f={f} />
          <section className="card report-card report-chart">
            <div className="card-header">
              <h2>ปริมาณเคสต่อวัน</h2>
              <span className="muted">{busiest && busiest.count ? `วันที่มากที่สุด ${date(busiest.day)} · ${busiest.count} เคส` : ''}</span>
            </div>
            <div className="card-body">
              <div className="chart">
                {counts.map((c) => {
                  const flag = unusual.flags.get(c.day.toDateString());
                  return (
                    <ChartColumn
                      key={c.day.toDateString()}
                      tip={`${date(c.day)} · ${c.count} เคส${flag ? ` · ${flag.kind === 'high' ? 'มากกว่า' : 'น้อยกว่า'}ปกติ (ปกติราว ${Math.round(flag.typical)})` : ''}`}
                      count={c.count}
                      max={max}
                      day={days <= 31 ? c.day.getDate() : ''}
                      tone={flag?.kind}
                    />
                  );
                })}
              </div>
              <UnusualDays flagged={flagged} compared={unusual.compared} />
            </div>
          </section>
          <ForecastCard forecast={ahead} team={f.team} />
          {work.role === 'admin' && !work.read_only && <StaffingCard forecast={ahead} all={all} team={f.team} />}
          <div className="report-grid">
            <FirstResponseCard all={all} f={f} />
            <ResolutionCard all={all} f={f} />
          </div>
          <div className="report-grid">
            <ConversationCard all={all} f={f} loading={!caseStats} />
            <MoodCard all={all} f={f} tickets={tickets} loading={!caseStats} />
          </div>
          <div className="report-grid">
            <SatisfactionCard all={all} f={f} />
            <SpeedSatisfactionCard tickets={tickets} />
          </div>
          <PivotCard tickets={tickets} />
          <div className="report-grid">
            <BacklogCard all={all} f={f} />
            <WorkloadCard all={all} f={f} />
          </div>
          <div className="report-grid">
            <ReopenCard all={all} f={f} />
            <div className="report-stack">
              <section className="card">
                <div className="card-header">
                  <h2>เคสตามสถานะ</h2>
                </div>
                <div className="card-body">{bars(statusLabels, 'status', 'status')}</div>
              </section>
              <section className="card">
                <div className="card-header">
                  <h2>เคสตามความเร่งด่วน</h2>
                </div>
                <div className="card-body">{bars(priorityLabels, 'priority', 'priority')}</div>
              </section>
              <TagBarsCard tickets={tickets} before={earlier} />
            </div>
          </div>
          <BusyHoursCard hours={extras?.hours} f={f} />
          {extras?.bot && (
            <>
              <div className="report-section-head">
                <h2>AI และคลังความรู้</h2>
                <p>เห็นเฉพาะผู้ดูแลองค์กร · ทั้งองค์กร ไม่แยกทีม</p>
              </div>
              <div className="report-grid">
                <BotReportCard extras={extras} from={f.from} to={f.to} />
                <ArticlesCard extras={extras} />
                <AssistantReportCard extras={extras} />
              </div>
            </>
          )}
          <section className="card">
            <div className="card-header">
              <h2>ผลงานตามผู้รับผิดชอบ</h2>
              <span className="muted">เรียงตามจำนวนเคสมากที่สุด</span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>ผู้รับผิดชอบ</th>
                    <th>เคสทั้งหมด</th>
                    <th>ยังดูแลอยู่</th>
                    <th>เกิน SLA</th>
                    <th>ตอบกลับเฉลี่ย</th>
                    <th>ตอบทัน SLA</th>
                  </tr>
                </thead>
                <tbody>
                  <PeopleRows tickets={tickets} memberName={memberName} />
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <EmptyState title="ไม่มีเคสในช่วงที่เลือก" description="ลองขยายช่วงวันที่ หรือเลือกทีมอื่น" icon="chart" />
      )}
      <p className="muted">
        SLA และเวลาเฉลี่ยคำนวณจากเคสที่ตอบกลับครั้งแรกแล้ว · เวลาแก้ไขนับเคสที่แก้ไขเสร็จในช่วงนี้ · CSAT นับคำตอบที่ได้รับในช่วงนี้ · เคสค้างและภาระงานนับเคสที่ยังไม่เสร็จตอนนี้
        · การเปิดซ้ำโดยลูกค้านับตั้งแต่วันที่ 19 ก.ย. 2569 (ก่อนหน้านั้นนับเฉพาะที่ทีมเปิดเอง)
        ส่วนช่วงก่อนหน้ามีจำนวนวันเท่ากับช่วงที่เลือก ข้อมูลและ CSV จำกัดตามสิทธิ์องค์กรและทีม
      </p>
      {/* What prints: a formal document of the same figures, not this page. */}
      <ReportDocument all={all} f={f} tickets={tickets} earlier={earlier} />
    </>
  );
}

const WEEKDAY_NAMES = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

/* The days under the chart that stood out against the same weekday before (analysis.unusualDays), with the usual
   count beside them; or why none are named. */
function UnusualDays({ flagged, compared }: { flagged: DayFlag[]; compared: number }) {
  if (!compared)
    return (
      <p className="unusual-note tiny muted">
        ต้องมีข้อมูลย้อนหลังอย่างน้อย {HISTORY_NEEDED} สัปดาห์ ระบบจึงจะบอกได้ว่าวันไหนมีเคสมากหรือน้อยผิดปกติ
      </p>
    );
  if (!flagged.length)
    return <p className="unusual-note tiny muted">ไม่มีวันที่เคสมากหรือน้อยผิดปกติ เมื่อเทียบกับวันเดียวกันใน {HISTORY_WEEKS} สัปดาห์ก่อนหน้า</p>;
  return (
    <div className="unusual-days">
      <h3 className="report-subhead">วันที่ผิดปกติ</h3>
      <ul>
        {flagged.map((d) => (
          <li key={d.day.toDateString()} className={d.kind}>
            <span className="unusual-mark" aria-hidden="true">
              {d.kind === 'high' ? '▲' : '▼'}
            </span>
            <span>
              <strong>
                วัน{WEEKDAY_NAMES[d.day.getDay()]} {date(d.day)} · {d.count} เคส
              </strong>{' '}
              {d.kind === 'high' ? 'มากกว่าปกติ' : 'น้อยกว่าปกติ'} วัน{WEEKDAY_NAMES[d.day.getDay()]}ปกติราว {Math.round(d.typical)} เคส
              {d.kind === 'low' && <span className="muted"> · อาจเป็นวันหยุด หรือช่องทางติดต่อมีปัญหา</span>}
            </span>
          </li>
        ))}
      </ul>
      <p className="tiny muted">เทียบกับค่ากลางของวันเดียวกันใน {HISTORY_WEEKS} สัปดาห์ก่อนหน้า · มากกว่าปกติคือตั้งแต่ 2 เท่าและเกินอย่างน้อย 3 เคส</p>
    </div>
  );
}

/* Who handled what: the table a team lead reads to see where the work sits. */
function PeopleRows({ tickets, memberName }: { tickets: TicketRow[]; memberName: (id: string | null | undefined) => string }) {
  const rows = new Map<string, { name: string; list: TicketRow[] }>();
  for (const t of tickets) {
    const key = t.assignee_id || '';
    let row = rows.get(key);
    if (!row) {
      row = { name: key ? memberName(key) : 'ยังไม่มอบหมาย', list: [] };
      rows.set(key, row);
    }
    row.list.push(t);
  }
  return (
    <>
      {[...rows.entries()]
        .sort((a, b) => b[1].list.length - a[1].list.length)
        .map(([key, row], i) => {
          const m = reportMetrics(row.list);
          return (
            <tr key={key || 'none'}>
              <td>
                <div className="flex">
                  <Avatar name={row.name} index={i} />
                  <strong>{row.name}</strong>
                </div>
              </td>
              <td>{m.total}</td>
              <td>{m.open}</td>
              <td>{m.late ? <span className="badge suspended">{m.late}</span> : <span className="muted">0</span>}</td>
              <td>{formatDuration(m.avg)}</td>
              <td>{m.sla == null ? '-' : m.sla.toFixed(0) + '%'}</td>
            </tr>
          );
        })}
    </>
  );
}
