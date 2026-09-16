import type { GuestConversation, WidgetPosition, WidgetTheme } from './types';

/* The guest chat's words: widget choices for the settings, how a guest can be reached (staff side), and small
   helpers the screens share. */

export const widgetThemes: Array<{ value: WidgetTheme; label: string }> = [
  { value: 'purple', label: 'ม่วง' },
  { value: 'blue', label: 'น้ำเงิน' },
  { value: 'green', label: 'เขียว' },
  { value: 'orange', label: 'ส้ม' },
  { value: 'charcoal', label: 'เทาเข้ม' },
];

export const widgetPositions: Array<{ value: WidgetPosition; label: string }> = [
  { value: 'right', label: 'มุมขวาล่าง' },
  { value: 'left', label: 'มุมซ้ายล่าง' },
];

export const isWidgetTheme = (value: unknown): value is WidgetTheme => widgetThemes.some((t) => t.value === value);

/** How the team can reach a guest again (GuestReach.follow). */
export const followLabels: Record<string, string> = {
  browser: 'เบราว์เซอร์ที่ใช้แชท',
  email: 'อีเมล',
  sms: 'SMS',
  line: 'LINE',
};

export function reachText(follow: string[] | null | undefined): string {
  const names = (follow ?? []).map((key) => followLabels[key] ?? key);
  return names.length ? `ติดตามแชทได้ทาง ${names.join(' · ')}` : 'ยังไม่มีช่องทางติดตาม ลูกค้าต้องกลับมาที่หน้าแชทเอง';
}

export const unreadCount = (c: Pick<GuestConversation, 'unread'>) => (typeof c.unread === 'number' ? c.unread : c.unread ? 1 : 0);

/** Newest first. */
export const byNewest = (a: GuestConversation, b: GuestConversation) => String(b.updated_at).localeCompare(String(a.updated_at));

/** An allowed website for the widget: https://host[:port], or http://localhost / 127.0.0.1 while testing. Returns the
    normalized origin, or '' when the text is not one. */
export function websiteOrigin(text: string): string {
  const value = text.trim().replace(/\/+$/, '');
  if (!value) return '';
  let url: URL;
  try {
    url = new URL(value.includes('://') ? value : `https://${value}`);
  } catch {
    return '';
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return '';
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) return '';
  return url.origin;
}
