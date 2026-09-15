'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { contractKindLabels } from '@/features/contracts';
import { OrgFilter } from '@/features/customer/components/common';
import { useOrgFilter } from '@/features/customer/hooks';
import { relative } from '@/lib/format';
import { useApi } from '@/lib/query';
import { APPROVALS_PATH } from './api';
import type { ApprovalItem } from './types';

/* งานรออนุมัติ: deliveries and contract versions waiting for the customer's step in an approval flow, or for their
   final decision once every reviewer passed them (GET /api/customer/approvals), in every organization. Each links to
   the milestone or the document where the buttons are. Markup: pages/team.css (.approval-list). */

function itemHref(i: ApprovalItem): string {
  const base = `/customer/documents/${i.org_slug}/${i.contract_id}`;
  return i.target === 'delivery' ? `${base}?tab=milestones#milestone-${i.milestone_id}` : base;
}

function itemState(i: ApprovalItem): string {
  if (!i.final) return `ตรวจขั้นที่ ${i.step}/${i.steps}`;
  if (!i.steps) return i.target === 'delivery' ? 'รออนุมัติรับงาน' : 'รอลงนาม';
  return `ผ่านการตรวจครบ ${i.steps} ขั้น · ${i.target === 'delivery' ? 'รออนุมัติรับงาน' : 'รอลงนาม'}`;
}

function ApprovalGroup({ title, hint, items }: { title: string; hint: string; items: ApprovalItem[] }) {
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>
            {title} <span className="count">{items.length}</span>
          </h2>
          <p>{hint}</p>
        </div>
      </div>
      {items.length ? (
        <ul className="approval-list">
          {items.map((i) => (
            <li key={`${i.org_slug}:${i.target}:${i.contract_id}:${i.milestone_id ?? ''}`} className="approval-item">
              <span className="grow">
                <Link className="approval-item-title" href={itemHref(i)}>
                  {i.target === 'delivery' ? `งาน “${i.milestone_title}”` : `${contractKindLabels[i.kind]} “${i.title}”`}
                </Link>
                <span className="muted">
                  {contractKindLabels[i.kind]} {i.reference}
                  {i.target === 'delivery' ? ` · ${i.title}` : ''}
                </span>
              </span>
              <span className="customer-org-badge" title={i.org_name}>
                {i.org_name}
              </span>
              <span className={`customer-state tone-${i.final ? 'waiting' : 'working'}`}>{itemState(i)}</span>
              <time className="muted" dateTime={i.at}>
                {relative(i.at)}
              </time>
              <Link className="btn sm" href={itemHref(i)}>
                {i.final ? 'เปิดเพื่ออนุมัติ' : 'เปิดเพื่อตรวจ'}
                <Icon name="arrow" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="card-body">
          <p className="muted">ไม่มีรายการ</p>
        </div>
      )}
    </section>
  );
}

export function ApprovalsScreen() {
  const q = useApi<{ items: ApprovalItem[] }>(APPROVALS_PATH);
  const [orgFilter] = useOrgFilter();
  const heading = (
    <div className="page-heading">
      <div>
        <h1>งานรออนุมัติ</h1>
        <p>งานส่งมอบและเอกสารที่รอคุณตรวจตามขั้นตอนอนุมัติ หรือรอการตัดสินใจขั้นสุดท้าย</p>
      </div>
      <OrgFilter id="approvals-org" />
    </div>
  );
  if (q.error)
    return (
      <>
        {heading}
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </>
    );
  if (!q.data) return <PageLoading />;
  const items = q.data.items.filter((i) => !orgFilter || i.org_slug === orgFilter);
  const reviews = items.filter((i) => !i.final);
  const decisions = items.filter((i) => i.final);
  return (
    <>
      {heading}
      {items.length ? (
        <div className="team-page">
          <ApprovalGroup
            title="รอคุณตรวจ"
            hint="ถึงขั้นของคุณในขั้นตอนอนุมัติ เลือกผ่านการตรวจ หรือส่งกลับแก้ไขพร้อมหมายเหตุ"
            items={reviews}
          />
          <ApprovalGroup
            title="รอคุณอนุมัติขั้นสุดท้าย"
            hint="ผู้ตรวจทุกขั้นผ่านแล้ว (หรือไม่มีขั้นตอนตรวจ) อนุมัติรับงานหรือลงนามได้"
            items={decisions}
          />
        </div>
      ) : (
        <section className="card">
          <EmptyState title="ไม่มีงานรออนุมัติ" description="เมื่อถึงขั้นตอนที่คุณต้องตรวจหรืออนุมัติ รายการจะแสดงที่นี่" icon="check">
            <Link className="btn" href="/customer/team">
              <Icon name="users" />
              ตั้งขั้นตอนอนุมัติในทีมของฉัน
            </Link>
          </EmptyState>
        </section>
      )}
    </>
  );
}
