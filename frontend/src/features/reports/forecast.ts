import type { TicketRow } from '@/features/tickets/types';
import { median } from './insights';

/* พยากรณ์จำนวนเคส: how many new cases each of the coming days should bring, as a range, with the hours that should
   be busiest; and, so the reader knows how far to trust it, the same method run on the two weeks just gone using
   only the cases before them, beside what really came.

   The method is kept to what can be said in a sentence. Each weekday's usual share of the week (a Monday against
   Mondays; once there are five weeks the highest and lowest are dropped, so one busy day does not move it). The
   week's total drawn as a line through the weeks learnt from (the median of the slopes between every two weeks, so
   one odd week does not tilt it), carried forward while flattening off, since a rise seldom goes on for ever. The
   range is where eight days in ten should land, from how far the days learnt from sat from that line. Days and
   hours are the viewer's own clock. It knows nothing of holidays, campaigns or outages ahead. */

export const AHEAD_DAYS = 14;
export const TEST_DAYS = 14;
export const LEARN_WEEKS = 8;
const MIN_WEEKS = 4;
/** Whole days of cases before today it needs: four weeks to learn from, then the two it is tested on. */
export const NEEDED_DAYS = MIN_WEEKS * 7 + TEST_DAYS;
/** Of every day's range: the share of days that should land inside it. */
export const RANGE_SHARE = 0.8;
const Z = 1.2816;
/** The middle of (miss / chance) squared when days vary by chance alone. */
const MIDDLE_MISS = 0.4549;
const FLATTEN = 0.98;
const PEAK_HOURS = 3;
/** Cases in the weeks learnt from before a weekday's own hours are trusted (fewer: every day's hours together). */
const PEAK_MIN = 10;

const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const plus = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

type History = { first: Date | null; days: Map<string, number>; hours: Map<string, number[]> };

/** Cases opened per local day, and per hour of each day. */
function history(tickets: TicketRow[]): History {
  const days = new Map<string, number>();
  const hours = new Map<string, number[]>();
  let first: Date | null = null;
  for (const t of tickets) {
    const at = new Date(t.created_at);
    if (Number.isNaN(at.getTime())) continue;
    const key = at.toDateString();
    days.set(key, (days.get(key) ?? 0) + 1);
    const row = hours.get(key) ?? Array<number>(24).fill(0);
    row[at.getHours()]++;
    hours.set(key, row);
    if (!first || at < first) first = at;
  }
  return { first: first && dayOf(first), days, hours };
}

const countOn = (h: History, day: Date) => h.days.get(day.toDateString()) ?? 0;

/** The average without the highest and the lowest, once there are five or more. */
function steady(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const kept = sorted.length >= 5 ? sorted.slice(1, -1) : sorted;
  return kept.length ? sum(kept) / kept.length : 0;
}

type Model = {
  weeks: number;
  /** A day's cases on the line at the last day learnt from, before the weekday's share. */
  level: number;
  /** How much the line rises (falls) a day, and a week's total on it at the last week. */
  perDay: number;
  weekly: number;
  slope: number;
  /** Each weekday (0 = Sunday) against the average day. */
  shape: number[];
  /** How much more the days varied than chance alone would make them: a day expecting n cases varies by
      n + extra × n² (squared), so busy days swing more than quiet ones, as a campaign or an outage moves them more. */
  extra: number;
  hours: number[][];
};

/** What the `weeks` whole weeks before `origin` say. */
function learn(h: History, origin: Date, weeks: number): Model {
  const start = plus(origin, -7 * weeks);
  const days = Array.from({ length: 7 * weeks }, (_, i) => plus(start, i));
  const counts = days.map((d) => countOn(h, d));
  const byWeekday: number[][] = [[], [], [], [], [], [], []];
  days.forEach((d, i) => byWeekday[d.getDay()].push(counts[i]));
  const usual = byWeekday.map(steady);
  const mean = sum(usual) / 7;
  const shape = usual.map((u) => (mean ? u / mean : 1));
  const totals = Array.from({ length: weeks }, (_, w) => sum(counts.slice(7 * w, 7 * w + 7)));
  const slopes: number[] = [];
  for (let i = 0; i < weeks; i++) for (let j = i + 1; j < weeks; j++) slopes.push((totals[j] - totals[i]) / (j - i));
  const slope = median(slopes) ?? 0;
  const base = median(totals.map((t, w) => t - slope * w)) ?? 0;
  // A week's total sits at its fourth day: day i is at week (i - 3) / 7.
  const lineAt = (i: number) => (base + slope * ((i - 3) / 7)) / 7;
  // How much busier-than-chance the days were: the smallest `extra` for which the middle day's miss is no bigger than
  // chance alone would make it. A middle rather than an average, so a day of an outage does not widen every range.
  const fits = counts.map((_, i) => Math.max(0.5, lineAt(i) * shape[days[i].getDay()]));
  const middleMiss = (extra: number) => median(counts.map((c, i) => (c - fits[i]) ** 2 / (fits[i] + extra * fits[i] ** 2))) ?? 0;
  let extra = 0;
  if (middleMiss(0) > MIDDLE_MISS) {
    let [low, high] = [0, 1];
    while (middleMiss(high) > MIDDLE_MISS && high < 64) high *= 2;
    for (let step = 0; step < 30; step++) {
      const mid = (low + high) / 2;
      if (middleMiss(mid) > MIDDLE_MISS) low = mid;
      else high = mid;
    }
    extra = high;
  }
  const hours = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  days.forEach((d) => (h.hours.get(d.toDateString()) ?? []).forEach((n, hour) => (hours[d.getDay()][hour] += n)));
  return {
    weeks,
    level: Math.max(0, lineAt(counts.length - 1)),
    perDay: slope / 49,
    weekly: Math.max(0, base + slope * (weeks - 1)),
    slope,
    shape,
    extra,
    hours,
  };
}

export type Peak = { from: number; to: number; cases: number };

/** The three hours in a row that bring the most of that weekday's cases, and about how many of the day's they are. */
function peakOf(m: Model, weekday: number, expected: number): Peak | null {
  const own = m.hours[weekday];
  const profile = sum(own) >= PEAK_MIN ? own : m.hours.reduce((all, row) => all.map((n, i) => n + row[i]), Array<number>(24).fill(0));
  const total = sum(profile);
  if (total < PEAK_MIN || expected < 1) return null;
  let best = -1;
  let from = 0;
  for (let s = 0; s + PEAK_HOURS <= 24; s++) {
    const n = sum(profile.slice(s, s + PEAK_HOURS));
    if (n > best) [best, from] = [n, s];
  }
  return { from, to: from + PEAK_HOURS, cases: (expected * best) / total };
}

export type ForecastDay = { day: Date; expected: number; low: number; high: number; peak: Peak | null };

/** The day's own swing, and a little more for a usual taken from only so many weeks. */
function range(expected: number, extra: number, weeks: number): [number, number] {
  const sd = Math.sqrt((Math.max(expected, 0.5) + extra * expected ** 2) * (1 + 1 / weeks));
  const low = Math.max(0, Math.round(expected - Z * sd));
  return [low, Math.max(low, Math.round(expected + Z * sd))];
}

/** `days` days from `origin` (the day after the last one learnt from), leaving out the first `skip`. */
function project(m: Model, origin: Date, days: number, skip = 0): ForecastDay[] {
  const out: ForecastDay[] = [];
  let ahead = 0;
  for (let i = 0; i < skip + days; i++) {
    ahead += FLATTEN ** (i + 1);
    if (i < skip) continue;
    const day = plus(origin, i);
    const expected = Math.max(0, (m.level + m.perDay * ahead) * m.shape[day.getDay()]);
    const [low, high] = range(expected, m.extra, m.weeks);
    out.push({ day, expected, low, high, peak: peakOf(m, day.getDay(), expected) });
  }
  return out;
}

export type TestedDay = ForecastDay & { actual: number };

export type Forecast =
  | { ready: false; had: number }
  | {
      ready: true;
      weeks: number;
      /** From tomorrow. */
      ahead: ForecastDay[];
      /** The line's rise a week against a week's total now (%), or null when fewer than a case a day. */
      trend: number | null;
      /** Cases in the seven days before today. */
      lastWeek: number;
      tested: {
        days: TestedDay[];
        /** The average miss a day (cases), and against all the cases that came. */
        error: number;
        share: number | null;
        inside: number;
        /** How much smaller the miss was than guessing each day would be the same weekday before (1 = no miss). */
        simpler: number | null;
      };
    };

export function forecast(tickets: TicketRow[], now = new Date()): Forecast {
  const h = history(tickets);
  const today = dayOf(now);
  const had = h.first ? Math.round((today.getTime() - h.first.getTime()) / 86400000) : 0;
  if (had < NEEDED_DAYS) return { ready: false, had };

  const origin = plus(today, -TEST_DAYS);
  const before = learn(h, origin, Math.min(LEARN_WEEKS, Math.floor((had - TEST_DAYS) / 7)));
  const days = project(before, origin, TEST_DAYS).map((d) => ({ ...d, actual: countOn(h, d.day) }));
  const misses = days.map((d) => Math.abs(d.actual - d.expected));
  // The same weekday of the last week before the two weeks tested.
  const guesses = days.map((d, i) => Math.abs(d.actual - countOn(h, plus(d.day, -7 * (Math.floor(i / 7) + 1)))));
  const came = sum(days.map((d) => d.actual));

  const model = learn(h, today, Math.min(LEARN_WEEKS, Math.floor(had / 7)));
  return {
    ready: true,
    weeks: model.weeks,
    ahead: project(model, today, AHEAD_DAYS, 1),
    trend: model.weekly >= 7 ? (100 * model.slope) / model.weekly : null,
    lastWeek: sum(Array.from({ length: 7 }, (_, i) => countOn(h, plus(today, i - 7)))),
    tested: {
      days,
      error: sum(misses) / TEST_DAYS,
      share: came ? sum(misses) / came : null,
      inside: days.filter((d) => d.actual >= d.low && d.actual <= d.high).length,
      simpler: sum(guesses) ? 1 - sum(misses) / sum(guesses) : null,
    },
  };
}
