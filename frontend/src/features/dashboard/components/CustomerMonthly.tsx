'use client';

import { ChartColumn } from '@/components/ui/display';
import { baht } from '@/lib/format';
import { monthText } from '../labels';
import type { CustomerDashboard } from '../types';

/* What the customer paid each month over the last 12 (every organization; invoices are paid per organization, but
   the budget is the customer's). Bars reuse the overview's ChartColumn. Markup: pages/dashboard-customer.css. */

export function MonthlyPaid({ months }: { months: CustomerDashboard['budget']['monthly'] }) {
  const max = Math.max(1, ...months.map((m) => Number(m.paid)));
  return (
    <div className="chart cdash-chart" role="group" aria-label="ยอดที่ชำระแต่ละเดือน">
      {months.map((m) => (
        <ChartColumn key={m.month} tip={`${monthText(m.month)} · ${baht(m.paid)}`} count={Number(m.paid)} max={max} day={monthText(m.month)} />
      ))}
    </div>
  );
}
