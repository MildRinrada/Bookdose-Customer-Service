import type { TicketRow } from '@/features/tickets/types';
import { isDone, overdue } from '@/lib/format';
import type { ReportFilter } from './types';

/* The report's second half, from the same case list: how long cases take to be solved, how satisfied customers were,
   where the work comes from (channel, category) and how long the open cases have been waiting. Each part keeps the
   report's team and owner; the period applies to the moment that part is about (solved, answered, opened). */

type Range = { from: Date; to: Date };

/** The period (or, with `previous`, the same-length period just before it). */
export function periodOf(f: ReportFilter, previous = false): Range {
  let from = new Date(f.from + 'T00:00:00');
  let to = new Date(f.to + 'T23:59:59.999');
  if (previous) {
    const width = to.getTime() - from.getTime() + 1;
    to = new Date(from.getTime() - 1);
    from = new Date(from.getTime() - width);
  }
  return { from, to };
}

const inScope = (t: TicketRow, f: ReportFilter) => (!f.team || t.team_id === f.team) && (!f.assignee || t.assignee_id === f.assignee);
const within = (value: string | null | undefined, r: Range) => {
  if (!value) return false;
  const at = new Date(value);
  return at >= r.from && at <= r.to;
};

/** "2 วัน 4 ชม.", "3 ชม. 10 นาที", "25 นาที". */
export function longDuration(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) return '-';
  const n = Math.round(minutes);
  if (n >= 1440) {
    const hours = Math.floor((n % 1440) / 60);
    return `${Math.floor(n / 1440)} วัน${hours ? ` ${hours} ชม.` : ''}`;
  }
  return n >= 60 ? `${Math.floor(n / 60)} ชม.${n % 60 ? ` ${n % 60} นาที` : ''}` : `${n} นาที`;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export const RESOLVE_BUCKETS: [string, number][] = [
  ['ภายใน 1 ชม.', 60],
  ['1-4 ชม.', 240],
  ['4-24 ชม.', 1440],
  ['1-3 วัน', 4320],
  ['เกิน 3 วัน', Infinity],
];

/** Cases solved in the period: average and median time from opening, how many within their resolution SLA, and
    how the times spread. */
export function resolution(all: TicketRow[], f: ReportFilter, previous = false) {
  const r = periodOf(f, previous);
  const solved = all.filter((t) => inScope(t, f) && t.resolved_at && within(t.resolved_at, r));
  const minutes = solved.map((t) => Math.max(0, (new Date(t.resolved_at as string).getTime() - new Date(t.created_at).getTime()) / 60000));
  const onTime = solved.filter((t) => new Date(t.resolved_at as string) <= new Date(t.resolution_due_at)).length;
  const buckets = RESOLVE_BUCKETS.map(([label, limit], i) => ({
    label,
    count: minutes.filter((m) => m <= limit && (i === 0 || m > RESOLVE_BUCKETS[i - 1][1])).length,
  }));
  return {
    count: solved.length,
    avg: minutes.length ? minutes.reduce((a, b) => a + b, 0) / minutes.length : null,
    median: median(minutes),
    sla: solved.length ? (100 * onTime) / solved.length : null,
    buckets,
  };
}

/** How many days one tile of a trend covers: a day up to two weeks, a week up to four months, then 30 days. */
export const tileDays = (days: number) => (days <= 14 ? 1 : days <= 120 ? 7 : 30);

export type SurveyAnswer = { ticket: TicketRow; rating: number; at: string; comment: string };

/** Satisfaction answers given in the period: average, how many of each star, the answers week by week (a tile per
    tileDays), and the
    comments (the lowest scores first). */
export function satisfaction(all: TicketRow[], f: ReportFilter, previous = false) {
  const r = periodOf(f, previous);
  const answers: SurveyAnswer[] = all
    .filter((t) => inScope(t, f) && typeof t.csat_rating === 'number' && within(t.csat_at as string, r))
    .map((t) => ({ ticket: t, rating: t.csat_rating as number, at: t.csat_at as string, comment: String(t.csat_comment ?? '').trim() }));
  const total = answers.reduce((n, a) => n + a.rating, 0);
  const weeks: { start: Date; count: number; average: number | null }[] = [];
  const step = tileDays((r.to.getTime() - r.from.getTime()) / 86400000) * 86400000;
  for (let start = new Date(r.from); start <= r.to; start = new Date(start.getTime() + step)) {
    const end = new Date(Math.min(start.getTime() + step - 1, r.to.getTime()));
    const inWeek = answers.filter((a) => new Date(a.at) >= start && new Date(a.at) <= end);
    weeks.push({ start, count: inWeek.length, average: inWeek.length ? inWeek.reduce((n, a) => n + a.rating, 0) / inWeek.length : null });
  }
  return {
    count: answers.length,
    average: answers.length ? total / answers.length : null,
    satisfied: answers.length ? (100 * answers.filter((a) => a.rating >= 4).length) / answers.length : null,
    stars: [5, 4, 3, 2, 1].map((star) => ({ star, count: answers.filter((a) => a.rating === star).length })),
    weeks,
    comments: answers
      .filter((a) => a.comment || a.rating <= 2)
      .sort((a, b) => a.rating - b.rating || b.at.localeCompare(a.at))
      .slice(0, 6),
  };
}

export type SourceRow = { key: string; total: number; open: number; late: number; avg: number | null; sla: number | null };

/** The cases of the period grouped by channel or by category, largest first. */
export function bySource(tickets: TicketRow[], key: 'channel' | 'category'): SourceRow[] {
  const groups = new Map<string, TicketRow[]>();
  for (const t of tickets) {
    const value = String(t[key] || '') || (key === 'channel' ? 'manual' : 'ไม่ระบุหมวด');
    groups.set(value, [...(groups.get(value) ?? []), t]);
  }
  return [...groups.entries()]
    .map(([value, list]) => {
      const replied = list.filter((t) => t.first_response_at);
      const minutes = replied.map((t) => (new Date(t.first_response_at as string).getTime() - new Date(t.created_at).getTime()) / 60000);
      return {
        key: value,
        total: list.length,
        open: list.filter((t) => !isDone(t)).length,
        late: list.filter(overdue).length,
        avg: minutes.length ? minutes.reduce((a, b) => a + b, 0) / minutes.length : null,
        sla: replied.length
          ? (100 * replied.filter((t) => new Date(t.first_response_at as string) <= new Date(t.first_response_due_at)).length) / replied.length
          : null,
      };
    })
    .sort((a, b) => b.total - a.total);
}

export const AGE_BUCKETS: [string, number, string][] = [
  ['ไม่ถึง 1 วัน', 1, 'fresh'],
  ['1-3 วัน', 3, 'ok'],
  ['3-7 วัน', 7, 'warn'],
  ['เกิน 7 วัน', Infinity, 'bad'],
];

/** The cases still open now (whenever they were opened), by how many days they have waited, and the oldest ones. */
export function backlog(all: TicketRow[], f: ReportFilter, now = Date.now()) {
  const open = all.filter((t) => inScope(t, f) && !isDone(t));
  const age = (t: TicketRow) => (now - new Date(t.created_at).getTime()) / 86400000;
  return {
    total: open.length,
    buckets: AGE_BUCKETS.map(([label, limit, tone], i) => ({
      label,
      tone,
      count: open.filter((t) => age(t) < limit && (i === 0 || age(t) >= AGE_BUCKETS[i - 1][1])).length,
    })),
    oldest: [...open].sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, 5).map((t) => ({ t, days: age(t) })),
  };
}

/** Cases finished in the period that went back to work: of the cases solved at least once in the period (solved now,
    or reopened since), how many were reopened, and the ones reopened most. */
export function reopening(all: TicketRow[], f: ReportFilter, previous = false) {
  const r = periodOf(f, previous);
  const reopened = all.filter((t) => inScope(t, f) && (t.reopens ?? 0) > 0 && within(t.reopened_at, r));
  const finished = all.filter((t) => inScope(t, f) && (within(t.resolved_at, r) || within(t.reopened_at, r)));
  return {
    finished: finished.length,
    reopened: reopened.length,
    rate: finished.length ? (100 * reopened.length) / finished.length : null,
    cases: [...reopened].sort((a, b) => (b.reopens ?? 0) - (a.reopens ?? 0) || String(b.reopened_at).localeCompare(String(a.reopened_at))).slice(0, 5),
  };
}

export type LoadRow = { id: string; open: number; late: number; urgent: number; oldest: number | null };

/** The cases open now, per person of the team picked (members with none included, so an uneven share shows), plus
    those nobody has taken. `heavy`: well above the team's average. */
export function workload(all: TicketRow[], f: ReportFilter, members: Array<{ id: string; team_id: string | null; active: boolean | number }>, now = Date.now()) {
  const open = all.filter((t) => (!f.team || t.team_id === f.team) && !isDone(t));
  const rows = new Map<string, LoadRow>();
  for (const m of members) if (m.active && (!f.team || m.team_id === f.team)) rows.set(m.id, { id: m.id, open: 0, late: 0, urgent: 0, oldest: null });
  let unassigned = 0;
  for (const t of open) {
    if (!t.assignee_id) {
      unassigned++;
      continue;
    }
    const row = rows.get(t.assignee_id) ?? { id: t.assignee_id, open: 0, late: 0, urgent: 0, oldest: null };
    const age = (now - new Date(t.created_at).getTime()) / 86400000;
    row.open++;
    if (overdue(t)) row.late++;
    if (t.priority === 'urgent' || t.priority === 'high') row.urgent++;
    row.oldest = Math.max(row.oldest ?? 0, age);
    rows.set(t.assignee_id, row);
  }
  const people = [...rows.values()].sort((a, b) => b.open - a.open || b.late - a.late);
  const average = people.length ? people.reduce((n, p) => n + p.open, 0) / people.length : 0;
  return { people, unassigned, average, heavy: (p: LoadRow) => p.open >= 3 && p.open >= average * 1.5 };
}
