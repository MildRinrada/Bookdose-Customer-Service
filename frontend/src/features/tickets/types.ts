/* Shapes of the case API (backend/modules/tickets). Field names are the server's. */

import type { AuditEvent } from '@/features/audit/types';
import type { TicketAutomation } from '@/features/automation/types';
import type { Contact } from '@/features/contacts/types';
import type { Conversation, Message } from '@/features/inbox/types';
import type { TicketSummary } from '@/lib/types';

/** A row of GET /api/tickets (repository.list_with_contacts): the case, its customer and escalation. */
export type TicketRow = TicketSummary & {
  category?: string;
  contact_id?: string | null;
  contact_name?: string;
  company?: string | null;
  /** The newest message the customer can see (no notes) in the case's conversations. */
  last_public_kind?: string | null;
  last_public_at?: string | null;
  escalated_at?: string | null;
  escalation_reason?: string | null;
};

/** The case itself in GET /api/tickets/<id> (a tickets row). */
export type Ticket = TicketSummary & {
  category: string;
  contact_id: string;
};

/** A conversation of the case, with its messages (tickets.service.ticket_detail). */
export type TicketConversation = Conversation & { messages: Message[] };

/** GET /api/tickets/<id> */
export type TicketDetail = {
  ticket: Ticket;
  contact: Contact;
  conversations: TicketConversation[];
  events: AuditEvent[];
  automation: TicketAutomation | null;
};

/** PATCH /api/tickets/<id>: fields left out keep the case's current value. */
export type TicketChanges = Partial<Record<'status' | 'priority' | 'team_id' | 'assignee_id', string>>;

/** POST /api/tickets */
export type NewTicket = {
  subject: string;
  contact_id: string;
  priority?: string;
  category?: string;
  team_id?: string;
  assignee_id?: string;
  body?: string;
};
