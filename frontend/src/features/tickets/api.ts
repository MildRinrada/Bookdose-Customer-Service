import { celebrate } from '@/features/staff-account/celebrate';
import { api, download } from '@/lib/api/client';
import { isDone } from '@/lib/format';
import type { Hand } from '@/lib/types';
import type { NewTicket, TicketChanges } from './types';

/* The case endpoints (backend/modules/tickets/routes.py). Read the list with useStaffTickets() and one case with
   useApi(ticketPath(id)). */

export const TICKETS_PATH = '/api/tickets';

export const ticketPath = (id: string) => `/api/tickets/${id}`;

/** What a change to a case touches: the case list and screens (prefix of every case path), the inbox rows that show
    the case's status, and the overview / alerts built from cases. */
export const TICKET_PREFIXES = ['/api/tickets', '/api/conversations', '/api/automation'];

export function createTicket(body: NewTicket) {
  return api<{ id: string }>(TICKETS_PATH, body);
}

/** `before` is the case as the member saw it: closing an open case is celebrated (Celebrations in the staff frame). */
export async function updateTicket(id: string, changes: TicketChanges, before?: { status: string; number: number }) {
  const saved = await api<{ ok: true }>(ticketPath(id), changes, 'PATCH');
  if (before && changes.status && !isDone(before) && isDone({ status: changes.status }))
    celebrate({ kind: 'resolved', title: `ปิดเคส BD-${before.number} แล้ว`, detail: 'ขอบคุณที่ดูแลลูกค้าจนจบเรื่อง' });
  return saved;
}

/** พักเคส: `until` is an absolute moment (an ISO string), worked out from the member's own clock. */
export function snoozeTicket(id: string, until: string, note: string) {
  return api<{ snoozed_until: string }>(`${ticketPath(id)}/snooze`, { until, note });
}

/** Back into the queue now, before the pause is over. */
export function wakeTicket(id: string) {
  return api<{ ok: true }>(`${ticketPath(id)}/snooze`, undefined, 'DELETE');
}

/** ยกมือขอช่วย: the case's team and the organization's owners see it at once (backend tickets/hands.py). */
export function raiseHand(id: string, note: string) {
  return api<{ hand: Hand }>(`${ticketPath(id)}/hand`, { note });
}

/** เข้าไปช่วย: the one who asked sees who is coming. */
export function helpHand(id: string) {
  return api<{ hand: Hand }>(`${ticketPath(id)}/hand/help`, {});
}

export function lowerHand(id: string) {
  return api<{ ok: true }>(`${ticketPath(id)}/hand`, undefined, 'DELETE');
}

/** Moves the case to the recycle bin (admins only). */
export function deleteTicket(id: string) {
  return api<{ deleted: string }>(ticketPath(id), undefined, 'DELETE');
}

/** Every case the member may see, as the server's CSV (recorded in the activity log). */
export function exportTickets() {
  return download('/api/export/tickets.csv', `bookdose-tickets-${new Date().toISOString().slice(0, 10)}.csv`);
}
