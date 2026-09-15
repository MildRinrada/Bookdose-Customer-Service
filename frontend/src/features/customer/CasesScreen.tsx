'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { EmptyState, StatCard } from '@/components/ui/display';
import { FilterPill } from '@/components/ui/filters';
import { relative } from '@/lib/format';
import { NewChatLink, OrgFilter } from './components/common';
import { useOrgFilter, useOverview } from './hooks';
import { caseDueText, caseGroups, caseInGroup, caseState, type CaseGroup } from './labels';

/* เคสของฉัน: what the teams took on as a case, where it stands, and when they said they would answer or finish
   (pages/customer/customer-cases.html). ?show= picks a group. */

const pills: Array<[CaseGroup, string]> = [
  ['', 'ทั้งหมด'],
  ['open', 'ยังไม่เสร็จ'],
  ['waiting', 'รอคุณ'],
  ['done', 'เสร็จแล้ว'],
];

export function CasesScreen({ show: requested = '' }: { show?: string }) {
  const overview = useOverview();
  const router = useRouter();
  const [orgFilter] = useOrgFilter();
  const show: CaseGroup = (caseGroups as string[]).includes(requested) ? (requested as CaseGroup) : '';
  const cases = overview.cases.filter((t) => !orgFilter || t.org_slug === orgFilter);
  const n = (key: CaseGroup) => cases.filter((t) => caseInGroup(t, key)).length;
  const shown = cases.filter((t) => caseInGroup(t, show));
  const waiting = n('waiting');
  const filtering = Boolean(show || orgFilter);

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>เคสของฉัน</h1>
          <p>เรื่องที่ทีมงานของแต่ละองค์กรรับเป็นเคสบริการ พร้อมสถานะและกำหนดเวลาที่ทีมรับปากไว้</p>
        </div>
      </div>
      <div className="stats-grid customer-stats">
        <StatCard label="กำลังดำเนินการ" value={n('open')} icon="clock" foot="ดูเคสที่ยังไม่เสร็จ" href="/customer/cases?show=open" />
        <StatCard
          label="รอข้อมูลจากคุณ"
          value={waiting}
          icon="chat"
          color="amber"
          foot={waiting ? 'ตอบกลับทีมงาน' : 'ไม่มีเคสที่รอคุณ'}
          href="/customer/cases?show=waiting"
          urgent={waiting > 0}
        />
        <StatCard label="เสร็จแล้ว" value={n('done')} icon="checkCircle" color="green" foot="ดูเคสที่เสร็จแล้ว" href="/customer/cases?show=done" />
      </div>
      <section className="card customer-cases">
        <div className="card-header">
          <div>
            <h2>รายการเคส</h2>
            <p>{shown.length} เคส · อัปเดตล่าสุดอยู่บนสุด</p>
          </div>
          <div className="customer-cases-tools">
            <OrgFilter id="customer-case-org" />
            <div className="filter-pills" role="group" aria-label="กรองเคส">
              {pills.map(([value, label]) => (
                <FilterPill
                  key={value}
                  label={label}
                  value={value}
                  pressed={show === value}
                  count={n(value)}
                  warning={value === 'waiting' && waiting > 0}
                  onClick={(v) => router.replace(v ? `/customer/cases?show=${v}` : '/customer/cases')}
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
                  <th>เรื่อง / หมายเลขเคส</th>
                  <th>องค์กร</th>
                  <th>สถานะ</th>
                  <th>กำหนดการ</th>
                  <th>อัปเดตล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => {
                  const view = caseState(t.status);
                  return (
                    <tr key={`${t.org_slug}:${t.id}`}>
                      <td>
                        <Link className="customer-case-title" href={`/customer/cases/${t.org_slug}/${t.id}`} title={t.subject}>
                          {t.subject}
                        </Link>
                        <span className="customer-case-id">
                          BD-{t.number} · {t.category}
                        </span>
                      </td>
                      <td>
                        <span className="customer-org-badge" title={t.org_name}>
                          {t.org_name}
                        </span>
                      </td>
                      <td>
                        <span className={`customer-state tone-${view.tone}`}>{view.label}</span>
                      </td>
                      <td className="customer-due">{caseDueText(t)}</td>
                      <td className="customer-updated">
                        <time dateTime={t.updated_at}>{relative(t.updated_at)}</time>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={filtering ? 'ไม่มีเคสในกลุ่มนี้' : 'ยังไม่มีเคส'}
            description={
              filtering ? 'ลองดูกลุ่มอื่น หรือเลือก “ทุกองค์กร”' : 'เมื่อทีมงานรับเรื่องจากแชทเป็นเคสบริการ เคสจะแสดงที่นี่พร้อมสถานะและกำหนดเวลา'
            }
            icon="ticket"
          >
            {!filtering && <NewChatLink />}
          </EmptyState>
        )}
      </section>
    </>
  );
}
