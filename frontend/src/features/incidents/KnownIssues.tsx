'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { useApi } from '@/lib/query';
import { useWork } from '@/lib/session';

/* ประกาศปัญหาที่รู้แล้ว (backend/modules/incidents): what of the organization's is down, told on every chat page before
   anybody asks - "ตอนนี้ระบบชำระเงินมีปัญหา ทีมกำลังแก้ไข" - so a hundred customers do not each write in to ask the
   same thing. Once it is fixed it shows as back for an hour, so the ones who saw the problem see it end.
   The team sees the same notices over the inbox, so they know what customers are being told. Markup:
   pages/known-issues.css. */

export type KnownIssue = {
  id: string;
  title: string;
  detail: string;
  status: 'active' | 'resolved';
  updated_at: string;
  resolved_at: string | null;
  author_name?: string;
  created_at?: string;
};

// An open chat page asks again every minute: a notice posted during a problem reaches the customers already there.
const POLL_MS = 60000;

/** The notices on a customer's chat page (the visitor's and the signed-in customer's), for the organization `slug`. */
export function KnownIssuesBar({ slug }: { slug: string }) {
  const found = useApi<{ issues: KnownIssue[] }>(slug ? `/api/public/${slug}/issues` : null, { refetchInterval: POLL_MS });
  const issues = found.data?.issues ?? [];
  if (!issues.length) return null;
  return (
    <div className="known-issues" role="status" aria-live="polite">
      {issues.map((issue) => (
        <p key={issue.id} className={`known-issue ${issue.status}`}>
          <Icon name={issue.status === 'active' ? 'bell' : 'checkCircle'} />
          <span>
            {issue.status === 'active' ? (
              <>
                <strong>ตอนนี้{issue.title}มีปัญหา</strong> ทีมงานทราบแล้วและกำลังแก้ไข ไม่ต้องแจ้งซ้ำ
              </>
            ) : (
              <>
                <strong>{issue.title}กลับมาใช้งานได้แล้ว</strong> ขอบคุณที่รอ
              </>
            )}
            {issue.detail && issue.status === 'active' && <span className="known-issue-detail">{issue.detail}</span>}
          </span>
        </p>
      ))}
    </div>
  );
}

/** The same notices over the team's inbox: what customers are being told right now, and where to change it. */
export function StaffIssuesBanner() {
  const work = useWork();
  const found = useApi<{ issues: KnownIssue[] }>('/api/issues', { refetchInterval: POLL_MS });
  const active = (found.data?.issues ?? []).filter((i) => i.status === 'active');
  if (!active.length) return null;
  return (
    <div className="known-issues staff" role="status">
      <p className="known-issue active">
        <Icon name="bell" />
        <span>
          <strong>ลูกค้าเห็นประกาศอยู่:</strong> {active.map((i) => `${i.title}มีปัญหา`).join(' · ')}
        </span>
        {work.role === 'admin' && !work.read_only && (
          <Link className="known-issue-manage" href="/settings?tab=issues">
            จัดการประกาศ
          </Link>
        )}
      </p>
    </div>
  );
}
