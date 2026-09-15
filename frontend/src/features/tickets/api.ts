import { api, download } from '@/lib/api/client';
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

export function updateTicket(id: string, changes: TicketChanges) {
  return api<{ ok: true }>(ticketPath(id), changes, 'PATCH');
}

/** Moves the case to the recycle bin (admins only). */
export function deleteTicket(id: string) {
  return api<{ deleted: string }>(ticketPath(id), undefined, 'DELETE');
}

/** Every case the member may see, as the server's CSV (recorded in the activity log). */
export function exportTickets() {
  return download('/api/export/tickets.csv', `bookdose-tickets-${new Date().toISOString().slice(0, 10)}.csv`);
}
