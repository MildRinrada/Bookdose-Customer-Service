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

export type ContactStats = { total: number; open: number; late: number; last: string };

export function contactTicketStats(contacts: Contact[], tickets: TicketRow[]): Map<string, ContactStats> {
  const stats = new Map<string, ContactStats>(contacts.map((c) => [c.id, { total: 0, open: 0, late: 0, last: '' }]));
  tickets.forEach((t) => {
    const s = stats.get(t.contact_id ?? '');
    if (!s) return;
    s.total++;
    if (!isDone(t)) s.open++;
    if (overdue(t)) s.late++;
    if (t.updated_at > s.last) s.last = t.updated_at;
  });
  return stats;
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
