'use client';

import Link from 'next/link';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { OrgFilter } from '@/features/customer/components/common';
import { useOrgFilter, useOverview } from '@/features/customer/hooks';
import { useApi } from '@/lib/query';
import { CUSTOMER_DASHBOARD_PATH } from './api';
import { BudgetCards, BudgetTable, budgetTotals, UpcomingPayments } from './components/CustomerBudget';
import { HealthList, HealthSummary } from './components/CustomerHealth';
import { MonthlyPaid } from './components/CustomerMonthly';
import { SlaCards } from './components/CustomerSla';
import { healthStates } from './labels';
import type { BudgetProject, CustomerDashboard } from './types';

/* ภาพรวมโครงการ, the customer's landing page: budget and payments, the health of each project against its plan, and
   the service levels of every organization (GET /api/customer/dashboard). The server already leaves out what the
   viewer's team role may not see (finance: no health; technical: no money), so a section without rows is not shown.
   The organization filter is the one the other customer screens share. The staff overview is DashboardScreen.tsx in
   this folder. Markup: pages/dashboard-customer.css. */

export function CustomerDashboardScreen() {
  const query = useApi<CustomerDashboard>(CUSTOMER_DASHBOARD_PATH);
  const overview = useOverview();
  const [orgFilter] = useOrgFilter();

  const heading = (
    <div className="page-heading">
      <div>
        <h1>ภาพรวมโครงการ</h1>
        <p>งบประมาณและการชำระเงิน ความคืบหน้าเทียบแผน และระดับการให้บริการของทุกองค์กรที่คุณติดต่อ</p>
      </div>
      <div className="customer-cases-tools">
        <OrgFilter id="customer-dashboard-org" />
      </div>
    </div>
  );

  if (query.isPending)
    return (
      <>
        {heading}
        <PageLoading />
      </>
    );
  if (query.error || !query.data)
    return (
      <>
        {heading}
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </>
    );

  const { budget, health, sla } = query.data;
  if (!budget.projects.length && !health.projects.length && !sla.orgs.length)
    return (
      <>
        {heading}
        <section className="card">
          <EmptyState
            title="ยังไม่มีข้อมูลภาพรวม"
            description="เมื่อองค์กรส่งสัญญาหรือ TOR ให้คุณและลงนามครบทั้งสองฝ่าย งบประมาณ ความคืบหน้าของแต่ละงวด และระดับการให้บริการจะแสดงที่นี่"
            icon="chart"
          >
            <div className="cdash-empty-links">
              <Link className="btn" href="/customer/documents">
                ดูสัญญาและโครงการ
              </Link>
              <Link className="btn primary" href="/customer/chats/new">
                เริ่มแชทกับทีมงาน
              </Link>
            </div>
          </EmptyState>
        </section>
      </>
    );

  const inOrg = <T extends { org_slug: string }>(rows: T[]) => rows.filter((r) => !orgFilter || r.org_slug === orgFilter);
  const projects = inOrg(budget.projects);
  const upcoming = inOrg(budget.upcoming);
  const healthRows = inOrg(health.projects);
  const orgs = inOrg(sla.orgs);
  const totals = orgFilter ? budgetTotals(projects) : budget;
  const summary = orgFilter
    ? (Object.fromEntries(healthStates.map((s) => [s, healthRows.filter((h) => h.state === s).length])) as CustomerDashboard['health']['summary'])
    : health.summary;
  const titleOf = (contractId: string) => budget.projects.find((p) => p.contract_id === contractId)?.title ?? '';
  // Finance members reach a contract's invoices but not its project page.
  const canOpen = (p: BudgetProject) =>
    overview.contracts.some((c) => c.id === p.contract_id && c.org_slug === p.org_slug && c.can.includes('documents'));

  return (
    <>
      {heading}
      {budget.projects.length > 0 && (
        <>
          <BudgetCards totals={totals} />
          <div className="cdash-grid">
            <section className="card customer-cases">
              <div className="card-header">
                <div>
                  <h2>งบประมาณรายโครงการ</h2>
                  <p>{projects.length} โครงการ · ยอดรวมภาษีมูลค่าเพิ่มตามใบแจ้งหนี้</p>
                </div>
              </div>
              <BudgetTable projects={projects} canOpen={canOpen} />
            </section>
            <section className="card">
              <div className="card-header">
                <div>
                  <h2>กำหนดชำระ</h2>
                  <p>{upcoming.length ? `${upcoming.length} ใบแจ้งหนี้ · ใกล้ครบกำหนดอยู่บนสุด` : 'ไม่มียอดรอชำระ'}</p>
                </div>
                <Link href="/customer/billing">ทั้งหมด</Link>
              </div>
              <div className="card-body">
                <UpcomingPayments items={upcoming} titleOf={titleOf} />
              </div>
            </section>
          </div>
          {budget.monthly.length > 0 && (
            <section className="card cdash-monthly">
              <div className="card-header">
                <div>
                  <h2>ยอดชำระรายเดือน</h2>
                  <p>12 เดือนล่าสุด · ทุกองค์กร</p>
                </div>
              </div>
              <div className="card-body">
                <MonthlyPaid months={budget.monthly} />
              </div>
            </section>
          )}
        </>
      )}
      {health.projects.length > 0 && (
        <section className="card cdash-section">
          <div className="card-header">
            <div>
              <h2>ความคืบหน้าเทียบแผน</h2>
              <p>งานที่ส่งมอบและตรวจรับแล้ว เทียบกับงานที่ควรเสร็จตามวันครบกำหนดของแต่ละงวด</p>
            </div>
          </div>
          <div className="card-body">
            <HealthSummary summary={summary} />
            <HealthList projects={healthRows} />
          </div>
        </section>
      )}
      {sla.orgs.length > 0 && (
        <section className="cdash-section">
          <div className="cdash-section-head">
            <h2>ระดับการให้บริการ</h2>
            <p className="muted">จากเคสของคุณ เทียบกับเวลาที่แต่ละองค์กรรับปากไว้</p>
          </div>
          {orgs.length ? (
            <SlaCards orgs={orgs} />
          ) : (
            <section className="card">
              <EmptyState title="ยังไม่มีเคสกับองค์กรนี้" description="เลือก “ทุกองค์กร” เพื่อดูทั้งหมด" icon="ticket" />
            </section>
          )}
        </section>
      )}
    </>
  );
}
