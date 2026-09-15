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
