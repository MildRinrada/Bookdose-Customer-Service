'use client';

import { Icon } from '@/components/Icon';
import { Avatar, EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { useToast } from '@/components/ui/Toast';
import { date } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { PLATFORM_PREFIX, REPORTS_PATH, setReportStatus } from './api';
import type { ProblemReport, ProblemReportsPage } from './types';

/* Platform console, รายงานปัญหา: what the staff of the organizations sent from the ? in their top bar - a bug, a
   button that does nothing, something that should exist. Nobody in their own organization can fix the product, so
   the report comes here with the address they were on and the browser they used, to be reproduced.

   Reading is all this screen does besides marking a report as dealt with: there is no reply from here, because the
   reporter is reached by the email address shown on the row. */

export function ProblemReportsScreen() {
  const page = useApi<ProblemReportsPage>(REPORTS_PATH);
  if (page.isPending) return <PageLoading />;
  if (page.error) return <ErrorState error={page.error} onRetry={() => void page.refetch()} />;
  return <ReportsView data={page.data} />;
}

function ReportsView({ data }: { data: ProblemReportsPage }) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>รายงานปัญหา</h1>
          <p>เรื่องที่ทีมงานขององค์กรส่งมาจากปุ่ม ? บนแถบบน · รอดู {data.open} เรื่อง จากทั้งหมด {data.reports.length} เรื่อง</p>
        </div>
      </div>
      {data.reports.length ? (
        <div className="report-stack">
          {data.reports.map((report, i) => (
            <ReportCard key={report.id} report={report} index={i} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="ยังไม่มีรายงานปัญหา"
          description="เมื่อทีมงานขององค์กรกดปุ่ม ? บนแถบบนแล้วเลือก รายงานปัญหา เรื่องจะมาอยู่ที่นี่"
          icon="checkCircle"
        />
      )}
    </>
  );
}

function ReportCard({ report, index }: { report: ProblemReport; index: number }) {
  const toast = useToast();
  const refresh = useInvalidate();
  const done = report.status === 'done';
  const move = async () => {
    await setReportStatus(report.id, done ? 'open' : 'done');
    toast(done ? 'เอากลับมาไว้ในรายการรอดูแล้ว' : 'ทำเครื่องหมายว่าดูแล้ว');
    await refresh(PLATFORM_PREFIX);
  };
  return (
    <section className={`card report-card${done ? ' handled' : ''}`}>
      <div className="card-header">
        <div className="org-cell">
          <Avatar name={report.user_name} index={index} />
          <div className="org-text">
            <strong className="truncate">{report.user_name || 'ไม่ทราบชื่อ'}</strong>
            <span className="muted truncate">
              {report.tenant_name || 'ไม่ทราบองค์กร'} · {report.user_email || 'ไม่มีอีเมล'}
            </span>
          </div>
        </div>
        <button type="button" className={`btn sm${done ? ' subtle' : ' primary'}`} onClick={() => void move()}>
          <Icon name={done ? 'restore' : 'check'} />
          {done ? 'เอากลับมารอดู' : 'ดูแล้ว'}
        </button>
      </div>
      <div className="card-body">
        <p className="report-message">{report.message}</p>
        <dl className="report-facts">
          <div>
            <dt>ส่งเมื่อ</dt>
            <dd>{date(report.created_at, true)}</dd>
          </div>
          <div>
            <dt>หน้าที่แจ้ง</dt>
            <dd className="truncate">{report.page || '-'}</dd>
          </div>
          <div>
            <dt>เบราว์เซอร์</dt>
            <dd className="truncate" title={report.browser}>
              {report.browser || '-'}
            </dd>
          </div>
          {done && (
            <div>
              <dt>ดูแล้วโดย</dt>
              <dd>
                {report.handled_by || '-'}
                {report.handled_at ? ` · ${date(report.handled_at, true)}` : ''}
              </dd>
            </div>
          )}
        </dl>
      </div>
    </section>
  );
}
