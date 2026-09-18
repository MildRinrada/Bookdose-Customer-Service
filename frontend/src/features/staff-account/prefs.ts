import { api } from '@/lib/api/client';
import { useApi } from '@/lib/query';
import type { Availability, WorkStatus } from '@/lib/types';

/* A staff member's working preferences (backend staff_prefs): work status, hours and leave, notifications, what the
   customer sees of them and their quick replies. One account, the same in every organization. Field names are the
   server's. */

export const PREFS_PATH = '/api/account/preferences';

export type NotifyEvent = 'assigned' | 'customer_reply' | 'sla';

export type Snippet = { id?: string; shortcut: string; text: string };

export type StaffPreferences = {
  status: WorkStatus;
  hours: { enabled: boolean; days: number[]; start: string; end: string };
  leave: { from: string; to: string; note: string }[];
  /** celebrate: confetti and a card when the member closes a case or gets five stars (Celebrations). */
  notify: { desktop: boolean; sound: boolean; email: boolean; celebrate: boolean; events: Record<NotifyEvent, boolean> };
  signature: { enabled: boolean; text: string };
  alias: string;
  snippets: Snippet[];
};

/** GET /api/account/preferences */
export type PreferencesView = {
  preferences: StaffPreferences;
  availability: Availability;
  statuses: Record<WorkStatus, string>;
  events: Record<NotifyEvent, string>;
  days: string[];
  /** The platform can send email (else the email switch cannot work yet). */
  mail_ready: boolean;
};

export const usePreferences = (enabled = true) => useApi<PreferencesView>(PREFS_PATH, { enabled });

/** Save some sections; the others keep their saved value. */
export const savePreferences = (body: Partial<StaffPreferences>) => api<PreferencesView>(PREFS_PATH, body);
export const setWorkStatus = (status: WorkStatus) => api<PreferencesView>('/api/account/status', { status });
export const sendTestEmail = () => api<{ ok: true; email: string }>(`${PREFS_PATH}/test-email`, {});

export const statusTones: Record<WorkStatus, string> = { online: 'online', break: 'break', busy: 'busy', offline: 'offline' };
