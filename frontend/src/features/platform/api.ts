import { api } from '@/lib/api/client';
import type { Announcement, AnnouncementInput, BackupSettings, BackupsView, GlobalArticleInput, TurnstileSettings } from './types';

/* Endpoints of backend/modules/platform/routes.py. Every platform read lives
   under /api/platform, so refreshing PLATFORM_PREFIX after a write also redraws the histories shown on the
   overview and the organizations page. */

export const PLATFORM_PREFIX = '/api/platform';
export const SYSTEM_PATH = '/api/platform/system';
export const TENANTS_PATH = '/api/platform/tenants';
export const REGISTRATION_PATH = '/api/platform/registration';
export const ADMINS_PATH = '/api/platform/admins';
export const GLOBAL_FAQ_PATH = '/api/platform/faq';
export const TURNSTILE_PATH = '/api/platform/turnstile';

/** The bot check on the public support form (Cloudflare Turnstile). `secret`: '' keeps the saved key. */
export const saveTurnstileSettings = (body: { enabled: boolean; site_key: string; secret: string }) =>
  api<TurnstileSettings>(TURNSTILE_PATH, body);

export type NewTenantBody = { name: string; slug: string; admin_name: string; email: string; password: string };

export const createTenant = (body: NewTenantBody) => api<{ id: string }>(TENANTS_PATH, body);

/** Suspend (with the typed confirmation: CONFIRM or the organization's name) or reopen an organization. */
export const setTenantStatus = (tenantId: string, status: 'active' | 'suspended', confirmation = '') =>
  api<{ ok: true }>(`${TENANTS_PATH}/${tenantId}`, status === 'suspended' ? { status, confirmation } : { status }, 'PATCH');

/** Ask an organization to let this admin in for support; its admins approve (or not). */
export const requestSupportAccess = (tenantId: string, reason: string, hours: number) =>
  api<{ id: string; status: 'pending' }>(`${TENANTS_PATH}/${tenantId}/support-access`, { reason, hours });

/** Give an organization an admin: an emailed invitation, or (with a first password) the account made at once. */
export const addTenantAdmin = (tenantId: string, body: { email: string; admin_name?: string; password?: string }) =>
  api<{ mode: 'invited'; sent: boolean } | { mode: 'created' }>(`${TENANTS_PATH}/${tenantId}/admins`, body);

/** Withdraw a waiting request, or leave an access in force early. */
export const withdrawSupportAccess = (id: string) => api<{ ok: true }>(`${PLATFORM_PREFIX}/support-access/${id}`, undefined, 'DELETE');

/* ภาพรวมระบบ beyond the server's numbers (backend platform/health.py, backups.py). */
export const HEALTH_PATH = '/api/platform/health';
export const BACKUPS_PATH = '/api/platform/backups';
export const ANNOUNCEMENT_PATH = '/api/platform/announcement';
/** The console's bell (health.notifications). */
export const NOTIFICATIONS_PATH = '/api/platform/notifications';

/** "I keep the key file somewhere else": the reminder stops until the key changes. */
export const markKeySaved = () => api<{ ok: true }>(`${PLATFORM_PREFIX}/checklist/key-saved`, {});
export const retryChannels = (tenantId: string) =>
  api<{ retried: number; skipped: number; reasons: string[] }>(`${TENANTS_PATH}/${tenantId}/channels/retry`, {});
export const runBackup = () => api<BackupsView>(BACKUPS_PATH, {});
export const saveBackupSettings = (body: BackupSettings) => api<BackupsView>(`${BACKUPS_PATH}/settings`, body);
/** A plain link: the browser downloads the archive with the session cookie (GET needs no CSRF token). */
export const backupFileUrl = (name: string) => `${BACKUPS_PATH}/${encodeURIComponent(name)}`;
export const saveAnnouncement = (body: AnnouncementInput) => api<{ announcement: Announcement }>(ANNOUNCEMENT_PATH, body);
export const clearAnnouncement = () => api<{ announcement: null }>(ANNOUNCEMENT_PATH, undefined, 'DELETE');

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

/* รายงานปัญหา: what members of the organizations send from the ? in their top bar (backend platform/routes.py). */
export const REPORTS_PATH = '/api/platform/reports';

/** Mark a report as dealt with, or put it back on the list. */
export const setReportStatus = (id: string, status: 'open' | 'done') =>
  api<{ ok: true }>(`${REPORTS_PATH}/${id}`, { status }, 'PATCH');

/** โควตาพื้นที่ต่อองค์กร: how much of the shared disk one organization may take. 0 removes the ceiling. */
export const setTenantQuota = (tenantId: string, quotaMb: number) =>
  api<{ quota_mb: number }>(`${TENANTS_PATH}/${tenantId}/quota`, { quota_mb: quotaMb }, 'PATCH');
