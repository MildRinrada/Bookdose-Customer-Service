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
} & Record<string, unknown>;

export type ContactsPage = { contacts: Contact[] };

/** POST /api/contacts, PATCH /api/contacts/<id> */
export type ContactValues = {
  first_name: string;
  last_name?: string;
  email?: string;
  phone?: string;
  company?: string;
  notes?: string;
};
