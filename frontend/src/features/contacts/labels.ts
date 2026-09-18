import { isDone, overdue } from '@/lib/format';
import type { TicketRow } from '@/features/tickets/types';
import type { Contact } from './types';

/* The customer list's words and the numbers behind its filters and sorting. */

export const contactTagLabels: Record<string, string> = { all: 'ทั้งหมด', open: 'มีเคสค้าง', late: 'เกิน SLA', duplicate: 'อีเมลซ้ำ' };

export const contactSortColumns: Array<[ContactSortKey, string]> = [
  ['name', 'ลูกค้า'],
  ['email', 'ช่องทางติดต่อ'],
  ['cases', 'เคสบริการ'],
  ['last', 'ติดต่อล่าสุด'],
];

export type ContactSortKey = 'name' | 'email' | 'cases' | 'last' | 'company';

export const emailKey = (c: Pick<Contact, 'email'>) => (c.email || '').trim().toLowerCase();

/** Emails used by more than one contact. Visitor emails aren't verified, so staff merge duplicates themselves;
    nothing merges automatically. */
export function duplicateEmails(contacts: Contact[]): Set<string> {
  const seen = new Map<string, number>();
  contacts.forEach((c) => {
    const key = emailKey(c);
    if (key) seen.set(key, (seen.get(key) || 0) + 1);
  });
  return new Set([...seen].filter(([, count]) => count > 1).map(([key]) => key));
}

/** recent: cases opened in the last 30 days; cases: the customer's cases, latest update first (the quick view). */
export type ContactStats = { total: number; open: number; late: number; last: string; recent: number; cases: TicketRow[] };

const DAY = 86400e3;

export function contactTicketStats(contacts: Contact[], tickets: TicketRow[]): Map<string, ContactStats> {
  const stats = new Map<string, ContactStats>(contacts.map((c) => [c.id, { total: 0, open: 0, late: 0, last: '', recent: 0, cases: [] }]));
  const monthAgo = Date.now() - 30 * DAY;
  tickets.forEach((t) => {
    const s = stats.get(t.contact_id ?? '');
    if (!s) return;
    s.total++;
    s.cases.push(t);
    if (!isDone(t)) s.open++;
    if (overdue(t)) s.late++;
    if (new Date(t.created_at).getTime() >= monthAgo) s.recent++;
    if (t.updated_at > s.last) s.last = t.updated_at;
  });
  stats.forEach((s) => s.cases.sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
  return stats;
}

export type Mood = { face: string; label: string; tone: 'good' | 'okay' | 'bad' };

/** How satisfied the customer has been, from their answered surveys: a face to set the tone before writing. */
export function contactMood(c: Contact): Mood | null {
  const s = c.satisfaction;
  if (!s?.count) return null;
  if (s.average >= 4) return { face: '😊', label: 'พอใจ', tone: 'good' };
  if (s.average >= 3) return { face: '😐', label: 'เฉย ๆ', tone: 'okay' };
  return { face: '😟', label: 'ไม่ค่อยพอใจ', tone: 'bad' };
}

export type ContactBadge = { key: string; label: string; title: string; tone: 'dark' | 'warn' | 'danger' | 'info' };

/** Badges worked out from the customer's own cases and surveys; nothing is set by hand. */
export function contactBadges(c: Contact, s: ContactStats): ContactBadge[] {
  const badges: ContactBadge[] = [];
  const unhappy = (c.satisfaction?.count ?? 0) > 0 && c.satisfaction!.average < 3;
  if (unhappy || s.late >= 2)
    badges.push({
      key: 'care',
      label: 'ดูแลใกล้ชิด',
      tone: 'danger',
      title: [unhappy && `คะแนนความพึงพอใจเฉลี่ย ${c.satisfaction!.average}/5`, s.late >= 2 && `เคสเกิน SLA ${s.late} เรื่อง`].filter(Boolean).join(' · '),
    });
  if (s.recent >= 3) badges.push({ key: 'frequent', label: 'แจ้งบ่อย', tone: 'warn', title: `เปิดเคส ${s.recent} เรื่องใน 30 วันที่ผ่านมา` });
  if (s.total >= 5 && !unhappy) badges.push({ key: 'loyal', label: 'ลูกค้าประจำ', tone: 'dark', title: `ติดต่อมาแล้ว ${s.total} เคส` });
  if (Date.now() - new Date(c.created_at).getTime() < 7 * DAY && s.total <= 1)
    badges.push({ key: 'new', label: 'ลูกค้าใหม่', tone: 'info', title: 'เพิ่มเข้าระบบในสัปดาห์นี้' });
  return badges;
}

/** Name, email and organization sort alphabetically; cases and the last contact put the rows that need attention first. */
export function compareContacts(a: Contact, b: Contact, key: ContactSortKey, stats: Map<string, ContactStats>): number {
  if (key === 'cases') {
    const x = stats.get(a.id)!;
    const y = stats.get(b.id)!;
    return y.open - x.open || y.total - x.total;
  }
  if (key === 'last') return String(stats.get(b.id)!.last).localeCompare(String(stats.get(a.id)!.last));
  return String(a[key] || '').localeCompare(String(b[key] || ''), 'th');
}

/* The care profile's choices (backend/modules/contacts/model.py). */
export const preferredChannelLabels: Record<string, string> = {
  line: 'LINE',
  facebook: 'Facebook',
  web: 'แชทบนเว็บ',
  email: 'อีเมล',
  phone: 'โทรศัพท์',
};
export const languageLabels: Record<string, string> = { th: 'ภาษาไทย', en: 'English' };
export const consentLabels: Record<string, string> = { '': 'ยังไม่ได้ถาม', yes: 'ยินยอมให้ติดต่อกลับ', no: 'ไม่ยินยอมให้ติดต่อกลับ' };
export const TAGS_MAX = 10;
export const TAG_MAX = 30;
