import { api } from '@/lib/api/client';
import type { Upload } from '@/lib/files';
import type { CustomerOrg } from '@/lib/types';

/* Endpoints of backend/modules/customers (/api/customer/...) and portal (/api/public/<org>/...) used by the signed-in
   customer. Contracts and invoices use customerContractApi() from the contracts feature. */

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

export const openChat = (slug: string, body: { subject: string; body: string; category: string; attachments: Upload[] }) =>
  api<{ id: string }>(`/api/public/${slug}/conversations`, body);

/** Answer the satisfaction survey of the open chat (X-Conversation-ID). */
export const rateService = (slug: string, body: { rating: number; comment: string }) => api<{ ok: true }>(`/api/public/${slug}/csat`, body);

export const joinOrganization = (slug: string) => api<{ organization: CustomerOrg }>(ORGS_PATH, { slug });

export const saveProfile = (body: { name: string; phone: string }) => api<{ ok: true }>('/api/customer/profile', body);

export const changePassword = (body: { current_password: string; password: string }) => api<{ ok: true }>('/api/customer/password', body);

export const saveNotifications = (email: boolean) => api<{ ok: true }>('/api/customer/notifications', { email });
