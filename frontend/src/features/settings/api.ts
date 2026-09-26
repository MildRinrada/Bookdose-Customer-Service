import { api, download } from '@/lib/api/client';
import type { SupportBanner } from '@/features/guest/components/OrgBanner';
import type { TeamSnippet } from '@/lib/types';
import type { CustomerCategory, InviteBody, MemberBody, SettingsBody } from './types';

/* Endpoints of backend/modules/organization/routes.py used by the settings screen. Everything saved here lives in
   the workspace (GET /api/workspace), so callers refresh WORKSPACE_PATH afterwards. */

export const WORKSPACE_PATH = '/api/workspace';

export const saveSettings = (body: SettingsBody) => api('/api/settings', body, 'PATCH');

export const saveCustomerCategories = (categories: CustomerCategory[]) => api('/api/settings/categories', { categories });

/** คำตอบสำเร็จรูปของทีม: the whole list at once, in the order given (owners only). */
export const saveTeamSnippets = (snippets: TeamSnippet[]) => api('/api/settings/snippets', { snippets });

/** เวลาทำการ (backend organization/hours.py): Monday first, null for a closed day. */
export type Holiday = { date: string; name: string };
export type BusinessHours = { enabled: boolean; sla: boolean; days: Array<[string, string] | null>; holidays: Holiday[]; message: string };
export const RETENTION_PATH = '/api/settings/retention';
type RetentionCount = { conversations: number; files: number; bytes: number };
export type Retention = {
  enabled: boolean;
  months: number;
  enabled_at: string | null;
  months_choices: number[];
  wait_days: number;
  starts_at: string | null;
  preview: Record<string, RetentionCount>;
  cleared: { conversations: number; files: number; last_at: string | null };
};
export const saveRetention = (value: { enabled: boolean; months: number }) => api<Retention>(RETENTION_PATH, value);
export const TEAM_SECURITY_PATH ='/api/settings/security';
export type TeamSecurity = {
  require_two_factor: boolean;
  members: Array<{ id: string; name: string; email: string; role: string; protected: boolean }>;
};
export const saveTeamSecurity = (on: boolean) => api<TeamSecurity>(TEAM_SECURITY_PATH, { require_two_factor: on });
export type QuietClose ={ enabled: boolean; remind_days: number; close_days: number; remind_message: string; close_message: string };
export const saveQuietClose = (value: QuietClose) => api<{ quiet_close: QuietClose }>('/api/settings/quiet-close', value);
export const saveSupportBanner = (value: SupportBanner) => api<{ support_banner: SupportBanner }>('/api/settings/banner', value);
export const saveBusinessHours =(hours: BusinessHours) => api<{ business_hours: BusinessHours }>('/api/settings/hours', hours);

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

/** What the organization calls itself and the picture it shows its customers (owners only). */
export const saveOrgProfile = (body: { name: string; logo: string }) =>
  api<{ name: string; logo: string }>('/api/settings/profile', body, 'PATCH');

/** Correct the organization's own code (owners only). The old one keeps working, so links already sent do not break. */
export const changeOrgSlug = (slug: string) =>
  api<{ slug: string; former_slugs: string[] }>('/api/settings/slug', { slug }, 'PATCH');
