import type { DashboardLayout } from '@/features/dashboard/layout';
import { api } from '@/lib/api/client';
import { useApi } from '@/lib/query';
import type { Availability, WorkStatus } from '@/lib/types';

/* A staff member's working preferences (backend staff_prefs): work status, hours and leave, notifications, what the
   customer sees of them and their quick replies. One account, the same in every organization. Field names are the
   server's. */

export const PREFS_PATH = '/api/account/preferences';

/** weekly_report: the service report's summary every Monday (the organization's owners; backend reports/weekly.py).
    help: a colleague raised their hand on a case the member can see (on screen and by sound only). */
export type NotifyEvent = 'assigned' | 'customer_reply' | 'sla' | 'snoozed' | 'help' | 'weekly_report';

export type Snippet = { id?: string; shortcut: string; text: string };

export type StaffPreferences = {
  status: WorkStatus;
  hours: { enabled: boolean; days: number[]; start: string; end: string };
  leave: { from: string; to: string; note: string }[];
  /** celebrate: confetti and a card when the member closes a case, gets five stars or praise, or earns a badge
      (Celebrations). recap: last month's summary pops up the first time they open the app in a month (RecapPopup). */
  notify: { desktop: boolean; sound: boolean; email: boolean; celebrate: boolean; recap: boolean; events: Record<NotifyEvent, boolean> };
  signature: { enabled: boolean; text: string };
  alias: string;
  /** การ์ดขอบคุณหลังปิดเคส, in organizations that give one: customers see this member's photo on it (else their
      initials), and their own thank-you ('' for the organization's). */
  thanks: { photo: boolean; message: string };
  /** Customers see this member's photo beside their replies on the web chat (backend portal/photos.py); on by default. */
  chat_photo: boolean;
  snippets: Snippet[];
  /** How this member arranged their overview (features/dashboard/layout.ts); empty = as the organization arranged it. */
  dashboard: DashboardLayout;
  /** The personality of this member's AI assistant ('' until chosen; features/ai/components/PersonaPicker). */
  assistant: AssistantPersona;
};

export type AssistantPersona = { persona: '' | 'formal' | 'friendly' | 'custom'; custom: string };

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
