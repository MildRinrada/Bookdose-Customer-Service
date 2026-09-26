import type { TicketRow } from '@/features/tickets/types';
import type { ForecastDay } from './forecast';

/* คนที่ต้องใช้แต่ละวัน: the forecast of new cases (forecast.ts) set against who is expected to work each day (backend
   reports/staffing.py: leave, working days, the organization's holidays).

   How much one person gets through is read from the cases closed in the last four weeks: every case closed, over
   every day a member closed at least one (a day off is not counted as a day of nothing done). The people needed on
   a day is the cases expected over that, rounded up; and, since the forecast is a range, how many it takes if the day
   brings as many as the top of it. A day is short when fewer are working than the middle number needs, and tight when
   they cover the middle but not the top.

   Who counts: every agent of the team, and an owner only when they closed a case themselves in those four weeks (an
   owner who only supervises is not a pair of hands). Cases already waiting are not in it: this is about the new ones. */

export const CAPACITY_DAYS = 28;
/** Member-days of closing cases needed before the per-person figure is trusted. */
export const MIN_PERSON_DAYS = 10;

export type PlanDay = { works: boolean; why: '' | 'leave' | 'off' | 'holiday' };

export type StaffMember = {
  id: string;
  name: string;
  role: string;
  team_id: string | null;
  /** Cases they closed in the last `handled_days` days. */
  resolved: number;
  hours_set: boolean;
  days: PlanDay[];
};

/** GET /api/reports/staffing */
export type StaffPlan = {
  days: string[];
  members: StaffMember[];
  handled_days: number;
  holidays: Array<{ date: string; name: string }>;
  org_hours: boolean;
};

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export type Capacity = { perPerson: number | null; resolved: number; personDays: number; people: number };

/** Cases closed per member per day they closed any, over the CAPACITY_DAYS whole days before today. */
export function capacity(tickets: TicketRow[], now = new Date()): Capacity {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - CAPACITY_DAYS);
  const perDay = new Map<string, number>();
  const people = new Set<string>();
  let resolved = 0;
  for (const t of tickets) {
    if (!t.resolved_at || !t.assignee_id) continue;
    const at = new Date(t.resolved_at);
    if (Number.isNaN(at.getTime()) || at < from || at >= today) continue;
    const key = `${t.assignee_id}|${at.toDateString()}`;
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
    people.add(t.assignee_id);
    resolved++;
  }
  const personDays = perDay.size;
  return { perPerson: personDays >= MIN_PERSON_DAYS ? resolved / personDays : null, resolved, personDays, people: people.size };
}

/** The members who handle cases: agents, and owners who closed some themselves lately. */
export function handlers(plan: StaffPlan, team: string): StaffMember[] {
  return plan.members.filter((m) => (!team || m.team_id === team) && (m.role === 'agent' || m.resolved > 0));
}

export type StaffState = 'ok' | 'tight' | 'short' | 'closed';

export type StaffDay = ForecastDay & {
  need: number;
  needHigh: number;
  have: number;
  state: StaffState;
  /** Who is away that day and why (leave or not a working day of theirs). */
  away: Array<{ name: string; why: PlanDay['why'] }>;
  holiday: string | null;
};

export function staffDays(ahead: ForecastDay[], plan: StaffPlan, people: StaffMember[], perPerson: number): StaffDay[] {
  const holidays = new Map(plan.holidays.map((h) => [h.date, h.name]));
  return ahead.flatMap((d) => {
    const index = plan.days.indexOf(dayKey(d.day));
    if (index < 0) return [];
    const holiday = holidays.get(plan.days[index]) ?? null;
    const have = people.filter((m) => m.days[index]?.works).length;
    const away = people.filter((m) => !m.days[index]?.works && m.days[index]?.why !== 'holiday').map((m) => ({ name: m.name, why: m.days[index].why }));
    const need = d.expected < 0.5 ? 0 : Math.ceil(d.expected / perPerson);
    const needHigh = Math.max(need, d.high < 1 ? 0 : Math.ceil(d.high / perPerson));
    const state: StaffState = holiday ? 'closed' : need === 0 || have >= needHigh ? 'ok' : have >= need ? 'tight' : 'short';
    return [{ ...d, need, needHigh, have, state, away, holiday }];
  });
}
