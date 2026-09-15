'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { EmptyState } from '@/components/ui/display';
import { FilterPill } from '@/components/ui/filters';
import { invoiceStatusLabels, invoiceStatusTones } from '@/features/contracts';
import { baht, date } from '@/lib/format';
import { OrgFilter } from './components/common';
import { useOrgFilter, useOverview } from './hooks';
import { billingGroups } from './labels';

/* ใบแจ้งหนี้/ใบเสร็จ: the invoices of every project and organization in one list, with what is still to pay
   (pages/contracts/customer-billing.html). ?show= picks a status. */

export function BillingScreen({ show: requested = '' }: { show?: string }) {
  const overview = useOverview();
  const router = useRouter();
  const [orgFilter] = useOrgFilter();
  const show = requested in billingGroups ? requested : '';
  const list = overview.invoices.filter((x) => !orgFilter || x.org_slug === orgFilter);
  const count = (key: string) => list.filter((x) => !key || x.status === key).length;
  const shown = list.filter((x) => !show || x.status === show);
  const outstanding = baht(list.filter((x) => x.status !== 'paid').reduce((sum, x) => sum + Number(x.total), 0));

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>ใบแจ้งหนี้และใบเสร็จ</h1>
          <p>ทุกโครงการ ทุกองค์กร · ค้างชำระ {outstanding}</p>
        </div>
      </div>
      <section className="card customer-cases">
        <div className="card-header">
          <div>
            <h2>รายการ</h2>
            <p>{shown.length} ใบ · ล่าสุดอยู่บนสุด</p>
          </div>
          <div className="customer-cases-tools">
            <OrgFilter id="customer-billing-org" />
            <div className="filter-pills" role="group" aria-label="กรองใบแจ้งหนี้">
              {Object.entries(billingGroups).map(([value, label]) => (
                <FilterPill
                  key={value}
                  label={label}
                  value={value}
                  pressed={show === value}
                  count={count(value)}
                  warning={value === 'unpaid' && count(value) > 0}
                  onClick={(v) => router.replace(v ? `/customer/billing?show=${v}` : '/customer/billing')}
                />
              ))}
            </div>
          </div>
        </div>
        {shown.length ? (
          <div className="table-scroll">
            <table className="customer-case-table">
              <thead>
                <tr>
                  <th>เลขที่</th>
                  <th>โครงการ</th>
                  <th>องค์กร</th>
                  <th>ยอดชำระ</th>
                  <th>ครบกำหนด</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((x) => (
                  <tr key={`${x.org_slug}:${x.id}`}>
                    <td>
                      <Link className="customer-case-title" href={`/customer/billing/${x.org_slug}/${x.id}`}>
                        {x.reference}
                      </Link>
                      {x.receipt_reference && <span className="customer-case-id">ใบเสร็จ {x.receipt_reference}</span>}
                    </td>
                    <td>
                      <span className="contract-person">
                        {x.contract_reference} · {x.title}
                      </span>
                      <span className="muted">{x.milestone_title}</span>
                    </td>
                    <td>
                      <span className="customer-org-badge" title={x.org_name}>
                        {x.org_name}
                      </span>
                    </td>
                    <td>{baht(x.total)}</td>
                    <td>{date(x.due_date)}</td>
                    <td>
                      <span className={`customer-state tone-${invoiceStatusTones[x.status]}`}>{invoiceStatusLabels[x.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="ยังไม่มีใบแจ้งหนี้" description="เมื่อคุณตรวจรับงานงวดที่มียอดเงิน หรือองค์กรออกใบแจ้งหนี้ รายการจะแสดงที่นี่" icon="receipt" />
        )}
      </section>
    </>
  );
}
