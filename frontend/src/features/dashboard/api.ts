/* The overview's own data: the member's alerts and, for admins and team leads, the manager view. The browser's
   time zone goes along so "today" and the busy hours are the viewer's own. */

export const OVERVIEW_PREFIX = '/api/automation/overview';

export const overviewPath = () => `${OVERVIEW_PREFIX}?tz=${new Date().getTimezoneOffset()}`;

/** The customer's project overview (customers/dashboard.py build): budget, project health and service levels. */
export const CUSTOMER_DASHBOARD_PATH = '/api/customer/dashboard';
