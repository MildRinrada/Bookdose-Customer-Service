import { clockTime, date, isDone, overdue } from '@/lib/format';
import { escalationReasons } from '@/lib/labels';
import type { TicketEscalation } from '@/features/automation/types';
import type { Snooze, TicketRow } from './types';

type Snoozeable = Snooze & Record<string, unknown>;

/* The case list's words and rules: quick scopes, the filters that live in the address, row spacing and how late a
   case is. */

export const ticketScopes: Record<string, string> = {
  all: 'ทุกเคส',
  active: 'กำลังดูแล',
  mine: 'งานของฉัน',
  overdue: '⚠ เกิน SLA',
  snoozed: 'พักไว้',
  resolved_today: 'แก้ไขสำเร็จวันนี้',
};

export const densityLabels: Record<string, string> = { comfortable: 'อ่านสบาย', compact: 'กระชับ' };

/** The list's filters as they appear in the address: /tickets?q=&status=&priority=&contact=&assignee=&filter=<scope>. */
export type TicketFilter = { q?: string; status?: string; priority?: string; contact?: string; assignee?: string; filter?: string };

export const FILTER_KEYS = ['q', 'status', 'priority', 'contact', 'assignee', 'filter'] as const;

/** งานค้าง: what somebody has to do something about now - open, not waiting for the customer, not paused. The manager
    view's count of it opens /tickets?assignee=<id>&filter=backlog, to hand some of it to someone else. */
export const BACKLOG_SCOPE = 'backlog';

/* พักเคส. A paused case is not work anybody can do now, so the working scopes walk past it - that is the whole point
   of pausing one. ทุกเคส still means all of them: a list that says "every case" and quietly leaves some out is a list
   nobody can count from. The paused ones have their own scope, so what was put down is one click away, never lost. */

export function isSnoozed(t: Snoozeable): boolean {
  return Boolean(t.snoozed_until) && new Date(t.snoozed_until as string).getTime() > Date.now();
}

export function inScope(t: TicketRow, scope: string | undefined, me: string): boolean {
  const awake = !isSnoozed(t);
  return (
    !scope ||
    scope === 'all' ||
    (scope === 'active' && !isDone(t) && awake) ||
    (scope === 'mine' && !isDone(t) && awake && t.assignee_id === me) ||
    (scope === 'overdue' && overdue(t) && awake) ||
    (scope === 'snoozed' && isSnoozed(t)) ||
    (scope === BACKLOG_SCOPE && !isDone(t) && awake && t.status !== 'pending_customer') ||
    (scope === 'resolved_today' && isDone(t) && new Date(t.resolved_at ?? '').toDateString() === new Date().toDateString())
  );
}

/** Search, customer, status and priority; the scope (all / mine / overdue …) is applied on top of them. */
export function matchesTicketFilters(t: TicketRow, f: TicketFilter): boolean {
  const q = (f.q || '').toLowerCase();
  return (
    (!q || [t.subject, t.contact_name, t.company, `BD-${t.number}`, t.category].some((v) => String(v).toLowerCase().includes(q))) &&
    (!f.contact || t.contact_id === f.contact) &&
    (!f.assignee || t.assignee_id === f.assignee) &&
    (!f.status || t.status === f.status) &&
    (!f.priority || t.priority === f.priority)
  );
}

/** The address of the list with these filters (empty ones left out). */
export function ticketsHref(f: TicketFilter): string {
  const query = FILTER_KEYS.filter((key) => f[key])
    .map((key) => `${key}=${encodeURIComponent(f[key] as string)}`)
    .join('&');
  return '/tickets' + (query ? `?${query}` : '');
}

/** How long a case has been past its SLA ('' when it isn't), e.g. '2 ชม.'. */
export function lateBy(t: TicketRow): string {
  if (!overdue(t)) return '';
  const due = [!t.first_response_at && t.first_response_due_at, t.resolution_due_at]
    .filter((d): d is string => Boolean(d) && new Date(d as string) < new Date())
    .map((d) => new Date(d).getTime());
  const min = Math.max(1, Math.floor((Date.now() - Math.min(...due)) / 60000));
  return min < 60 ? `${min} นาที` : min < 1440 ? `${Math.floor(min / 60)} ชม.` : `${Math.floor(min / 1440)} วัน`;
}

/** A moment today at the given hour, on the member's own clock. */
function atHour(days: number, hour: number): Date {
  const when = new Date();
  when.setDate(when.getDate() + days);
  when.setHours(hour, 0, 0, 0);
  return when;
}

/* What a case is usually put down for. These are worked out in the browser, because "พรุ่งนี้ 9 โมง" is nine in the
   morning where the member is, and only their own clock knows where that is; the server is sent the moment itself. */
export const snoozeChoices: Array<{ value: string; label: string; when: () => Date }> = [
  { value: 'later', label: 'อีก 3 ชม.', when: () => new Date(Date.now() + 3 * 3600_000) },
  { value: 'tomorrow', label: 'พรุ่งนี้ 9 โมง', when: () => atHour(1, 9) },
  { value: 'monday', label: 'จันทร์หน้า 9 โมง', when: () => atHour((8 - new Date().getDay()) % 7 || 7, 9) },
  { value: 'week', label: 'อีก 7 วัน 9 โมง', when: () => atHour(7, 9) },
];

/** When a paused case comes back, in words: "วันนี้ 16:00", "พรุ่งนี้ 09:00", "12 ก.ย. 09:00". */
export function snoozeUntilText(until: string | null | undefined): string {
  if (!until) return '';
  const when = new Date(until);
  const day = when.toDateString();
  if (day === new Date().toDateString()) return `วันนี้ ${clockTime(when)}`;
  if (day === new Date(Date.now() + 864e5).toDateString()) return `พรุ่งนี้ ${clockTime(when)}`;
  return date(when, true);
}

/** The escalation line in the case heading: the reason and who was told (or got the case). */
export function escalationText(e: TicketEscalation | null | undefined, memberName: (id: string | null | undefined) => string): string {
  if (!e) return '';
  const who = e.to_user_id ? ` · ${e.reason === 'unclaimed' ? 'ย้ายให้' : 'แจ้ง'} ${memberName(e.to_user_id)}` : '';
  return `${escalationReasons[e.reason] || 'ยกระดับแล้ว'}${who}`;
}
