/* The report is built in the browser from GET /api/tickets; these are its own shapes. */

/** The period and filters (kept per session). `days` is the chosen quick range, 0 when dates were typed. */
export type ReportFilter = { from: string; to: string; team: string; assignee: string; days: number };

export type ReportMetrics = { total: number; open: number; late: number; avg: number | null; sla: number | null };
