import { api } from '@/lib/api/client';
import type { Badge } from '@/lib/types';

/* ผลงานของฉัน (backend/modules/achievements): the member's own monthly summary and badges in the organization
   selected. Nobody else's can be asked for. Field names are the server's. */

export const ACHIEVEMENTS_PATH = '/api/achievements';
export const recapPath = (month?: string) => `${ACHIEVEMENTS_PATH}/recap${month ? `?month=${month}` : ''}`;

/** One month (recap.py). Times are minutes; `busiest.day` is a Thai-time date. */
export type Recap = {
  month: string;
  label: string;
  /** This month, so far. */
  partial: boolean;
  name: string;
  closed: number;
  replies: number;
  customers: number;
  busiest: { day: string; count: number } | null;
  fastest_minutes: number | null;
  median_minutes: number | null;
  waits: number;
  five_star: number;
  csat: number | null;
  csat_count: number;
  praise: { count: number; texts: string[] };
  one_touch: number;
  night: number;
  early: number;
  weekend: number;
  helped: number;
  badges: Badge[];
  previous: { closed: number; replies: number };
  empty: boolean;
  /** The month's title in fun, and the figure that earned it. */
  title: { key: string; name: string; reason: string };
};

/** GET /api/achievements */
export type Achievements = { badges: Badge[]; months: Array<{ month: string; label: string }>; last_month: string };

export const markRecapSeen = (month: string) => api<{ ok: true }>(`${ACHIEVEMENTS_PATH}/recap/seen`, { month });

export const markBadgesSeen = (keys: string[]) => api<{ ok: true }>(`${ACHIEVEMENTS_PATH}/badges/seen`, { keys });
