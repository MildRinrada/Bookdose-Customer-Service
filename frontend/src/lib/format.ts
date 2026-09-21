/* Formatting shared by every screen: dates in Thai, numbers, durations and the plain text of a formatted message. */

type DateInput = string | number | Date | null | undefined;

const toDate = (value: Exclude<DateInput, null | undefined>) => (value instanceof Date ? value : new Date(value));

/** "12 ก.ย." or, with the time, "12 ก.ย. 14:30"; '-' when there is no date. */
export function date(value: DateInput, withTime = false): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(toDate(value));
}

const minutesAgo = (value: Exclude<DateInput, null | undefined>) => Math.max(0, Math.floor((Date.now() - toDate(value).getTime()) / 60000));

/** "เมื่อสักครู่", "5 นาทีที่แล้ว", "3 ชม. ที่แล้ว", then the date. */
export function relative(value: DateInput): string {
  if (!value) return '-';
  const min = minutesAgo(value);
  return min < 1 ? 'เมื่อสักครู่' : min < 60 ? `${min} นาทีที่แล้ว` : min < 1440 ? `${Math.floor(min / 60)} ชม. ที่แล้ว` : date(value);
}

/** The same, shorter, for narrow lists: "5 นาที", "3 ชม.". */
export function shortAgo(value: DateInput): string {
  if (!value) return '-';
  const min = minutesAgo(value);
  return min < 1 ? 'เมื่อสักครู่' : min < 60 ? `${min} นาที` : min < 1440 ? `${Math.floor(min / 60)} ชม.` : date(value);
}

const clock = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit' });

/** "14:30" */
export function clockTime(value: Exclude<DateInput, null | undefined>): string {
  return clock.format(toDate(value));
}

/** "วันนี้", "เมื่อวาน", or the weekday and date: the divider above each day's messages. */
export function dayLabel(when: Date): string {
  const day = when.toDateString();
  if (day === new Date().toDateString()) return 'วันนี้';
  if (day === new Date(Date.now() - 864e5).toDateString()) return 'เมื่อวาน';
  return new Intl.DateTimeFormat('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(when);
}

/** Formatting marks are for reading the message itself; a preview or an excerpt shows the words only. */
export function plainText(text: string | null | undefined): string {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(#{1,6}|[-*•]|\d+\.)\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "1 ชม. 5 นาที" or "45 นาที"; '-' when unknown. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '-';
  const n = Math.round(minutes);
  if (n < 60) return `${n} นาที`;
  if (n < 1440) return `${Math.floor(n / 60)} ชม. ${n % 60} นาที`;
  // A day and over: "24 ชม. 7 นาที" is a figure nobody reads as a day. Minutes stop mattering at this scale, so the
  // remainder is rounded to hours (and a remainder that rounds to a full day becomes one).
  let days = Math.floor(n / 1440);
  let hours = Math.round((n % 1440) / 60);
  if (hours === 24) {
    days += 1;
    hours = 0;
  }
  return hours ? `${days} วัน ${hours} ชม.` : `${days} วัน`;
}

/** 1,234 */
export function number(value: number | string | null | undefined): string {
  return Number(value ?? 0).toLocaleString('th-TH');
}

/** ★★★☆☆ */
export function starsText(rating: number): string {
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

type SlaTicket = {
  status: string;
  first_response_at?: string | null;
  first_response_due_at?: string | null;
  resolution_due_at?: string | null;
};

export function isDone(ticket: { status: string }): boolean {
  return ['resolved', 'closed'].includes(ticket.status);
}

/** Past its first-response or resolution deadline and not finished yet. */
export function overdue(ticket: SlaTicket): boolean {
  const now = Date.now();
  return (
    !isDone(ticket) &&
    ((!ticket.first_response_at && !!ticket.first_response_due_at && new Date(ticket.first_response_due_at).getTime() < now) ||
      (!!ticket.resolution_due_at && new Date(ticket.resolution_due_at).getTime() < now))
  );
}
