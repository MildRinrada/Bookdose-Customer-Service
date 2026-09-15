import { api } from '@/lib/api/client';
import type { GlobalArticleInput, VerifyResult } from './types';

/* Endpoints of backend/modules/platform/routes.py (and the platform routes of contracts). Every platform read lives
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

export const requestSupportAccess = (tenantId: string, reason: string) =>
  api<{ ok: true }>(`${TENANTS_PATH}/${tenantId}/support-access`, { reason });

export const addPlatformAdmin = (body: { email: string; admin_name?: string; password?: string }) => api<{ id: string }>(ADMINS_PATH, body);

export const removePlatformAdmin = (userId: string) => api<{ ok: true }>(`${ADMINS_PATH}/${userId}`, undefined, 'DELETE');

export const saveGlobalArticle = (id: string | undefined, body: GlobalArticleInput) =>
  api<{ id?: string; ok?: true }>(id ? `${GLOBAL_FAQ_PATH}/${id}` : GLOBAL_FAQ_PATH, body, id ? 'PATCH' : 'POST');

export const deleteGlobalArticle = (id: string) => api<{ ok: true }>(`${GLOBAL_FAQ_PATH}/${id}`, undefined, 'DELETE');

export const deletePlatformTemplate = (id: string) => api<{ ok: true }>(`/api/platform/contract-templates/${id}`, undefined, 'DELETE');

export const verifyContractHash = (hash: string) => api<VerifyResult>('/api/platform/contracts/verify', { hash });
