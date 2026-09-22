import { api, download } from '@/lib/api/client';
import type { TeamSnippet } from '@/lib/types';
import type { CustomerCategory, InviteBody, MemberBody, SettingsBody } from './types';

/* Endpoints of backend/modules/organization/routes.py used by the settings screen. Everything saved here lives in
   the workspace (GET /api/workspace), so callers refresh WORKSPACE_PATH afterwards. */

export const WORKSPACE_PATH = '/api/workspace';

export const saveSettings = (body: SettingsBody) => api('/api/settings', body, 'PATCH');

export const saveCustomerCategories = (categories: CustomerCategory[]) => api('/api/settings/categories', { categories });

/** คำตอบสำเร็จรูปของทีม: the whole list at once, in the order given (owners only). */
export const saveTeamSnippets = (snippets: TeamSnippet[]) => api('/api/settings/snippets', { snippets });

export type TeamBody = { name: string; description: string };

export const createTeam = (body: TeamBody) => api<{ id: string }>('/api/teams', body);

/** Change a team's name or what it is for. It keeps its id, so its cases, members and categories stay with it. */
export const saveTeam = (id: string, body: TeamBody) => api<TeamBody>(`/api/teams/${id}`, body, 'PATCH');

/** A new account when `id` is empty, otherwise a change to that member. */
export const saveMember = (id: string | null, body: MemberBody) =>
  api<{ id: string }>(`/api/members${id ? `/${id}` : ''}`, body, id ? 'PATCH' : 'POST');

export const downloadBackup = (slug: string) => download('/api/backup', `bookdose-${slug}-backup.zip`);

/** Support access (backend support_access): the requests of platform admins to enter this organization. */
export const SUPPORT_PATH = '/api/support-access';
export const approveSupport = (id: string, body: { hours: number; note: string }) => api(`${SUPPORT_PATH}/${id}/approve`, body);
export const denySupport = (id: string) => api(`${SUPPORT_PATH}/${id}/deny`, {});
export const endSupport = (id: string) => api(`${SUPPORT_PATH}/${id}/end`, {});

/** Staff invitations (backend invitations): the admin names an address, the colleague chooses their own password. */
export const INVITATIONS_PATH = '/api/invitations';
export const inviteMember = (body: InviteBody) => api(INVITATIONS_PATH, body);
export const resendInvitation = (id: string) => api(`${INVITATIONS_PATH}/${id}/resend`, {});
export const cancelInvitation = (id: string) => api(`${INVITATIONS_PATH}/${id}`, undefined, 'DELETE');

/** Correct the organization's own code (owners only). The old one keeps working, so links already sent do not break. */
export const changeOrgSlug = (slug: string) =>
  api<{ slug: string; former_slugs: string[] }>('/api/settings/slug', { slug }, 'PATCH');
