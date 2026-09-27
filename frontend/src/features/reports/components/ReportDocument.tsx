'use client';

import { useEffect } from 'react';
import { useCaseTags } from '@/features/tickets/tags';
import type { TicketRow } from '@/features/tickets/types';
import { isDone, overdue } from '@/lib/format';
import { channelNames, priorityLabels, statusLabels } from '@/lib/labels';
import { useMemberName, useTeamName, useWork } from '@/lib/session';
import { dimensionLabels, upsetHotspots } from '../analysis';
import { GOAL_METRICS, reaches, targetsFor, useGoals, type GoalMetric } from '../goals';
import { customerMood, firstResponse, median, nextReply, oneTouch, periodOf, periodTiles, reopening, resolution, satisfaction, tileDays } from '../insights';
import { reportMetrics, reportTickets } from '../labels';
import { BarList, ColumnChart, LineChart, type Point } from './ReportDocCharts';
import type { ReportFilter } from '../types';

/* รายงานผลการให้บริการลูกค้า: what the report page prints (พิมพ์หรือบันทึก PDF, or the browser's own print). Not a
   picture of the web page but a document: a title block, numbered sections of plain tables, the figures against the
   period before and the goals, and what each figure means, in formal Thai. The same figures as the page (insights.ts,
   goals.ts). Hidden on the screen; printed alone (pages/reports, report-document). While it prints, the page's title
   (the PDF's name, and the browser's header when it prints one) is the document's own. */

const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const SHORT_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const fullDate = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
const shortDate = (d: Date) => `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
const clockText = (d: Date) => `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')} น.`;
const day = (text: string) => new Date(`${text}T00:00:00`);

/** "25 นาที", "1 ชั่วโมง 55 นาที", "2 วัน 4 ชั่วโมง". */
function formalDuration(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) return 'ไม่มีข้อมูล';
  const n = Math.round(minutes);
  if (n >= 1440) {
    const hours = Math.floor((n % 1440) / 60);
    return `${Math.floor(n / 1440)} วัน${hours ? ` ${hours} ชั่วโมง` : ''}`;
  }
  return n >= 60 ? `${Math.floor(n / 60)} ชั่วโมง${n % 60 ? ` ${n % 60} นาที` : ''}` : `${n} นาที`;
}

const decimal = (value: number | null, digits = 1) => (value == null ? 'ไม่มีข้อมูล' : value.toFixed(digits));

type Kind = 'count' | 'minutes' | 'percent' | 'score';

/** A figure as the table writes it: a count, a time in words, a share as a number (the row says ร้อยละ), a score. */
function figure(kind: Kind, value: number | null): string {
  if (value == null) return 'ไม่มีข้อมูล';
  return kind === 'count' ? value.toLocaleString('th-TH') : kind === 'minutes' ? formalDuration(value) : decimal(value, kind === 'score' ? 2 : 1);
}

function targetText(metric: GoalMetric, target: number): string {
  const kind = GOAL_METRICS[metric].kind;
  const value = kind === 'minutes' ? formalDuration(target) : kind === 'percent' ? `ร้อยละ ${target}` : target.toFixed(1);
  return `${GOAL_METRICS[metric].better === 'high' ? 'ไม่น้อยกว่า' : 'ไม่เกิน'} ${value}`;
}

/** How the period's cases split by one thing: count and share of each group. */
function ShareTable({ caption, head, list }: { caption: string; head: string; list: Array<{ label: string; n: number; share: number }> }) {
  return (
    <table className="report-doc-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th>{head}</th>
          <th>จำนวน (เคส)</th>
          <th>ร้อยละ</th>
        </tr>
      </thead>
      <tbody>
        {list.length ? (
          list.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td>{r.n.toLocaleString('th-TH')}</td>
              <td>{r.share.toFixed(1)}</td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={3}>ไม่มีข้อมูล</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** A line of the summary: its figure now and before, and the goal it is measured against, if it has one. */
type Row = { label: string; kind: Kind; now: number | null; before: number | null; goal?: GoalMetric };

export function ReportDocument({ all, f, tickets, earlier }: { all: TicketRow[]; f: ReportFilter; tickets: TicketRow[]; earlier: TicketRow[] }) {
  const work = useWork();
  const teamName = useTeamName();
  const memberName = useMemberName();
  const tags = useCaseTags();
  const goals = useGoals();
  const team = f.team || (work.role === 'agent' ? (work.team_id ?? '') : '');
  const targets = targetsFor(goals, team);
  const from = day(f.from);
  const to = day(f.to);
  const title = `รายงานผลการให้บริการลูกค้า ${work.tenant.name} ระหว่างวันที่ ${fullDate(from)} ถึงวันที่ ${fullDate(to)}`;

  // The document's name while it prints; the page's own afterwards.
  useEffect(() => {
    let kept = '';
    const before = () => {
      // The event may come twice for one print: the page's own title is the one kept.
      if (document.title !== title) kept = document.title;
      document.title = title;
    };
    const after = () => {
      if (kept) document.title = kept;
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, [title]);

  const now = reportMetrics(tickets);
  const prev = reportMetrics(earlier);
  const both = <T,>(fn: (all: TicketRow[], f: ReportFilter, previous?: boolean) => T) => [fn(all, f), fn(all, f, true)] as const;
  const [first, firstBefore] = both(firstResponse);
  const [wait, waitBefore] = both(nextReply);
  const [solved, solvedBefore] = both(resolution);
  const [once, onceBefore] = both(oneTouch);
  const [csat, csatBefore] = both(satisfaction);
  const [reopen, reopenBefore] = both(reopening);
  const [mood, moodBefore] = both(customerMood);
  const rows: Row[] = [
    { label: 'จำนวนเคสที่เปิดใหม่ (เคส)', kind: 'count', now: now.total, before: prev.total },
    { label: 'จำนวนเคสที่ยังอยู่ระหว่างดำเนินการ (เคส)', kind: 'count', now: now.open, before: prev.open },
    { label: 'จำนวนเคสที่เกินกำหนดเวลา (เคส)', kind: 'count', now: now.late, before: prev.late },
    { label: 'เวลาตอบกลับครั้งแรก (ค่ามัธยฐาน)', kind: 'minutes', now: first.median, before: firstBefore.median, goal: 'first_response' },
    { label: 'การตอบกลับครั้งแรกทันกำหนด (ร้อยละ)', kind: 'percent', now: first.sla, before: firstBefore.sla, goal: 'response_sla' },
    { label: 'เวลารอคำตอบถัดไป (ค่ามัธยฐาน)', kind: 'minutes', now: wait.median, before: waitBefore.median, goal: 'next_reply' },
    { label: 'เวลาแก้ไขจนแล้วเสร็จ (ค่ามัธยฐาน)', kind: 'minutes', now: solved.median, before: solvedBefore.median },
    { label: 'การแก้ไขแล้วเสร็จด้วยการตอบครั้งเดียว (ร้อยละ)', kind: 'percent', now: once.rate, before: onceBefore.rate, goal: 'fcr' },
    { label: 'คะแนนความพึงพอใจเฉลี่ย (คะแนนเต็ม 5)', kind: 'score', now: csat.average, before: csatBefore.average, goal: 'csat' },
    { label: 'การเปิดเคสซ้ำ (ร้อยละ)', kind: 'percent', now: reopen.rate, before: reopenBefore.rate, goal: 'reopen' },
    { label: 'เคสที่ลูกค้าไม่พอใจ (ร้อยละ)', kind: 'percent', now: mood.rate, before: moodBefore.rate, goal: 'upset' },
  ];

  const shares = (groups: Array<[string, number]>) =>
    groups.filter(([, n]) => n > 0).map(([label, n]) => ({ label, n, share: tickets.length ? (100 * n) / tickets.length : 0 }));
  const count = (pick: (t: TicketRow) => string) => {
    const found = new Map<string, number>();
    for (const t of tickets) found.set(pick(t), (found.get(pick(t)) ?? 0) + 1);
    return [...found.entries()].sort((a, b) => b[1] - a[1]);
  };
  const byStatus = shares(Object.entries(statusLabels).map(([key, label]) => [label, tickets.filter((t) => t.status === key).length]));
  const byPriority = shares(Object.entries(priorityLabels).map(([key, label]) => [label, tickets.filter((t) => t.priority === key).length]));
  const byChannel = shares(count((t) => channelNames[String(t.channel || 'manual')] ?? String(t.channel)));
  const byCategory = shares(count((t) => String(t.category || '') || 'ไม่ระบุหมวด')).slice(0, 10);

  const unit = tileDays(Math.round((periodOf(f).to.getTime() - periodOf(f).from.getTime()) / 86400000));
  const tiles = periodTiles(f);
  const people = [...new Set(tickets.map((t) => t.assignee_id || ''))]
    .map((id) => {
      const list = tickets.filter((t) => (t.assignee_id || '') === id);
      const answered = list.filter((t) => t.first_response_at);
      const minutes = answered.map((t) => (new Date(t.first_response_at as string).getTime() - new Date(t.created_at).getTime()) / 60000);
      return {
        id,
        name: id ? memberName(id) : 'ยังไม่ได้มอบหมาย',
        total: list.length,
        open: list.filter((t) => !isDone(t)).length,
        late: list.filter(overdue).length,
        median: median(minutes),
        sla: answered.length ? (100 * answered.filter((t) => new Date(t.first_response_at as string) <= new Date(t.first_response_due_at)).length) / answered.length : null,
      };
    })
    .sort((a, b) => b.total - a.total);
  const hotspots = upsetHotspots(tickets, { team: teamName, member: memberName, tags });
  const printed = new Date();

  // แผนภูมิ, numbered in the order they appear. Up to three months a column a day; longer, a column a period.
  const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  const daily = days <= 92;
  const volume: Point[] = daily
    ? [...Array(days)].map((_, i) => {
        const d = new Date(from);
        d.setDate(from.getDate() + i);
        const text = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return { label: String(d.getDate()), value: reportTickets(all, { ...f, from: text, to: text }).length };
      })
    : tiles.map((tile) => ({ label: `${tile.start.getDate()} ${SHORT_MONTHS[tile.start.getMonth()]}`, value: reportTickets(all, tile.f).length }));
  const tileLabel = (start: Date) => (unit === 1 ? String(start.getDate()) : `${start.getDate()} ${SHORT_MONTHS[start.getMonth()]}`);
  const trends = tiles.length > 1;
  const stars = [5, 4, 3, 2, 1].map((star) => csat.stars.find((s) => s.star === star)?.count ?? 0);
  let figures = 0;
  const fig = {
    volume: ++figures,
    status: ++figures,
    onTime: trends ? ++figures : 0,
    upset: trends ? ++figures : 0,
    stars: csat.count ? ++figures : 0,
  };
  const spanText = daily ? `${fullDate(from)} ถึงวันที่ ${fullDate(to)}` : `ช่วงรายงาน`;
  const scope = [team ? `ทีม${teamName(team)}` : 'ทุกทีม', f.assignee ? `ผู้รับผิดชอบ ${memberName(f.assignee)}` : 'ผู้รับผิดชอบทุกคน'].join(' ');

  return (
    <article className="report-document" aria-hidden="true">
      <header className="report-doc-title">
        <p className="report-doc-org">{work.tenant.name}</p>
        <h1>รายงานผลการให้บริการลูกค้า</h1>
        <p>
          ระหว่างวันที่ {fullDate(from)} ถึงวันที่ {fullDate(to)}
        </p>
        <dl>
          <div>
            <dt>ขอบเขตของรายงาน</dt>
            <dd>{scope}</dd>
          </div>
          <div>
            <dt>ช่วงเปรียบเทียบ</dt>
            <dd>ช่วงเวลาก่อนหน้าที่มีจำนวนวันเท่ากัน</dd>
          </div>
          <div>
            <dt>วันที่จัดทำ</dt>
            <dd>
              {fullDate(printed)} เวลา {clockText(printed)}
            </dd>
          </div>
        </dl>
      </header>

      <section>
        <h2>1. สรุปตัวชี้วัดหลัก</h2>
        <table className="report-doc-table report-doc-summary">
          <colgroup>
            <col />
            <col />
            <col />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th>ตัวชี้วัด</th>
              <th>ช่วงรายงาน</th>
              <th>ช่วงก่อนหน้า</th>
              <th>เป้าหมาย</th>
              <th>ผลเทียบเป้าหมาย</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const target = row.goal ? targets[row.goal] : undefined;
              const hit = row.goal && target != null ? reaches(row.goal, row.now, target) : null;
              return (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{figure(row.kind, row.now)}</td>
                  <td>{figure(row.kind, row.before)}</td>
                  <td>{row.goal && target != null ? targetText(row.goal, target) : 'ไม่ได้กำหนด'}</td>
                  <td>{target == null ? '-' : hit == null ? 'ไม่มีข้อมูล' : hit ? 'เป็นไปตามเป้าหมาย' : 'ไม่เป็นไปตามเป้าหมาย'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h2>2. ปริมาณงาน</h2>
        <p>ในช่วงรายงานมีเคสที่เปิดใหม่ทั้งสิ้น {now.total.toLocaleString('th-TH')} เคส จำแนกได้ดังนี้</p>
        <ColumnChart
          points={volume}
          unit="เคส"
          caption={`แผนภูมิที่ ${fig.volume} จำนวนเคสที่เปิดใหม่${daily ? `รายวัน ระหว่างวันที่ ${spanText}` : `${unit === 7 ? 'รายสัปดาห์' : 'ราย 30 วัน'}ใน${spanText}`}`}
        />
        <BarList rows={byStatus} caption={`แผนภูมิที่ ${fig.status} สัดส่วนเคสที่เปิดใหม่จำแนกตามสถานะ`} />
        <ShareTable caption="2.1 จำแนกตามสถานะ" head="สถานะ" list={byStatus} />
        <ShareTable caption="2.2 จำแนกตามความเร่งด่วน" head="ความเร่งด่วน" list={byPriority} />
        <ShareTable caption="2.3 จำแนกตามช่องทางที่ลูกค้าติดต่อ" head="ช่องทาง" list={byChannel} />
        <ShareTable caption="2.4 จำแนกตามหมวดเรื่อง" head="หมวดเรื่อง" list={byCategory} />
      </section>

      <section>
        <h2>3. ผลการดำเนินงาน{unit === 1 ? 'รายวัน' : unit === 7 ? 'รายสัปดาห์' : 'ราย 30 วัน'}</h2>
        {trends && (
          <>
            <LineChart
              points={tiles.map((tile) => ({ label: tileLabel(tile.start), value: firstResponse(all, tile.f).sla }))}
              max={100}
              unit="ร้อยละ"
              goal={targets.response_sla}
              goalText={targets.response_sla != null ? `เป้าหมาย ร้อยละ ${targets.response_sla}` : undefined}
              caption={`แผนภูมิที่ ${fig.onTime} การตอบกลับครั้งแรกทันกำหนด${unit === 1 ? 'รายวัน' : unit === 7 ? 'รายสัปดาห์' : 'ราย 30 วัน'} (ร้อยละ)`}
            />
            <LineChart
              points={tiles.map((tile) => ({ label: tileLabel(tile.start), value: customerMood(all, tile.f).rate }))}
              max={100}
              unit="ร้อยละ"
              goal={targets.upset}
              goalText={targets.upset != null ? `เป้าหมาย ไม่เกินร้อยละ ${targets.upset}` : undefined}
              caption={`แผนภูมิที่ ${fig.upset} สัดส่วนเคสที่ลูกค้าไม่พอใจ${unit === 1 ? 'รายวัน' : unit === 7 ? 'รายสัปดาห์' : 'ราย 30 วัน'} (ร้อยละ)`}
            />
          </>
        )}
        <table className="report-doc-table report-doc-periods">
          <thead>
            <tr>
              <th>ช่วงวันที่</th>
              <th>เคสที่เปิดใหม่ (เคส)</th>
              <th>ตอบกลับครั้งแรกทันกำหนด (ร้อยละ)</th>
              <th>เวลาตอบกลับครั้งแรก (ค่ามัธยฐาน)</th>
              <th>คะแนนความพึงพอใจเฉลี่ย</th>
              <th>เคสที่ลูกค้าไม่พอใจ (ร้อยละ)</th>
            </tr>
          </thead>
          <tbody>
            {tiles.map((tile) => {
              const part = firstResponse(all, tile.f);
              const end = day(tile.f.to);
              return (
                <tr key={tile.f.from}>
                  <td>{tile.f.from === tile.f.to ? shortDate(tile.start) : `${shortDate(tile.start)} ถึง ${shortDate(end)}`}</td>
                  <td>{reportTickets(all, tile.f).length}</td>
                  <td>{decimal(part.sla)}</td>
                  <td>{formalDuration(part.median)}</td>
                  <td>{decimal(satisfaction(all, tile.f).average, 2)}</td>
                  <td>{decimal(customerMood(all, tile.f).rate)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h2>4. ผลการดำเนินงานรายบุคคล</h2>
        <table className="report-doc-table">
          <thead>
            <tr>
              <th>ผู้รับผิดชอบ</th>
              <th>เคสทั้งหมด (เคส)</th>
              <th>อยู่ระหว่างดำเนินการ (เคส)</th>
              <th>เกินกำหนดเวลา (เคส)</th>
              <th>เวลาตอบกลับครั้งแรก (ค่ามัธยฐาน)</th>
              <th>ตอบกลับครั้งแรกทันกำหนด (ร้อยละ)</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id || 'none'}>
                <td>{p.name}</td>
                <td>{p.total}</td>
                <td>{p.open}</td>
                <td>{p.late}</td>
                <td>{formalDuration(p.median)}</td>
                <td>{decimal(p.sla)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>5. ความพึงพอใจและอารมณ์ของลูกค้า</h2>
        <p>
          {csat.count
            ? `ในช่วงรายงานได้รับแบบประเมินความพึงพอใจจำนวน ${csat.count} ฉบับ คะแนนเฉลี่ย ${decimal(csat.average, 2)} จากคะแนนเต็ม 5 โดยลูกค้าให้คะแนน 4 ถึง 5 คิดเป็นร้อยละ ${decimal(csat.satisfied)}`
            : 'ในช่วงรายงานไม่ได้รับแบบประเมินความพึงพอใจ'}
        </p>
        {csat.count > 0 && (
          <BarList
            rows={stars.map((n, i) => ({ label: `${5 - i} คะแนน`, n, share: (100 * n) / csat.count }))}
            caption={`แผนภูมิที่ ${fig.stars} จำนวนแบบประเมินความพึงพอใจจำแนกตามคะแนน`}
          />
        )}
        <p>
          {mood.total
            ? `จากเคสที่เปิดใหม่ ${mood.total} เคส มีเคสที่ลูกค้าแสดงความไม่พอใจอย่างน้อยหนึ่งข้อความ ${mood.upset} เคส คิดเป็นร้อยละ ${decimal(mood.rate)} ในจำนวนนี้เป็นเคสที่ลูกค้าไม่พอใจอย่างมาก ${mood.angry} เคส`
            : 'ในช่วงรายงานไม่มีข้อมูลอารมณ์ของลูกค้า'}
        </p>
        {hotspots.length > 0 && (
          <table className="report-doc-table">
            <caption>เรื่องที่ลูกค้าแสดงความไม่พอใจในสัดส่วนสูง</caption>
            <thead>
              <tr>
                <th>ประเภท</th>
                <th>รายการ</th>
                <th>เคสทั้งหมด (เคส)</th>
                <th>ลูกค้าไม่พอใจ (ร้อยละ)</th>
              </tr>
            </thead>
            <tbody>
              {hotspots.map(({ dimension, row }) => (
                <tr key={`${dimension}:${row.key}`}>
                  <td>{dimensionLabels[dimension]}</td>
                  <td>{row.label}</td>
                  <td>{row.measured}</td>
                  <td>{decimal(row.upsetRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="report-doc-notes">
        <h2>หมายเหตุ</h2>
        <ol>
          <li>ค่ามัธยฐาน หมายถึง ค่าที่อยู่กึ่งกลางเมื่อเรียงข้อมูลจากน้อยไปมาก ใช้แทนค่าเฉลี่ยเพื่อไม่ให้เคสที่ใช้เวลานานผิดปกติเพียงไม่กี่เคสทำให้ผลคลาดเคลื่อน</li>
          <li>เวลาตอบกลับครั้งแรก นับจากเวลาที่เปิดเคสจนถึงคำตอบแรกของเจ้าหน้าที่ ไม่นับคำตอบของระบบตอบกลับอัตโนมัติ และนับเฉพาะเคสที่เปิดในช่วงรายงาน</li>
          <li>เวลารอคำตอบถัดไป นับจากข้อความแรกที่ลูกค้าส่งมาหลังได้รับคำตอบจากเจ้าหน้าที่แล้ว จนถึงคำตอบถัดไปของเจ้าหน้าที่</li>
          <li>เวลาแก้ไขจนแล้วเสร็จ นับเฉพาะเคสที่แก้ไขแล้วเสร็จในช่วงรายงาน</li>
          <li>การแก้ไขแล้วเสร็จด้วยการตอบครั้งเดียว หมายถึง เคสที่แก้ไขแล้วเสร็จในช่วงรายงาน โดยเจ้าหน้าที่ตอบเพียงครั้งเดียวและไม่มีการเปิดเคสซ้ำ</li>
          <li>คะแนนความพึงพอใจ นับจากแบบประเมินที่ได้รับในช่วงรายงาน</li>
          <li>เคสที่ลูกค้าไม่พอใจ หมายถึง เคสที่มีข้อความของลูกค้าแสดงความไม่พอใจหรือความโกรธอย่างน้อยหนึ่งข้อความ ประเมินจากถ้อยคำในข้อความ และจากระบบปัญญาประดิษฐ์ในกรณีที่องค์กรเปิดใช้งาน</li>
          <li>ข้อมูลในรายงานจำกัดตามสิทธิ์ของผู้จัดทำ และวันเวลาเป็นไปตามเขตเวลาของเครื่องที่ใช้จัดทำรายงาน</li>
        </ol>
      </section>
    </article>
  );
}
