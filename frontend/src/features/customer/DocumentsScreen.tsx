'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { EmptyState } from '@/components/ui/display';
import { FilterPill } from '@/components/ui/filters';
import { contractKindLabels, contractStatusLabels, contractStatusTones } from '@/features/contracts';
import { relative } from '@/lib/format';
import { OrgFilter } from './components/common';
import { useOrgFilter, useOverview } from './hooks';
import { documentGroups, documentInGroup } from './labels';

/* สัญญาและโครงการ: every contract and TOR sent to the customer by any organization, and where each stands
   (pages/contracts/customer-documents.html). ?show= picks a group. */

export function DocumentsScreen({ show: requested = '' }: { show?: string }) {
  const overview = useOverview();
  const router = useRouter();
  const [orgFilter] = useOrgFilter();
  const show = ['', 'open', 'waiting', 'done'].includes(requested) ? requested : '';
  const list = overview.contracts.filter((x) => !orgFilter || x.org_slug === orgFilter);
  const count = (key: string) => list.filter((x) => documentInGroup(x, key)).length;
  const shown = list.filter((x) => documentInGroup(x, show));

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>สัญญาและโครงการ</h1>
          <p>สัญญาและ TOR ที่องค์กรส่งให้คุณ ตั้งแต่ตรวจและลงนาม ติดตามงวดงานและการชำระเงิน จนถึงรับประกันและ MA</p>
        </div>
      </div>
      <section className="card customer-cases">
        <div className="card-header">
          <div>
            <h2>รายการเอกสาร</h2>
            <p>{shown.length} ฉบับ · อัปเดตล่าสุดอยู่บนสุด</p>
          </div>
          <div className="customer-cases-tools">
            <OrgFilter id="customer-doc-org" />
            <div className="filter-pills" role="group" aria-label="กรองเอกสาร">
              {documentGroups.map(([value, label]) => (
                <FilterPill
                  key={value}
                  label={label}
                  value={value}
                  pressed={show === value}
                  count={count(value)}
                  warning={value === 'waiting' && count(value) > 0}
                  onClick={(v) => router.replace(v ? `/customer/documents?show=${v}` : '/customer/documents')}
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
                  <th>เอกสาร</th>
                  <th>องค์กร</th>
                  <th>สถานะ</th>
                  <th>ความคืบหน้า</th>
                  <th>เวอร์ชัน</th>
                  <th>อัปเดตล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((x) => {
                  const cover = x.coverage?.state === 'active' ? `ดูแลอีก ${x.coverage.days_left} วัน` : '';
                  return (
                    <tr key={`${x.org_slug}:${x.id}`}>
                      <td>
                        <Link className="customer-case-title" href={`/customer/documents/${x.org_slug}/${x.id}`} title={x.title}>
                          {x.title}
                        </Link>
                        <span className="customer-case-id">
                          {contractKindLabels[x.kind]} {x.reference}
                        </span>
                      </td>
                      <td>
                        <span className="customer-org-badge" title={x.org_name}>
                          {x.org_name}
                        </span>
                      </td>
                      <td>
                        <span className={`customer-state tone-${contractStatusTones[x.status]}`}>{contractStatusLabels[x.status]}</span>
                        {cover && <span className="contract-todo">{cover}</span>}
                      </td>
                      <td>
                        {x.progress == null ? (
                          '-'
                        ) : (
                          <span className="project-mini">
                            <progress className="project-meter sm" max={100} value={x.progress}>
                              {x.progress}%
                            </progress>
                            {x.progress}%
                          </span>
                        )}
                      </td>
                      <td>{x.version}</td>
                      <td className="customer-updated">
                        <time dateTime={x.updated_at}>{relative(x.updated_at)}</time>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="ยังไม่มีเอกสาร" description="เมื่อองค์กรส่งสัญญาหรือ TOR ให้คุณตรวจ เอกสารจะแสดงที่นี่" icon="file" />
        )}
      </section>
    </>
  );
}
