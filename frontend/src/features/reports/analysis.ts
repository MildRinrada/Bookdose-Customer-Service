import type { TicketRow } from '@/features/tickets/types';
import { channelNames, priorityLabels } from '@/lib/labels';
import { median, percentile, RESOLVE_BUCKETS, RESPONSE_BUCKETS } from './insights';

/* The report for people who ask their own questions: the period's cases split by one dimension with every measure
   beside it (pivot), and how satisfaction moves with speed. Both from the case list already on screen. */

export type Dimension = 'channel' | 'category' | 'tag' | 'team' | 'priority' | 'assignee' | 'weekday' | 'daypart';

export const dimensionLabels: Record<Dimension, string> = {
  channel: 'ช่องทาง',
  category: 'หมวดเรื่อง',
  tag: 'ป้ายเคส',
  team: 'ทีม',
  priority: 'ความเร่งด่วน',
  assignee: 'ผู้รับผิดชอบ',
  weekday: 'วันที่ลูกค้าติดต่อ',
  daypart: 'ช่วงเวลาที่ลูกค้าติดต่อ',
};

/** Dimensions with an order of their own (Monday first, urgent first, night to evening), not largest first. */
export const orderedDimensions: Dimension[] = ['priority', 'weekday', 'daypart'];

const WEEKDAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
const DAYPARTS: [string, number][] = [
  ['ดึก 00-06 น.', 6],
  ['เช้า 06-12 น.', 12],
  ['บ่าย 12-18 น.', 18],
  ['เย็น 18-24 น.', 24],
];
const PRIORITIES = ['urgent', 'high', 'normal', 'low'];

/** A group smaller than this is shown, but its figures are marked as too few to lean on. */
export const FEW = 3;

export type Measures = {
  cases: number;
  responseMedian: number | null;
  responseP90: number | null;
  responseSla: number | null;
  resolutionMedian: number | null;
  csat: number | null;
  csatCount: number;
  reopenRate: number | null;
  answered: number;
  finished: number;
};

export type PivotRow = Measures & { key: string; label: string; order: number; share: number };

const minutesBetween = (from: string, to: string) => Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / 60000);

/** Every measure of a group of cases: first reply (median, P90, in time), resolution (median), CSAT, reopened. */
export function measure(list: TicketRow[]): Measures {
  const answered = list.filter((t) => t.first_response_at);
  const response = answered.map((t) => minutesBetween(t.created_at, t.first_response_at as string));
  const solved = list.filter((t) => t.resolved_at);
  const rated = list.filter((t) => typeof t.csat_rating === 'number');
  // Finished at least once: solved now, or solved and then reopened.
  const finished = list.filter((t) => t.resolved_at || (t.reopens ?? 0) > 0);
  return {
    cases: list.length,
    responseMedian: median(response),
    responseP90: percentile(response, 0.9),
    responseSla: answered.length
      ? (100 * answered.filter((t) => new Date(t.first_response_at as string) <= new Date(t.first_response_due_at)).length) / answered.length
      : null,
    resolutionMedian: median(solved.map((t) => minutesBetween(t.created_at, t.resolved_at as string))),
    csat: rated.length ? rated.reduce((n, t) => n + (t.csat_rating as number), 0) / rated.length : null,
    csatCount: rated.length,
    reopenRate: finished.length ? (100 * finished.filter((t) => (t.reopens ?? 0) > 0).length) / finished.length : null,
    answered: answered.length,
    finished: finished.length,
  };
}

type Names = {
  team: (id: string | null | undefined) => string;
  member: (id: string | null | undefined) => string;
  /** The organization's ป้ายเคส, in its order. */
  tags?: Array<{ id: string; name: string }>;
};

/** The groups a case falls in: one for most dimensions, one per tag for ป้ายเคส (a case about two things counts in
    both), and "ยังไม่ติดป้าย" for a case with none. */
function groupsOf(t: TicketRow, dimension: Dimension, names: Names): Array<[string, string, number]> {
  if (dimension !== 'tag') return [groupOf(t, dimension, names)];
  const list = names.tags ?? [];
  const have = new Set(t.tags ?? []);
  const found = list.flatMap((tag, i): Array<[string, string, number]> => (have.has(tag.id) ? [[tag.id, tag.name, i]] : []));
  return found.length ? found : [['', 'ยังไม่ติดป้าย', list.length]];
}

/** [key, label, natural order] of a case in a dimension. Days and hours are the viewer's own clock. */
function groupOf(t: TicketRow, dimension: Exclude<Dimension, 'tag'>, names: Names): [string, string, number] {
  switch (dimension) {
    case 'channel': {
      const channel = String(t.channel || 'manual');
      return [channel, channelNames[channel] ?? channel, 0];
    }
    case 'category': {
      const category = String(t.category || '') || 'ไม่ระบุหมวด';
      return [category, category, 0];
    }
    case 'team':
      return [t.team_id ?? '', names.team(t.team_id), 0];
    case 'priority':
      return [t.priority, priorityLabels[t.priority] ?? t.priority, PRIORITIES.indexOf(t.priority)];
    case 'assignee':
      return [t.assignee_id ?? '', t.assignee_id ? names.member(t.assignee_id) : 'ยังไม่มอบหมาย', 0];
    case 'weekday': {
      const day = (new Date(t.created_at).getDay() + 6) % 7;
      return [String(day), WEEKDAYS[day], day];
    }
    case 'daypart': {
      const hour = new Date(t.created_at).getHours();
      const part = DAYPARTS.findIndex(([, until]) => hour < until);
      return [String(part), DAYPARTS[part][0], part];
    }
  }
}

/** The cases split by one dimension, each group with every measure and its share of all the cases. */
export function pivot(tickets: TicketRow[], dimension: Dimension, names: Names): PivotRow[] {
  const groups = new Map<string, { label: string; order: number; list: TicketRow[] }>();
  for (const t of tickets) {
    for (const [key, label, order] of groupsOf(t, dimension, names)) {
      const group = groups.get(key) ?? { label, order, list: [] };
      group.list.push(t);
      groups.set(key, group);
    }
  }
  return [...groups.entries()].map(([key, g]) => ({
    key,
    label: g.label,
    order: g.order,
    share: tickets.length ? (100 * g.list.length) / tickets.length : 0,
    ...measure(g.list),
  }));
}

export type PivotColumn = keyof Pick<
  PivotRow,
  'label' | 'cases' | 'responseMedian' | 'responseP90' | 'responseSla' | 'resolutionMedian' | 'csat' | 'reopenRate'
>;

/** Rows in a column's order; a group with nothing to measure goes last either way. `natural` keeps the dimension's own. */
export function sortRows(rows: PivotRow[], column: PivotColumn | 'natural', descending: boolean): PivotRow[] {
  const sign = descending ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (column === 'natural') return a.order - b.order;
    if (column === 'label') return sign * a.label.localeCompare(b.label, 'th');
    const x = a[column];
    const y = b[column];
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
    return sign * (x - y) || b.cases - a.cases;
  });
}

/* วันที่ผิดปกติ. Each day of the period against the same weekday of the four weeks before it (a Monday is compared
   with Mondays, since the week has a shape of its own): unusually busy when it has at least twice the usual and three
   more cases, unusually quiet when a day that usually has several has a third or less - which can mean a holiday, or
   a channel that stopped bringing messages. The usual is the median of those weeks, and only weeks after the
   organization's first case count, so a new organization is not told every day is unusual. */
export const HISTORY_WEEKS = 4;
export const HISTORY_NEEDED = 3;

export type DayFlag = { day: Date; count: number; typical: number; kind: 'high' | 'low' };

export function unusualDays(scoped: TicketRow[], days: Array<{ day: Date; count: number }>, now = new Date()) {
  const perDay = new Map<string, number>();
  let first: Date | null = null;
  for (const t of scoped) {
    const at = new Date(t.created_at);
    perDay.set(at.toDateString(), (perDay.get(at.toDateString()) ?? 0) + 1);
    if (!first || at < first) first = at;
  }
  const start = first ? new Date(first.getFullYear(), first.getMonth(), first.getDate()) : null;
  const flags = new Map<string, DayFlag>();
  let compared = 0;
  for (const { day, count } of days) {
    const weeks: number[] = [];
    for (let w = 1; w <= HISTORY_WEEKS; w++) {
      const before = new Date(day);
      before.setDate(before.getDate() - 7 * w);
      if (start && before >= start) weeks.push(perDay.get(before.toDateString()) ?? 0);
    }
    if (weeks.length < HISTORY_NEEDED) continue;
    compared++;
    const typical = median(weeks) ?? 0;
    const today = day.toDateString() === now.toDateString();
    if (count >= typical * 2 && count - typical >= 3) flags.set(day.toDateString(), { day, count, typical, kind: 'high' });
    // Today is not over yet: it cannot be called quiet.
    else if (!today && day < now && typical >= 4 && count <= typical / 3) flags.set(day.toDateString(), { day, count, typical, kind: 'low' });
  }
  return { flags, compared };
}

export type SpeedBy = 'response' | 'resolution';

/** Satisfaction by how fast the case went: of the cases the customer rated, the average score and the share who were
    satisfied (4-5) in each band of first-reply (or resolution) time. */
export function speedSatisfaction(tickets: TicketRow[], by: SpeedBy) {
  const at = (t: TicketRow) => (by === 'response' ? t.first_response_at : t.resolved_at);
  const rated = tickets.filter((t) => typeof t.csat_rating === 'number' && at(t));
  const bands = by === 'response' ? RESPONSE_BUCKETS : RESOLVE_BUCKETS;
  const rows = bands.map(([label, limit], i) => {
    const inBand = rated.filter((t) => {
      const m = minutesBetween(t.created_at, at(t) as string);
      return m <= limit && (i === 0 || m > bands[i - 1][1]);
    });
    const scores = inBand.map((t) => t.csat_rating as number);
    return {
      label,
      count: scores.length,
      average: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      satisfied: scores.length ? (100 * scores.filter((s) => s >= 4).length) / scores.length : null,
    };
  });
  // The fastest and slowest bands with enough answers to compare.
  const enough = rows.filter((r) => r.count >= FEW);
  const compare = enough.length >= 2 ? { fast: enough[0], slow: enough[enough.length - 1] } : null;
  return { total: rated.length, rows, compare };
}
