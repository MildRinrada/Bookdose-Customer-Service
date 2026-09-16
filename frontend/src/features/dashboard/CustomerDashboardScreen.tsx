'use client';

import Link from 'next/link';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { OrgFilter } from '@/features/customer/components/common';
import { useOrgFilter } from '@/features/customer/hooks';
import { useApi } from '@/lib/query';
import { CUSTOMER_DASHBOARD_PATH } from './api';
import { SlaCards } from './components/CustomerSla';
import type { CustomerDashboard } from './types';

/* ภาพรวม, the customer's landing page: how fast each organization answered and finished the customer's cases, and
   how the customer rated them (GET /api/customer/dashboard). The organization filter is the one the other customer
   screens share. The staff overview is DashboardScreen.tsx in this folder. Markup: pages/dashboard-customer.css. */

export function CustomerDashboardScreen() {
  const query = useApi<CustomerDashboard>(CUSTOMER_DASHBOARD_PATH);
  const [orgFilter] = useOrgFilter();

  const heading = (
    <div className="page-heading">
      <div>
        <h1>ภาพรวม</h1>
        <p>ระดับการให้บริการของทุกองค์กรที่คุณติดต่อ จากเคสของคุณ</p>
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

  const { sla } = query.data;
  if (!sla.orgs.length)
    return (
      <>
        {heading}
        <section className="card">
          <EmptyState title="ยังไม่มีข้อมูลภาพรวม" description="เมื่อคุณเปิดเคสกับองค์กรใด เวลาตอบกลับ เวลาแก้ไข และคะแนนความพึงพอใจจะแสดงที่นี่" icon="chart">
            <div className="cdash-empty-links">
              <Link className="btn primary" href="/customer/chats/new">
                เริ่มแชทกับทีมงาน
              </Link>
            </div>
          </EmptyState>
        </section>
      </>
    );

  const orgs = sla.orgs.filter((o) => !orgFilter || o.org_slug === orgFilter);
  return (
    <>
      {heading}
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
    </>
  );
}
