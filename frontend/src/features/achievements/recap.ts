import type { Recap } from './api';

/* What a month's card says, worked out once for the page (RecapCard) and the picture saved from it (recapImage.ts),
   so the two never disagree. */

/** The emoji beside each title (backend recap.py _title). */
export const TITLE_EMOJI: Record<string, string> = {
  night: '🌙',
  one_touch: '🎯',
  darling: '💖',
  lightning: '⚡',
  praised: '🌟',
  record: '🏆',
  helper: '🤝',
  weekend: '🛡️',
  early: '🌅',
  marathon: '🏃',
  guardian: '💪',
};

export type RecapFact = { label: string; value: string; sub: string };

/** "38 วินาที", "4 นาที", "1 ชม. 20 นาที" */
export function shortDuration(minutes: number): string {
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))} วินาที`;
  if (minutes < 60) return `${Math.round(minutes)} นาที`;
  const hours = Math.floor(minutes / 60);
  const left = Math.round(minutes % 60);
  return left ? `${hours} ชม. ${left} นาที` : `${hours} ชม.`;
}

const number = (value: number) => value.toLocaleString('th-TH');

/** "14 ส.ค." */
function dayText(day: string) {
  return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' }).format(new Date(`${day}T12:00:00+07:00`));
}

function versus(now: number, before: number, unit: string) {
  if (!before) return unit;
  const diff = now - before;
  return diff > 0 ? `มากกว่าเดือนก่อน ${number(diff)}` : diff < 0 ? `น้อยกว่าเดือนก่อน ${number(-diff)}` : 'เท่ากับเดือนก่อน';
}

/** The six figures of the card, in reading order. */
export function recapFacts(r: Recap): RecapFact[] {
  return [
    { label: 'ปิดเคส', value: number(r.closed), sub: versus(r.closed, r.previous.closed, 'เคส') },
    { label: 'ตอบลูกค้า', value: number(r.replies), sub: versus(r.replies, r.previous.replies, 'ข้อความ') },
    { label: 'ลูกค้าที่ดูแล', value: number(r.customers), sub: 'คน' },
    {
      label: 'ตอบเร็วที่สุด',
      value: r.fastest_minutes == null ? '-' : shortDuration(r.fastest_minutes),
      sub: r.median_minutes == null ? 'ยังไม่มีคำตอบให้วัด' : `ปกติราว ${shortDuration(r.median_minutes)}`,
    },
    { label: 'วันที่ยุ่งที่สุด', value: r.busiest ? dayText(r.busiest.day) : '-', sub: r.busiest ? `ตอบ ${number(r.busiest.count)} ข้อความ` : 'ยังไม่มี' },
    {
      label: 'ได้ 5 ดาว',
      value: number(r.five_star),
      sub: r.csat == null ? 'ครั้ง' : `คะแนนเฉลี่ย ${r.csat.toFixed(1)} จาก ${number(r.csat_count)} ครั้ง`,
    },
  ];
}

export const monthHeading = (r: Recap) => `สรุปผลงานเดือน${r.label}${r.partial ? ' (ถึงวันนี้)' : ''}`;
