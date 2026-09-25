import { api } from '@/lib/api/client';

/* Endpoint of backend/modules/platform/routes.py. The report does not belong to the organization the member is
   working in - its own admins cannot fix the product - so it goes to the platform, and only the platform console
   reads it back. */

export const REPORT_PATH = '/api/problem-reports';

/** Tell the platform something is wrong. `page` is the address the reporter was on, so it can be reproduced. */
export const reportProblem = (message: string, page: string) => api<{ id: string }>(REPORT_PATH, { message, page });

/** The same from a signed-in customer (their own session; backend customers/routes.py). */
export const reportProblemAsCustomer = (message: string, page: string) =>
  api<{ id: string }>('/api/customer/problem-report', { message, page });
