import { api } from '@/lib/api/client';
import type { NextTask } from './types';

/* The overview's own data: the member's alerts and own day and, for the organization's owners, the manager view,
   the setup checklist and the chatbot/knowledge cards. The browser's time zone goes along so "today" and the busy
   hours are the viewer's own. */

export const OVERVIEW_PREFIX = '/api/automation/overview';

export const overviewPath = () => `${OVERVIEW_PREFIX}?tz=${new Date().getTimezoneOffset()}`;

/** เริ่มต้นใช้งาน closed for good in this organization (hidden: true), or brought back (automation/setup.py). */
export const hideSetup = (hidden: boolean) => api<{ hidden: boolean }>('/api/automation/setup', { hidden });

/** The customer's overview (customers/dashboard.py build): service levels per organization. */
export const CUSTOMER_DASHBOARD_PATH = '/api/customer/dashboard';

/** รับงานถัดไป: the case to open now; a case nobody had becomes the member's. */
export const takeNextTask = () => api<NextTask>('/api/tickets/next', {});

/** The owner's AI: an article from one group of unanswered questions, and today's summary (ai/insights.py). */
export const requestArticleDraft = (conversationIds: string[]) =>
  api<{ id: string; status: string }>('/api/ai/insights/article', { conversation_ids: conversationIds });
export const requestBrief = () => api<{ id: string; status: string }>(`/api/ai/insights/brief?tz=${new Date().getTimezoneOffset()}`, {});
