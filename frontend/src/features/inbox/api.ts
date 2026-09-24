import { api } from '@/lib/api/client';
import type { Upload } from '@/lib/files';

/* The staff inbox endpoints (backend/modules/conversations/routes.py). */

/** What a change to a conversation touches: the inbox (list and conversation) and the case screens that show it. */
export const CONVERSATION_PREFIXES = ['/api/conversations', '/api/tickets'];

export const conversationPath = (id: string) => `/api/conversations/${id}`;

/** translate: false sends a Thai reply as typed where it would be translated for the customer (ai/translate.py). */
export function postMessage(conversationId: string, body: { kind: 'reply' | 'note'; body: string; attachments?: Upload[]; translate?: boolean }) {
  return api<{ id: string }>(`/api/conversations/${conversationId}/messages`, body);
}

export function setConversationStatus(conversationId: string, status: 'open' | 'closed') {
  return api<{ ok: true }>(`/api/conversations/${conversationId}`, { status }, 'PATCH');
}

/** Open a new case for the conversation (the server takes its subject and category). */
export function openTicketFromConversation(conversationId: string) {
  return api<{ id: string }>(`/api/conversations/${conversationId}/ticket`, {});
}

/** The customer's message from the organization's portal (customer side). */
export function postPortalMessage(slug: string, conversationId: string, body: { body: string; attachments?: Upload[] }) {
  return api<{ id: string }>(`/api/public/${slug}/messages`, body, 'POST', { conversation: conversationId });
}

/** Opening the conversation where the member was @mentioned counts as reading the mention. */
export function markMentionsRead(conversationId: string) {
  return api<{ ok: true }>('/api/mentions/read', { conversation_id: conversationId });
}

/* Correcting or taking back a message of a web chat (backend conversations/service.py). A reply already delivered by
   LINE, email or Facebook is refused by the server: the customer has the original and our copy must keep matching. */
export const editMessage = (conversationId: string, messageId: string, body: string) =>
  api<{ id: string }>(`/api/conversations/${conversationId}/messages/${messageId}`, { body }, 'PATCH');

export const deleteMessage = (conversationId: string, messageId: string) =>
  api<{ id: string }>(`/api/conversations/${conversationId}/messages/${messageId}`, undefined, 'DELETE');
