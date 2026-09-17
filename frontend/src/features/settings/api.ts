import { api, download } from '@/lib/api/client';
import type { CustomerCategory, MemberBody, SettingsBody } from './types';

/* Endpoints of backend/modules/organization/routes.py used by the settings screen. Everything saved here lives in
   the workspace (GET /api/workspace), so callers refresh WORKSPACE_PATH afterwards. */

export const WORKSPACE_PATH = '/api/workspace';

export const saveSettings = (body: SettingsBody) => api('/api/settings', body, 'PATCH');

export const saveCustomerCategories = (categories: CustomerCategory[]) => api('/api/settings/categories', { categories });

export const createTeam = (name: string) => api<{ id: string }>('/api/teams', { name });

/** A new account when `id` is empty, otherwise a change to that member. */
export const saveMember = (id: string | null, body: MemberBody) =>
  api<{ id: string }>(`/api/members${id ? `/${id}` : ''}`, body, id ? 'PATCH' : 'POST');

export const downloadBackup = (slug: string) => download('/api/backup', `bookdose-${slug}-backup.zip`);

/** Support access (backend support_access): the requests of platform admins to enter this organization. */
export const SUPPORT_PATH = '/api/support-access';
export const approveSupport = (id: string, body: { hours: number; note: string }) => api(`${SUPPORT_PATH}/${id}/approve`, body);
export const denySupport = (id: string) => api(`${SUPPORT_PATH}/${id}/deny`, {});
export const endSupport = (id: string) => api(`${SUPPORT_PATH}/${id}/end`, {});
