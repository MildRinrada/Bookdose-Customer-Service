'use client';

import Link from 'next/link';
import { baht } from '@/lib/format';
import { useApi } from '@/lib/query';
import { CUSTOMER_DASHBOARD_PATH } from '../api';
import type { CustomerDashboard } from '../types';
import { budgetTotals } from './CustomerBudget';

/* One line of the budget above the customer's invoices (BillingScreen): the contracts' value, what was paid and
   what is left, for the organization picked in the filter. Nothing while loading, or without billing on any project. */

export function BudgetLine({ org }: { org: string }) {
  const { data } = useApi<CustomerDashboard>(CUSTOMER_DASHBOARD_PATH);
  const projects = (data?.budget.projects ?? []).filter((p) => !org || p.org_slug === org);
  if (!projects.length) return null;
  const totals = budgetTotals(projects);
  return (
    <p className="cdash-line">
      <span>
        มูลค่าสัญญา <strong>{baht(totals.contract_total)}</strong>
      </span>
      <span>
        จ่ายแล้ว <strong>{baht(totals.paid)}</strong>
      </span>
      <span>
        คงเหลือ <strong>{baht(totals.remaining)}</strong>
      </span>
      {Number(totals.overdue) > 0 && <span className="cdash-late">เกินกำหนด {baht(totals.overdue)}</span>}
      <Link href="/customer/dashboard">ดูภาพรวมงบประมาณ</Link>
    </p>
  );
}
