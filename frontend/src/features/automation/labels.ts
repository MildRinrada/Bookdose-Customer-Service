import { date, formatDuration } from '@/lib/format';
import { priorityLabels, statusLabels } from '@/lib/labels';
import type { AutomationRule, Followup, Macro, MacroRunResult } from './types';

/* The automation module's own words, and the sentences built from a rule, a macro or a macro's result. */

export const ruleChannelLabels: Record<string, string> = {
  '': 'ทุกช่องทาง',
  web: 'แชทบนเว็บ',
  line: 'LINE',
  email: 'Email',
  facebook: 'Facebook Messenger',
  instagram: 'Instagram',
  manual: 'เคสที่เจ้าหน้าที่บันทึกเอง',
};

export const macroStatusLabels: Record<string, string> = {
  '': 'ไม่เปลี่ยนสถานะ',
  open: statusLabels.open,
  pending_customer: statusLabels.pending_customer,
  pending_internal: statusLabels.pending_internal,
  resolved: statusLabels.resolved,
  closed: statusLabels.closed,
};

export const macroResultLabels: Record<string, string> = {
  reply: 'ส่งข้อความแล้ว',
  status: 'เปลี่ยนสถานะแล้ว',
  followup: 'ตั้งเตือนติดตามแล้ว',
};

/** The follow-up form's choices: hours from now → label (24 is the default). */
export const followupChoices: Record<string, string> = {
  '1': 'อีก 1 ชั่วโมง',
  '4': 'อีก 4 ชั่วโมง',
  '24': 'พรุ่งนี้ (24 ชม.)',
  '72': 'อีก 3 วัน',
};

/** "3 วัน" for whole days, otherwise "5 ชั่วโมง". */
export function hoursLabel(value: number | string): string {
  const h = Number(value);
  return h >= 24 && h % 24 === 0 ? `${h / 24} วัน` : `${h} ชั่วโมง`;
}

/** "มาจาก Facebook Messenger และมีคำว่า “เข้าสู่ระบบไม่ได้” หรือ “ระบบล่ม”" */
export function ruleCondition(rule: Pick<AutomationRule, 'channel' | 'keywords'>): string {
  const words = rule.keywords ? rule.keywords.split('\n') : [];
  return [
    `มาจาก${ruleChannelLabels[rule.channel] || 'ทุกช่องทาง'}`,
    ...(words.length ? [`มีคำว่า ${words.map((w) => `“${w}”`).join(' หรือ ')}`] : []),
  ].join(' และ ');
}

export function ruleActions(
  rule: Pick<AutomationRule, 'set_priority' | 'set_team_id' | 'set_assignee_id' | 'set_tags'>,
  teamName: (id: string) => string,
  memberName: (id: string) => string,
  tagName: (id: string) => string = () => '',
): string {
  const tags = (rule.set_tags ?? []).map(tagName).filter(Boolean);
  return [
    rule.set_priority && `ความเร่งด่วน${priorityLabels[rule.set_priority]}`,
    // A space before the name, as "มอบหมาย" has: a team called "Customer Success" would otherwise run straight
    // into the Thai word before it ("ส่งให้Customer Success").
    rule.set_team_id && `ส่งให้ ${teamName(rule.set_team_id)}`,
    rule.set_assignee_id && `มอบหมาย ${memberName(rule.set_assignee_id)}`,
    // A rule may put on up to ten: three by name keeps the line readable, the rest are counted.
    tags.length > 0 && `ติดป้าย ${tags.slice(0, 3).map((t) => `“${t}”`).join(' ')}${tags.length > 3 ? ` และอีก ${tags.length - 3} ป้าย` : ''}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "ส่งข้อความแม่แบบ → เปลี่ยนสถานะเป็น “รอลูกค้า” → เตือนติดตามใน 1 วัน". reply: the template, or whether there is one. */
export function macroSteps(macro: Pick<Macro, 'set_status' | 'followup_hours'> & { reply: string | boolean }): string {
  return [
    macro.reply && 'ส่งข้อความแม่แบบ',
    macro.set_status && `เปลี่ยนสถานะเป็น “${statusLabels[macro.set_status]}”`,
    Number(macro.followup_hours) > 0 && `เตือนติดตามใน ${hoursLabel(macro.followup_hours)}`,
  ]
    .filter(Boolean)
    .join(' → ');
}

/** The toast after running a macro: what was done, and what did not apply. */
export function macroResultText(result: MacroRunResult): string {
  const done = result.done.map((step) => macroResultLabels[step]).join(' · ') || 'ไม่มีขั้นตอนที่ต้องทำ';
  const skipped = [
    result.skipped.includes('reply') && 'ไม่ได้ส่งข้อความ (ไม่มีช่องทางตอบลูกค้า)',
    result.skipped.includes('ticket') && 'ยังไม่มีเคส จึงไม่ได้เปลี่ยนสถานะหรือตั้งเตือน',
  ]
    .filter(Boolean)
    .join(' · ');
  return skipped ? `${done} · ${skipped}` : done;
}

/** Whether a reminder is past due, and the line under it ("เสร็จ …", "ถึงเวลาแล้ว · …", "… · อีก 3 ชม. 5 นาที"). */
export function followupState(followup: Pick<Followup, 'due_at' | 'done_at'>, now = Date.now()): { late: boolean; when: string } {
  const due = new Date(followup.due_at).getTime();
  const late = !followup.done_at && due <= now;
  const when = followup.done_at
    ? `เสร็จ ${date(followup.done_at, true)}`
    : late
      ? `ถึงเวลาแล้ว · ${date(followup.due_at, true)}`
      : `${date(followup.due_at, true)} · อีก ${formatDuration((due - now) / 60000)}`;
  return { late, when };
}
