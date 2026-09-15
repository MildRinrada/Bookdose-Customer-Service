/* What other features use from customers: the add/edit form (also opened before a first case) and the list's
   helpers. */

export { ContactForm, ContactModal, useContactModal } from './components/ContactForm';
export { ContactHistory } from './components/ContactHistory';
export { contactTicketStats, duplicateEmails, emailKey } from './labels';
export { CONTACTS_PATH, deleteContact, fetchContacts, mergeContacts, saveContact } from './api';
export type * from './types';
