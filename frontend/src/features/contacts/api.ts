import { api } from '@/lib/api/client';
import type { ContactsPage, ContactValues } from './types';

/* The customer endpoints (backend/modules/contacts/routes.py). Read the list with useApi(CONTACTS_PATH). */

export const CONTACTS_PATH = '/api/contacts';

export const fetchContacts = () => api<ContactsPage>(CONTACTS_PATH);

/** New customer (id empty) or changes to one (admins and team leads). */
export function saveContact(id: string | null | undefined, values: ContactValues) {
  return id ? api<{ ok: true }>(`${CONTACTS_PATH}/${id}`, values, 'PATCH') : api<{ id: string }>(CONTACTS_PATH, values);
}

/** Move the other contacts' cases and conversations to `targetId`, then delete them. */
export function mergeContacts(targetId: string, contactIds: string[]) {
  return api<{ ok: true }>(`${CONTACTS_PATH}/${targetId}/merge`, { contact_ids: contactIds });
}

/** Moves the contact to the recycle bin; refused while cases or conversations still point at it. */
export function deleteContact(id: string) {
  return api<{ deleted: string }>(`${CONTACTS_PATH}/${id}`, undefined, 'DELETE');
}
