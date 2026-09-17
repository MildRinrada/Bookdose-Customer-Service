import { api } from '@/lib/api/client';
import type { GlobalArticleInput } from './types';

/* Endpoints of backend/modules/platform/routes.py. Every platform read lives
   under /api/platform, so refreshing PLATFORM_PREFIX after a write also redraws the histories shown on the
   overview and the organizations page. */

export const PLATFORM_PREFIX = '/api/platform';
export const SYSTEM_PATH = '/api/platform/system';
export const TENANTS_PATH = '/api/platform/tenants';
export const REGISTRATION_PATH = '/api/platform/registration';
export const ADMINS_PATH = '/api/platform/admins';
export const GLOBAL_FAQ_PATH = '/api/platform/faq';

export type NewTenantBody = { name: string; slug: string; admin_name: string; email: string; password: string };

export const createTenant = (body: NewTenantBody) => api<{ id: string }>(TENANTS_PATH, body);

/** Suspend (with the typed confirmation: CONFIRM or the organization's name) or reopen an organization. */
export const setTenantStatus = (tenantId: string, status: 'active' | 'suspended', confirmation = '') =>
  api<{ ok: true }>(`${TENANTS_PATH}/${tenantId}`, status === 'suspended' ? { status, confirmation } : { status }, 'PATCH');

/** Ask an organization to let this admin in for support; its admins approve (or not). */
export const requestSupportAccess = (tenantId: string, reason: string, hours: number) =>
  api<{ id: string; status: 'pending' }>(`${TENANTS_PATH}/${tenantId}/support-access`, { reason, hours });

/** Withdraw a waiting request, or leave an access in force early. */
export const withdrawSupportAccess = (id: string) => api<{ ok: true }>(`${PLATFORM_PREFIX}/support-access/${id}`, undefined, 'DELETE');

export const addPlatformAdmin = (body: { email: string; admin_name?: string; password?: string }) => api<{ id: string }>(ADMINS_PATH, body);

export const removePlatformAdmin = (userId: string) => api<{ ok: true }>(`${ADMINS_PATH}/${userId}`, undefined, 'DELETE');

export const saveGlobalArticle = (id: string | undefined, body: GlobalArticleInput) =>
  api<{ id?: string; ok?: true }>(id ? `${GLOBAL_FAQ_PATH}/${id}` : GLOBAL_FAQ_PATH, body, id ? 'PATCH' : 'POST');

export const deleteGlobalArticle = (id: string) => api<{ ok: true }>(`${GLOBAL_FAQ_PATH}/${id}`, undefined, 'DELETE');

/** Readers see the latest words from now on (a draft, or the waiting changes). */
export const publishGlobalArticle = (id: string) => api<{ ok: true }>(`${GLOBAL_FAQ_PATH}/${id}/publish`, {});

/** Readers no longer see it; it is a draft again. */
export const unpublishGlobalArticle = (id: string) => api<{ ok: true }>(`${GLOBAL_FAQ_PATH}/${id}/unpublish`, {});

/** Throw away the waiting changes; the published words stay. */
export const discardGlobalChanges = (id: string) => api<{ ok: true }>(`${GLOBAL_FAQ_PATH}/${id}/changes`, undefined, 'DELETE');
