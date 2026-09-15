'use client';

import Link from 'next/link';
import { CustomerNone, StatCard } from '@/components/ui/display';
import { invoiceStatusLabels, invoiceStatusTones } from '@/features/contracts';
import { baht, date } from '@/lib/format';
import { dueText, share } from '../labels';
import type { BudgetProject, CustomerDashboard, UpcomingPayment } from '../types';

/* The money part of the customer's project overview: the five totals, each project's budget against what was paid,
   and the payments still due (links open the invoice, where the customer pays and attaches the slip).
   Markup: pages/dashboard-customer.css. */

export type BudgetTotals = Pick<CustomerDashboard['budget'], 'contract_total' | 'billed' | 'paid' | 'outstanding' | 'overdue' | 'remaining'>;

// Sums in satang so the figures of many projects add up exactly.
const satang = (value: string) => Math.round(Number(value || 0) * 100);
const text = (value: number) => (value / 100).toFixed(2);

/** The totals of these projects (the server's totals are of every organization; a filter narrows them). */
export function budgetTotals(projects: BudgetProject[]): BudgetTotals {
  const sum = (key: 'total' | 'billed' | 'paid' | 'outstanding' | 'overdue') => projects.reduce((n, p) => n + satang(p[key]), 0);
  return {
    contract_total: text(sum('total')),
    billed: text(sum('billed')),
    paid: text(sum('paid')),
    outstanding: text(sum('outstanding')),
    overdue: text(sum('overdue')),
    remaining: text(sum('total') - sum('paid')),
  };
}

export const invoiceHref = (org: string, invoiceId: string) => `/customer/billing/${org}/${invoiceId}`;

export function BudgetCards({ totals }: { totals: BudgetTotals }) {
  const overdue = Number(totals.overdue) > 0;
  return (
    <div className="stats-grid cdash-stats">
      <StatCard label="มูลค่าสัญญา" value={baht(totals.contract_total)} icon="file" foot={`ออกใบแจ้งหนี้แล้ว ${baht(totals.billed)}`} href="/customer/billing" />
      <StatCard
        label="จ่ายแล้ว"
        value={baht(totals.paid)}
        icon="checkCircle"
        color="green"
        foot={`${share(totals.paid, totals.contract_total)}% ของมูลค่าสัญญา`}
        href="/customer/billing?show=paid"
      />
      <StatCard label="ค้างชำระ" value={baht(totals.outstanding)} icon="receipt" color="amber" foot="ใบแจ้งหนี้ที่รอชำระ" href="/customer/billing?show=unpaid" />
      <StatCard
        label="เกินกำหนด"
        value={baht(totals.overdue)}
        icon="clock"
        color="red"
        foot={overdue ? 'ชำระโดยเร็ว' : 'ไม่มียอดเกินกำหนด'}
        href="/customer/billing?show=unpaid"
        urgent={overdue}
      />
      <StatCard label="คงเหลือ" value={baht(totals.remaining)} icon="chart" foot="มูลค่าสัญญาที่ยังไม่ได้จ่าย" href="/customer/billing" />
    </div>
  );
}

/** Each project's budget: what was paid of the contract's value, what is still owed and the next payment. */
export function BudgetTable({ projects, canOpen }: { projects: BudgetProject[]; canOpen: (p: BudgetProject) => boolean }) {
  if (!projects.length) return <CustomerNone title="ไม่มีงบประมาณโครงการในองค์กรนี้" hint="เลือก “ทุกองค์กร” เพื่อดูทั้งหมด" />;
  return (
    <div className="table-scroll">
      <table className="customer-case-table cdash-table">
        <thead>
          <tr>
            <th>โครงการ</th>
            <th>องค์กร</th>
            <th>มูลค่าสัญญา</th>
            <th>จ่ายแล้ว</th>
            <th>ค้างชำระ</th>
            <th>งวดถัดไป</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => {
            const paid = share(p.paid, p.total);
            return (
              <tr key={`${p.org_slug}:${p.contract_id}`}>
                <td>
                  {canOpen(p) ? (
                    <Link className="customer-case-title" href={`/customer/documents/${p.org_slug}/${p.contract_id}`} title={p.title}>
                      {p.title}
                    </Link>
                  ) : (
                    <span className="customer-case-title">{p.title}</span>
                  )}
                  <span className="customer-case-id">{p.reference}</span>
                </td>
                <td>
                  <span className="customer-org-badge" title={p.org_name}>
                    {p.org_name}
                  </span>
                </td>
                <td className="cdash-money">{baht(p.total)}</td>
                <td>
                  <span className="cdash-money">{baht(p.paid)}</span>
                  <span className="project-mini">
                    <progress className="project-meter sm" max={100} value={paid} aria-label={`จ่ายแล้ว ${paid}%`}>
                      {paid}%
                    </progress>
                    {paid}%
                  </span>
                </td>
                <td>
                  <span className="cdash-money">{baht(p.outstanding)}</span>
                  {Number(p.overdue) > 0 && <span className="cdash-late">เกินกำหนด {baht(p.overdue)}</span>}
                </td>
                <td>
                  {p.next_due ? (
                    <>
                      <Link href={invoiceHref(p.org_slug, p.next_due.invoice_id)}>{p.next_due.reference}</Link>
                      <span className="customer-case-id">
                        {baht(p.next_due.total)} · {date(p.next_due.due_date)}
                      </span>
                    </>
                  ) : (
                    <span className="muted">ไม่มียอดรอชำระ</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Invoices still to pay, soonest (and overdue) first. */
export function UpcomingPayments({ items, titleOf }: { items: UpcomingPayment[]; titleOf: (contractId: string) => string }) {
  if (!items.length) return <CustomerNone title="ไม่มียอดรอชำระ" hint="เมื่อองค์กรออกใบแจ้งหนี้ รายการที่ต้องชำระจะแสดงที่นี่" />;
  return (
    <ul className="cdash-upcoming">
      {items.map((i) => (
        <li key={`${i.org_slug}:${i.invoice_id}`} className={i.days_left < 0 ? 'is-late' : ''}>
          <div className="grow">
            <Link className="customer-case-title" href={invoiceHref(i.org_slug, i.invoice_id)}>
              {i.reference} · {i.milestone_title}
            </Link>
            <span className="customer-case-id">
              {titleOf(i.contract_id)} · {i.org_name}
            </span>
          </div>
          <div className="cdash-upcoming-due">
            <strong className="cdash-money">{baht(i.total)}</strong>
            <span className={i.days_left < 0 ? 'cdash-late' : 'muted'}>
              {date(i.due_date)} · {dueText(i.days_left)}
            </span>
          </div>
          <span className={`customer-state tone-${invoiceStatusTones[i.status]}`}>{invoiceStatusLabels[i.status]}</span>
        </li>
      ))}
    </ul>
  );
}
