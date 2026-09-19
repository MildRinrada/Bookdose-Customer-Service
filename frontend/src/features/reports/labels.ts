import type { TicketRow } from '@/features/tickets/types';
import { isDone, overdue } from '@/lib/format';
import type { ReportFilter, ReportMetrics } from './types';

/* The report's rules: the period choices, the cases in a period (and the period before), their figures and how
   a figure compares with the period before. */

export const reportRanges: Record<string, string> = { 7: '7 วันล่าสุด', 30: '30 วันล่าสุด', 90: '90 วันล่าสุด', 365: '1 ปีล่าสุด' };

export const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function reportRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - (days - 1));
  return { from: localDate(from), to: localDate(to) };
}

/** GET /api/reports/extras for the same dates and team, in the viewer's time zone. */
export const reportExtrasPath = (f: ReportFilter) =>
  `/api/reports/extras?from=${f.from}&to=${f.to}&tz=${new Date().getTimezoneOffset()}${f.team ? `&team=${encodeURIComponent(f.team)}` : ''}`;

export const defaultReportFilter = (): ReportFilter => ({ ...reportRange(30), team: '', assignee: '', days: 30 });

/** Cases created in the period (or, with `previous`, in the same-length period just before it), by team and owner. */
export function reportTickets(tickets: TicketRow[], f: ReportFilter, previous = false): TicketRow[] {
  let from = f.from ? new Date(f.from + 'T00:00:00') : null;
  let to = f.to ? new Date(f.to + 'T23:59:59.999') : null;
  if (previous && from && to) {
    const width = to.getTime() - from.getTime() + 1;
    to = new Date(from.getTime() - 1);
    from = new Date(from.getTime() - width);
  }
  return tickets.filter(
    (t) =>
      (!from || new Date(t.created_at) >= from) &&
      (!to || new Date(t.created_at) <= to) &&
      (!f.team || t.team_id === f.team) &&
      (!f.assignee || t.assignee_id === f.assignee),
  );
}

export function reportMetrics(tickets: TicketRow[]): ReportMetrics {
  const replied = tickets.filter((t) => t.first_response_at);
  const minutes = (t: TicketRow) => (new Date(t.first_response_at as string).getTime() - new Date(t.created_at).getTime()) / 60000;
  return {
    total: tickets.length,
    open: tickets.filter((t) => !isDone(t)).length,
    late: tickets.filter(overdue).length,
    avg: replied.length ? replied.reduce((n, t) => n + minutes(t), 0) / replied.length : null,
    sla: replied.length
      ? (100 * replied.filter((t) => new Date(t.first_response_at as string) <= new Date(t.first_response_due_at)).length) / replied.length
      : null,
  };
}

// "12 เคสมากกว่าช่วงก่อนหน้า" reads better than a bare number, and says nothing when there is nothing to compare.
export function reportTrend(now: number | null, before: number | null, unit: string): string {
  if (now == null || before == null) return 'ไม่มีข้อมูลช่วงก่อนให้เทียบ';
  const change = now - before;
  const size = Math.abs(change);
  if (size < 0.05) return 'เท่ากับช่วงก่อน';
  const rounded = unit === '%' ? size.toFixed(1) : Math.round(size).toLocaleString('th-TH');
  return `${change > 0 ? '▲' : '▼'} ${rounded} ${unit} เทียบช่วงก่อน`;
}
