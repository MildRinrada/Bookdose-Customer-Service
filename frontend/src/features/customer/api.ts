import type { Reaction } from '@/features/inbox/types';
import { api } from '@/lib/api/client';
import type { Upload } from '@/lib/files';
import type { CustomerOrg } from '@/lib/types';
import type { LineCode, LineMoveCode, NotificationSettings } from './types';

/* Endpoints of backend/modules/customers (/api/customer/...) and portal (/api/public/<org>/...) used by the signed-in
   customer. */

export const ACCOUNT_PATH = '/api/customer/account';
export const ORGS_PATH = '/api/customer/organizations';
export const OVERVIEW_PATH = '/api/customer/overview';
export const FAQ_PATH = '/api/customer/faq';

/** Cache key of one chat. The server reads the chat from X-Conversation-ID and ignores the query string; the query
    only keeps each chat in its own cache entry (the path alone is the same for every chat of an organization). */
export const sessionKey = (slug: string, id: string) => `/api/public/${slug}/session?conversation=${id}`;
export const sessionPath = (slug: string) => `/api/public/${slug}/session`;

export const casePath = (slug: string, id: string) => `/api/public/${slug}/cases/${id}`;

/** The public page of an organization (name, articles, whether sign-up email works). */
export const publicInfoPath = (slug: string) => `/api/public/${slug}`;

export const openChat = (slug: string, body: { subject: string; body: string; category: string; attachments: Upload[]; follows?: string }) =>
  api<{ id: string }>(`/api/public/${slug}/conversations`, body);

/* What signing in gives (backend customers/perks.py, incidents/follow.py): send a finished case back, keep a chat or
   a case as a file (plain links: the browser downloads with the session cookie), hear when a known issue is fixed. */
export const reopenCase = (slug: string, id: string, message: string) =>
  api<{ conversation_id: string | null }>(`/api/public/${slug}/cases/${id}/reopen`, { message });
export const chatExportUrl = (slug: string, id: string) => `/api/public/${slug}/conversations/${id}/export`;
export const caseExportUrl = (slug: string, id: string) => `/api/public/${slug}/cases/${id}/export`;
export const followingPath = (slug: string) => `/api/public/${slug}/issues/following`;
export const followIssue = (slug: string, id: string, follow: boolean) =>
  api<{ following: string[] }>(`/api/public/${slug}/issues/${id}/follow`, { follow });

/** Answer the satisfaction survey of a chat (X-Conversation-ID). */
export const rateService = (slug: string, conversationId: string, body: { rating: number; comment: string }) =>
  api<{ ok: true }>(`/api/public/${slug}/csat`, body, 'POST', { conversation: conversationId });

/** An emoji on a team reply of the chat (null takes it back): tells the team without a message, so a finished case
    stays finished. `slug` is "<org>/guest" for a guest chat. */
export const reactToMessage = (slug: string, conversationId: string, messageId: string, reaction: Reaction | null) =>
  api<{ reaction: Reaction | null }>(`/api/public/${slug}/messages/${messageId}/reaction`, { reaction }, 'POST', { conversation: conversationId });

/** A heart back to the team member on the thank-you card: it goes up on the team's กำแพงคำชม. */
export const sendThanksHeart = (slug: string, conversationId: string, cardId: string) =>
  api<{ hearted: true }>(`/api/public/${slug}/thanks/${cardId}/heart`, {}, 'POST', { conversation: conversationId });

/** A code that carries the chat (X-Conversation-ID) to the organization's LINE. */
export const continueOnLine = (slug: string, conversationId: string) =>
  api<LineMoveCode>(`/api/public/${slug}/line/continue`, {}, 'POST', { conversation: conversationId });

export const joinOrganization = (slug: string) => api<{ organization: CustomerOrg }>(ORGS_PATH, { slug });

export const saveProfile = (body: { name: string; phone: string; avatar?: string }) => api<{ ok: true }>('/api/customer/profile', body);

export const changePassword = (body: { current_password: string; password: string }) => api<{ ok: true }>('/api/customer/password', body);

export const saveNotifications = (email: boolean) => api<{ ok: true }>('/api/customer/notifications', { email });

/** Which events go to email / LINE; the answer is the settings as saved. */
export const NOTIFY_SETTINGS_PATH = '/api/customer/notification-settings';
export const saveNotifySettings = (events: Record<string, { email?: boolean; line?: boolean }>) =>
  api<NotificationSettings>(NOTIFY_SETTINGS_PATH, { events });

/** Linking the account with one organization's LINE (a 6-digit code sent there in a 1:1 chat). */
export const linePath = (slug: string) => `/api/public/${slug}/line`;
export const requestLineCode = (slug: string) => api<LineCode>(linePath(slug), {});
export const unlinkLine = (slug: string) => api<{ ok: true }>(linePath(slug), undefined, 'DELETE');
