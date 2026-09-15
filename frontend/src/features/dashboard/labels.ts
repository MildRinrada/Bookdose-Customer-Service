import type { TicketRow } from '@/features/tickets/types';
import { formatDuration, isDone, plainText, relative, shortAgo } from '@/lib/format';
import { escalationReasons } from '@/lib/labels';
import type { StaffAlerts } from '@/lib/types';
import type { AgentActivity, HealthState, Heatmap } from './types';

// The customer's project overview (CustomerDashboardScreen)
export const healthStateLabels: Record<HealthState, string> = {
  on_track: 'ตรงตามแผน',
  delayed: 'ล่าช้า',
  ahead: 'เสร็จก่อนกำหนด',
  done: 'เสร็จแล้ว',
  not_started: 'ยังไม่เริ่ม',
};
/** customer-state tone-* classes (pages/customer.css; 'late' is in pages/dashboard-customer.css). */
export const healthStateTones: Record<HealthState, string> = {
  on_track: 'working',
  delayed: 'late',
  ahead: 'done',
  done: 'done',
  not_started: 'received',
};
/** Late ones first, as the server sorts them. */
export const healthStates: HealthState[] = ['delayed', 'on_track', 'not_started', 'ahead', 'done'];

/** "อีก 5 วัน", "วันนี้", "เกิน 3 วัน" for a payment's due date. */
export function dueText(daysLeft: number): string {
  if (daysLeft > 0) return `อีก ${daysLeft} วัน`;
  return daysLeft === 0 ? 'ครบกำหนดวันนี้' : `เกินกำหนด ${-daysLeft} วัน`;
}

/** 0-100 of a money figure against another, for a <progress> bar. */
export function share(part: string | number, whole: string | number): number {
  const total = Number(whole);
  return total > 0 ? Math.min(100, Math.round((100 * Number(part)) / total)) : 0;
}

/** "ก.ย. 69" for a 'YYYY-MM' month. */
export function monthText(month: string): string {
  return new Intl.DateTimeFormat('th-TH', { month: 'short', year: '2-digit' }).format(new Date(`${month}-01T00:00:00`));
}

/* The overview's rules: what needs action now, what is addressed to the member, who is online and the busy hours. */

export type NeededItem = { t: TicketRow; due: number; rank: number; tone: 'danger' | 'warn' | 'info'; symbol: string; reason: string };

/* Cases the team should act on now: SLA breached, SLA due within 2 hours, customer replied last, or urgent without an owner. */
export function actionNeeded(tickets: TicketRow[]): NeededItem[] {
  const now = Date.now();
  const soon = 2 * 3600e3;
  return tickets
    .filter((t) => !isDone(t))
    .map((t): NeededItem | null => {
      const responseDue = t.first_response_at ? Infinity : new Date(t.first_response_due_at).getTime();
      const resolutionDue = new Date(t.resolution_due_at).getTime();
      const due = Math.min(responseDue, resolutionDue);
      if (due < now)
        return { t, due, rank: 0, tone: 'danger', symbol: 'clock', reason: responseDue < now ? 'เกินเวลาตอบกลับครั้งแรก' : 'เกินเวลาแก้ไขเคส' };
      if (due - now <= soon)
        return {
          t,
          due,
          rank: 1,
          tone: 'warn',
          symbol: 'clock',
          reason: `ใกล้ครบ SLA ${responseDue === due ? 'ตอบกลับ' : 'แก้ไข'} · เหลือ ${formatDuration((due - now) / 60000)}`,
        };
      if (t.last_public_kind === 'customer' && t.first_response_at)
        return { t, due, rank: 2, tone: 'info', symbol: 'chat', reason: `ลูกค้าตอบกลับล่าสุด ${relative(t.last_public_at)}` };
      if (t.priority === 'urgent' && !t.assignee_id) return { t, due, rank: 3, tone: 'info', symbol: 'users', reason: 'เร่งด่วนและยังไม่มีผู้รับผิดชอบ' };
      return null;
    })
    .filter((x): x is NeededItem => x !== null)
    .sort((a, b) => a.rank - b.rank || a.due - b.due);
}

export type MeItem = { rank: number; at: string; tone: 'danger' | 'warn' | 'info'; icon: string; title: string; detail: string; href: string; when: string };

/* What is waiting for this person: cases escalated to them first, then reminders that are due, then mentions,
   then reminders still ahead. */
export function meItems(alerts: StaffAlerts | null | undefined): MeItem[] {
  if (!alerts) return [];
  const now = Date.now();
  const items: MeItem[] = [];
  for (const e of alerts.escalations ?? [])
    items.push({
      rank: 0,
      at: e.escalated_at,
      tone: 'danger',
      icon: 'bolt',
      title: `BD-${e.number} ยกระดับมาหาคุณ`,
      detail: `${escalationReasons[e.reason ?? ''] || ''} · ${e.subject}`,
      href: `/tickets/${e.ticket_id}`,
      when: shortAgo(e.escalated_at),
    });
  for (const f of alerts.followups ?? []) {
    const due = new Date(f.due_at).getTime();
    const late = due <= now;
    items.push({
      rank: late ? 1 : 3,
      at: f.due_at,
      tone: late ? 'warn' : 'info',
      icon: 'clock',
      title: `${late ? 'ถึงเวลาติดตาม' : 'ติดตามผล'} BD-${f.number}`,
      detail: `${f.note} · ${f.subject ?? ''}`,
      href: `/tickets/${f.ticket_id}`,
      when: late ? 'ถึงกำหนด' : `อีก ${formatDuration((due - now) / 60000)}`,
    });
  }
  for (const m of alerts.mentions ?? [])
    items.push({
      rank: 2,
      at: m.created_at,
      tone: 'info',
      icon: 'at',
      title: `${m.author_name} กล่าวถึงคุณ`,
      detail: `${m.ticket_number ? `BD-${m.ticket_number} · ` : ''}${plainText(m.body).slice(0, 90)}`,
      href: m.ticket_id ? `/tickets/${m.ticket_id}` : `/inbox/${m.conversation_id}`,
      when: shortAgo(m.created_at),
    });
  return items.sort(
    (a, b) => a.rank - b.rank || (a.rank === 3 ? String(a.at).localeCompare(String(b.at)) : String(b.at).localeCompare(String(a.at))),
  );
}

// Manager view
export type Presence = 'online' | 'away' | 'offline';
export const presenceLabels: Record<Presence, string> = { online: 'กำลังใช้งาน', away: 'ไม่ได้ใช้งานชั่วคราว', offline: 'ออฟไลน์' };
const presenceOrder: Record<Presence, number> = { online: 0, away: 1, offline: 2 };
export const weekdayShort = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
export const weekdayFull = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];
/** Monday first, like a work week. */
export const heatDays = [1, 2, 3, 4, 5, 6, 0];

export function presence(seen: string | null): Presence {
  if (!seen) return 'offline';
  const minutes = (Date.now() - new Date(seen).getTime()) / 60000;
  return minutes <= 5 ? 'online' : minutes <= 30 ? 'away' : 'offline';
}

export const hourText = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;

export type AgentWithPresence = AgentActivity & { presence: Presence };

export function sortedAgents(agents: AgentActivity[]): AgentWithPresence[] {
  return agents
    .map((a) => ({ ...a, presence: presence(a.last_seen) }))
    .sort((x, y) => presenceOrder[x.presence] - presenceOrder[y.presence] || y.open - x.open || x.name.localeCompare(y.name, 'th'));
}

export type HeatCell = { level: number; tip: string };
export type PeakLine = { label: string; detail: string };

/* The week as a grid of hours, darker where more new conversations arrive, plus the three busiest three-hour
   windows and what that means for the shifts. Every figure is an average per week over the period. */
export function heatmapParts({ weeks, counts }: Heatmap) {
  const flat = counts.flat();
  const total = flat.reduce((sum, n) => sum + n, 0);
  const max = Math.max(0, ...flat);
  const level = (n: number) => (n ? Math.min(4, Math.ceil((4 * n) / max)) : 0);
  const avg = (n: number) => (n / weeks).toFixed(1);
  const rows = heatDays.map((d) => ({
    day: weekdayShort[d],
    cells: counts[d].map((n, h): HeatCell => ({ level: level(n), tip: `${weekdayShort[d]} ${hourText(h)}–${hourText(h + 1)} · เฉลี่ย ${avg(n)} เรื่อง/สัปดาห์` })),
  }));
  const windows: Array<{ d: number; s: number; n: number }> = [];
  for (const d of heatDays) for (let s = 0; s <= 21; s++) windows.push({ d, s, n: counts[d][s] + counts[d][s + 1] + counts[d][s + 2] });
  const peaks: typeof windows = [];
  for (const w of [...windows].sort((x, y) => y.n - x.n)) {
    if (!w.n || peaks.length === 3) break;
    if (!peaks.some((p) => p.d === w.d && Math.abs(p.s - w.s) < 3)) peaks.push(w);
  }
  const share = (n: number) => (total ? Math.round((100 * n) / total) : 0);
  const dayTotals = heatDays.map((d) => ({ d, n: counts[d].reduce((sum, x) => sum + x, 0) })).sort((x, y) => y.n - x.n);
  const quiet = windows.filter((w) => w.d >= 1 && w.d <= 5 && w.s >= 8 && w.s <= 17).sort((x, y) => x.n - y.n)[0];
  const advice: PeakLine[] = [];
  if (total < 20) advice.push({ label: 'ข้อมูลยังน้อย', detail: `มี ${total} เรื่องใน ${weeks} สัปดาห์ ผลวิเคราะห์จะแม่นขึ้นเมื่อมีเรื่องมากขึ้น` });
  if (peaks.length)
    advice.push({
      label: `เพิ่มคนพร้อมตอบช่วง ${weekdayShort[peaks[0].d]} ${hourText(peaks[0].s)}–${hourText(peaks[0].s + 3)}`,
      detail: `ช่วงเดียวมีเรื่องเข้า ${share(peaks[0].n)}% ของทั้งสัปดาห์`,
    });
  const last = dayTotals[dayTotals.length - 1];
  if (dayTotals[0].n)
    advice.push({
      label: `${weekdayFull[dayTotals[0].d]} งานเข้ามากที่สุด`,
      detail: `${share(dayTotals[0].n)}% ของเรื่องทั้งสัปดาห์ · ${weekdayFull[last.d]} น้อยที่สุด (${share(last.n)}%)`,
    });
  if (quiet && total)
    advice.push({ label: `ช่วงเงียบ: ${weekdayShort[quiet.d]} ${hourText(quiet.s)}–${hourText(quiet.s + 3)}`, detail: 'เหมาะกับพักกะ ประชุมทีม หรือเคลียร์งานหลังบ้าน' });
  const summary = peaks.length
    ? `ช่วงที่เรื่องเข้ามากที่สุด ${peaks.map((p) => `${weekdayFull[p.d]} ${hourText(p.s)} ถึง ${hourText(p.s + 3)}`).join(', ')}`
    : 'ยังไม่มีเรื่องเข้ามาในช่วงที่วิเคราะห์';
  return {
    weeks,
    total,
    summary,
    rows,
    peaks: peaks.map((p): PeakLine => ({ label: `${weekdayFull[p.d]} ${hourText(p.s)}–${hourText(p.s + 3)}`, detail: `เฉลี่ย ${avg(p.n)} เรื่อง/สัปดาห์ · ${share(p.n)}% ของทั้งสัปดาห์` })),
    advice,
  };
}
