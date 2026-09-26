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
  /** Its latest satisfaction answer (the service report; `channel` is its first conversation's). */
  csat_rating?: number | null;
  csat_at?: string | null;
  csat_comment?: string | null;
  /** How many times it went back to work after being resolved or closed, and the last time. */
  reopens?: number;
  reopened_at?: string | null;
  /** ป้ายเคส: ids from the organization's list (tags.ts). */
  tags?: string[];
} & Snooze;

/** พักเคส: when a paused case comes back, why it was paused and who paused it (null / '' when it is not paused). */
export type Snooze = {
  snoozed_until?: string | null;
  snooze_note?: string;
  snoozed_by?: string;
};

/** The case itself in GET /api/tickets/<id> (a tickets row). */
export type Ticket = TicketSummary &
  Snooze & {
    category: string;
    contact_id: string;
    /** ป้ายเคส: ids from the organization's list, in its order. */
    tags?: string[];
  };

/** A conversation of the case, with its messages (tickets.service.ticket_detail). */
/** customer_read_at: web chats, when the customer last opened it ("อ่านแล้ว"), if the server includes it. */
export type TicketConversation = Conversation & { messages: Message[]; customer_read_at?: string | null };

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
