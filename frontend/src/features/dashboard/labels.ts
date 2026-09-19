import type { TicketRow } from '@/features/tickets/types';
import { formatDuration, isDone, plainText, relative, shortAgo } from '@/lib/format';
import { escalationReasons } from '@/lib/labels';
import type { StaffAlerts } from '@/lib/types';
import type { AgentActivity, Heatmap } from './types';

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

/** Why the chatbot handed a conversation to a person (ai_conversations.reason; ai/service.py handoff). */
export const botReasonLabels: Record<string, string> = {
  customer: 'ลูกค้าขอคุยกับเจ้าหน้าที่',
  insufficient_knowledge: 'ไม่มีบทความที่ตอบได้',
  attachment_requires_staff: 'ลูกค้าส่งไฟล์แนบ',
  staff: 'เจ้าหน้าที่รับเรื่องเอง',
  timeout: 'AI ตอบช้าเกินเวลา',
  changed: 'ลูกค้าส่งข้อความเพิ่มระหว่างรอคำตอบ',
  settings_changed: 'มีการเปลี่ยนการตั้งค่า AI',
  disabled: 'ปิดบอต AI',
  quota: 'ใช้ AI ครบโควตาของวัน',
  not_configured: 'ยังไม่ได้ตั้ง API Key',
  unauthorized: 'API Key ใช้ไม่ได้',
  rate_limit: 'ผู้ให้บริการ AI จำกัดการใช้งานชั่วคราว',
  provider: 'ผู้ให้บริการ AI ขัดข้อง',
  invalid_output: 'คำตอบของ AI ใช้ไม่ได้',
};

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
   windows and what that means for the shifts. Every figure is an average per week over the period, or with `totals`
   (the report's chosen dates) the count over the whole period. */
export function heatmapParts({ weeks, counts }: Heatmap, totals = false) {
  const flat = counts.flat();
  const total = flat.reduce((sum, n) => sum + n, 0);
  const max = Math.max(0, ...flat);
  const level = (n: number) => (n ? Math.min(4, Math.ceil((4 * n) / max)) : 0);
  const avg = (n: number) => (totals ? String(n) : (n / weeks).toFixed(1));
  const per = totals ? 'เรื่อง' : 'เรื่อง/สัปดาห์';
  const amount = (n: number) => (totals ? `${n} เรื่อง` : `เฉลี่ย ${avg(n)} ${per}`);
  const rows = heatDays.map((d) => ({
    day: weekdayShort[d],
    cells: counts[d].map((n, h): HeatCell => ({ level: level(n), tip: `${weekdayShort[d]} ${hourText(h)}–${hourText(h + 1)} · ${amount(n)}` })),
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
  if (total < 20) advice.push({ label: 'ข้อมูลยังน้อย', detail: `มี ${total} เรื่อง${totals ? 'ในช่วงนี้' : `ใน ${weeks} สัปดาห์`} ผลวิเคราะห์จะแม่นขึ้นเมื่อมีเรื่องมากขึ้น` });
  if (peaks.length)
    advice.push({
      label: `เพิ่มคนพร้อมตอบช่วง ${weekdayShort[peaks[0].d]} ${hourText(peaks[0].s)}–${hourText(peaks[0].s + 3)}`,
      detail: `ช่วงเดียวมีเรื่องเข้า ${share(peaks[0].n)}% ของ${totals ? 'ทั้งช่วง' : 'ทั้งสัปดาห์'}`,
    });
  const last = dayTotals[dayTotals.length - 1];
  if (dayTotals[0].n)
    advice.push({
      label: `${weekdayFull[dayTotals[0].d]} งานเข้ามากที่สุด`,
      detail: `${share(dayTotals[0].n)}% ของเรื่อง${totals ? 'ทั้งช่วง' : 'ทั้งสัปดาห์'} · ${weekdayFull[last.d]} น้อยที่สุด (${share(last.n)}%)`,
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
    peaks: peaks.map((p): PeakLine => ({ label: `${weekdayFull[p.d]} ${hourText(p.s)}–${hourText(p.s + 3)}`, detail: `${amount(p.n)} · ${share(p.n)}% ของ${totals ? 'ทั้งช่วง' : 'ทั้งสัปดาห์'}` })),
    advice,
  };
}
