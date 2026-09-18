import type { GuestReach } from '@/features/guest/types';

/* Shapes of the customer (contact) API (backend/modules/contacts). Field names are the server's. */

/** A row of GET /api/contacts (contacts + contact_names), also the contact of GET /api/tickets/<id>. */
export type Contact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  notes: string | null;
  created_at: string;
  updated_at?: string;
  created_by?: string | null;
  /** The split name; older contacts have only `name`. */
  first_name?: string | null;
  last_name?: string | null;
  /** The contact came from a web chat without an account: how they can be reached again. */
  guest?: GuestReach | null;
  /** Their answered satisfaction surveys (average 1-5), or null before any answer. */
  satisfaction?: { average: number; count: number; last: string } | null;
  /** The channel they wrote on most (web, line, email, facebook, manual). */
  main_channel?: string | null;
  /** How the team looks after them (the edit form's care profile), or null before it was first saved. */
  profile?: ContactProfile | null;
} & Record<string, unknown>;

/** contact_profiles: the team's tags, a warning shown on the customer's chats and cases, contact preferences, the
    language to answer in, consent to be contacted back and a data deletion request (who / when kept by the server). */
export type ContactProfile = {
  preferred_channel: '' | 'web' | 'line' | 'facebook' | 'email' | 'phone';
  contact_hours: string;
  language: '' | 'th' | 'en';
  tags: string[];
  warning: string;
  consent: '' | 'yes' | 'no';
  consent_at: string | null;
  consent_by: string;
  deletion_requested_at: string | null;
  deletion_requested_by: string;
  updated_by: string;
  updated_at: string;
};

/** GET /api/contacts/<id>/profile: the profile, the channels they talked on, guest / account reach and the last edit. */
export type ContactProfileView = {
  profile: ContactProfile | null;
  channels: { channel: string; conversations: number; last_at: string; addresses: string[] }[];
  guest: GuestReach | null;
  account: { line: boolean } | null;
  last_edit: { actor: string; action: string; created_at: string } | null;
};

export type ContactsPage = { contacts: Contact[] };

/** POST /api/contacts, PATCH /api/contacts/<id> */
export type ContactValues = {
  first_name: string;
  last_name?: string;
  email?: string;
  phone?: string;
  company?: string;
  notes?: string;
  preferred_channel?: string;
  contact_hours?: string;
  language?: string;
  tags?: string[];
  warning?: string;
  consent?: string;
  deletion_requested?: boolean;
};
