/* Shapes of the conversation API (backend/modules/conversations). Field names are the server's. */

import type { AiCitation, AiState } from '@/features/ai/types';
import type { ChannelDeliveryState } from '@/features/channels/types';
import type { GuestReach } from '@/features/guest/types';
import type { MessageFile } from '@/lib/types';

export type Channel = 'web' | 'line' | 'email' | 'facebook' | 'manual';

/** A row of GET /api/conversations (repository.list_with_previews). */
export type ConversationSummary = {
  id: string;
  contact_id: string;
  subject: string;
  channel: string;
  team_id: string | null;
  status: 'open' | 'closed' | string;
  created_at: string;
  updated_at: string;
  contact_name: string;
  company: string | null;
  ticket_id: string | null;
  ticket_number: number | null;
  ticket_status: string | null;
  ticket_priority: string | null;
  /** The newest message (notes included). */
  preview: string | null;
  last_kind: MessageKind | null;
  /** The newest message the customer can see (no notes). */
  last_public_kind: MessageKind | null;
  /** When that message was written (how long a customer has waited, when it is theirs). */
  last_public_at?: string | null;
  /** Set when the customer chatted on the web without an account: how they can be reached again. */
  guest?: GuestReach | null;
};

export type MessageKind = 'customer' | 'reply' | 'note';

/** One message of a conversation (conversations.service.message_list). */
export type Message = {
  id: string;
  author_name: string;
  /** The team member who wrote it (staff screens only; a customer's copy never carries it). */
  author_id?: string | null;
  kind: MessageKind | string;
  body: string;
  /** 'stored' for messages read on the support page; the outbox state for LINE / Email / Facebook replies. */
  delivery: string;
  created_at: string;
  attachments: MessageFile[];
  /** Staff only: set when the reply is delivered by a provider (null otherwise, and always null for customers). */
  channel_delivery: ChannelDeliveryState | null;
  source: 'human' | 'ai' | 'system' | string;
  citations: AiCitation[];
  /** The satisfaction survey message. */
  survey: boolean;
  /** When the writer last corrected it; the thread says "แก้ไขแล้ว" from then on. */
  edited_at?: string | null;
  /** Set when the message was taken back: the words are gone, the marker stays for the team (never sent to a customer). */
  deleted_at?: string | null;
  deleted_by?: string | null;
};

/** The conversation itself in GET /api/conversations/<id>. */
export type Conversation = {
  id: string;
  contact_id: string;
  subject: string;
  channel: string;
  team_id: string | null;
  status: 'open' | 'closed' | string;
  created_at: string;
  updated_at: string;
  ai: AiState;
  /** LINE only: a one-to-one chat ('user') or a group / room. */
  line: { source_type: string; active: number | boolean } | null;
  category: string | null;
  /** What the customer gave as a reference when starting the chat (an earlier case, a member number…). */
  reference?: string;
  /** A web chat without an account (see ConversationSummary.guest). */
  guest?: GuestReach | null;
};

export type ConversationContact = {
  id: string;
  name: string;
  email: string | null;
  phone?: string | null;
  company?: string | null;
  guest?: GuestReach | null;
} & Record<string, unknown>;

export type ConversationTicket = {
  id: string;
  number: number;
  status: string;
  priority: string;
} & Record<string, unknown>;

/** GET /api/conversations/<id> */
export type ConversationDetail = {
  conversation: Conversation;
  messages: Message[];
  contact: ConversationContact;
  ticket: ConversationTicket | null;
  /** Web chats: when the customer (account or guest) last opened the conversation, for "อ่านแล้ว". */
  customer_read_at?: string | null;
};
