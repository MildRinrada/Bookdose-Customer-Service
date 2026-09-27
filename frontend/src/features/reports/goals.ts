import { useMemo } from 'react';
import { api } from '@/lib/api/client';
import { useWork } from '@/lib/session';
import type { TicketRow } from '@/features/tickets/types';
import { customerMood, firstResponse, longDuration, nextReply, oneTouch, reopening, satisfaction } from './insights';
import type { ReportFilter } from './types';

/* เป้าหมายของทีม (backend reports/goals.py): what the organization's owner calls good enough, for the whole
   organization and, where a team's differs, per team. They live in the workspace settings (report_goals, JSON); the
   report works each figure out as the rest of the page does (insights.ts) and says whether it reaches the target. */

export type GoalMetric = 'response_sla' | 'first_response' | 'next_reply' | 'fcr' | 'csat' | 'reopen' | 'upset';
export type Targets = Partial<Record<GoalMetric, number>>;
export type Goals = { org: Targets; teams: Record<string, Targets> };

type Meta = { label: string; better: 'high' | 'low'; kind: 'percent' | 'minutes' | 'score'; min: number; max: number };

/** In the order the report shows them; the limits are the backend's. */
export const GOAL_METRICS: Record<GoalMetric, Meta> = {
  response_sla: { label: 'ตอบทัน SLA', better: 'high', kind: 'percent', min: 1, max: 100 },
  first_response: { label: 'ตอบครั้งแรก (ค่ากลาง)', better: 'low', kind: 'minutes', min: 1, max: 10080 },
  next_reply: { label: 'รอคำตอบถัดไป (ค่ากลาง)', better: 'low', kind: 'minutes', min: 1, max: 10080 },
  fcr: { label: 'แก้จบในครั้งเดียว', better: 'high', kind: 'percent', min: 1, max: 100 },
  csat: { label: 'คะแนนความพึงพอใจ', better: 'high', kind: 'score', min: 1, max: 5 },
  reopen: { label: 'เปิดซ้ำ', better: 'low', kind: 'percent', min: 0, max: 100 },
  upset: { label: 'ลูกค้าไม่พอใจ', better: 'low', kind: 'percent', min: 0, max: 100 },
};
export const GOAL_ORDER = Object.keys(GOAL_METRICS) as GoalMetric[];

const targetsOf = (value: unknown): Targets =>
  value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([k, v]) => k in GOAL_METRICS && typeof v === 'number'))
    : {};

export function parseGoals(value: unknown): Goals {
  try {
    const found: { org?: unknown; teams?: unknown } = JSON.parse(String(value ?? '') || '{}') ?? {};
    const teams = found.teams && typeof found.teams === 'object' ? found.teams : {};
    return { org: targetsOf(found.org), teams: Object.fromEntries(Object.entries(teams).map(([id, t]) => [id, targetsOf(t)])) };
  } catch {
    return { org: {}, teams: {} };
  }
}

export function useGoals(): Goals {
  const saved = useWork().settings.report_goals;
  return useMemo(() => parseGoals(saved), [saved]);
}

/** The targets that apply to a team: the team's own over the organization's. */
export const targetsFor = (goals: Goals, team: string): Targets => ({ ...goals.org, ...(team ? goals.teams[team] : {}) });

/** A figure of the period, as the rest of the report counts it. */
export function metricValue(metric: GoalMetric, all: TicketRow[], f: ReportFilter): number | null {
  switch (metric) {
    case 'response_sla':
      return firstResponse(all, f).sla;
    case 'first_response':
      return firstResponse(all, f).median;
    case 'next_reply':
      return nextReply(all, f).median;
    case 'fcr':
      return oneTouch(all, f).rate;
    case 'csat':
      return satisfaction(all, f).average;
    case 'reopen':
      return reopening(all, f).rate;
    case 'upset':
      return customerMood(all, f).rate;
  }
}

/** Whether a figure reaches its target; null when there is no figure. */
export function reaches(metric: GoalMetric, value: number | null, target: number): boolean | null {
  if (value == null) return null;
  return GOAL_METRICS[metric].better === 'high' ? value >= target : value <= target;
}

export function formatMetric(metric: GoalMetric, value: number | null): string {
  if (value == null) return '-';
  const kind = GOAL_METRICS[metric].kind;
  // One decimal where it matters: 89.6% must not read as the 90% it misses.
  const rounded = Math.round(value * 10) / 10;
  return kind === 'percent' ? `${rounded % 1 ? rounded.toFixed(1) : rounded}%` : kind === 'score' ? value.toFixed(1) : longDuration(value);
}

/** "อย่างน้อย 90%", "ไม่เกิน 1 ชม.". */
export const targetText = (metric: GoalMetric, target: number) =>
  `${GOAL_METRICS[metric].better === 'high' ? 'อย่างน้อย' : 'ไม่เกิน'} ${formatMetric(metric, target)}`;

export const saveGoals = (goals: Goals) => api<Goals>('/api/reports/goals', goals);
