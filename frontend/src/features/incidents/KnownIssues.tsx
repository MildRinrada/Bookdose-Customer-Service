'use client';

import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { Icon } from '@/components/Icon';
import { useRunAction } from '@/components/ui/actions';
import { useToast } from '@/components/ui/Toast';
import { followingPath, followIssue, reportAffected } from '@/features/customer/api';
import { readerToken } from '@/features/customer/components/ArticleFeedback';
import { useApi, useInvalidate } from '@/lib/query';
import { useWork } from '@/lib/session';

/* ประกาศปัญหาที่รู้แล้ว (backend/modules/incidents): what of the organization's is down, told on every chat page before
   anybody asks - "ตอนนี้ระบบชำระเงินมีปัญหา ทีมกำลังแก้ไข" - so a hundred customers do not each write in to ask the
   same thing. Once it is fixed it shows as back for an hour, so the ones who saw the problem see it end.
   A signed-in customer can ask to hear when an active one is fixed (แจ้งฉันเมื่อแก้แล้ว, incidents/follow.py) instead
   of writing in to ask. Anyone reading an active one can say ฉันก็เจอ (incidents/service.py): everyone sees how many
   did, and the team sees how many customers it touches. The team sees the same notices over the inbox, so they know
   what customers are being told. Markup: pages/known-issues.css. */

export type KnownIssue = {
  id: string;
  title: string;
  detail: string;
  status: 'active' | 'resolved';
  updated_at: string;
  resolved_at: string | null;
  /** ฉันก็เจอ: how many browsers said they hit it. */
  affected?: number;
  author_name?: string;
  created_at?: string;
};

// An open chat page asks again every minute: a notice posted during a problem reaches the customers already there.
const POLL_MS = 60000;
const SAID_KEY = 'bookdose:issues-affected';

function saidAffected(issueId: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(SAID_KEY) || '[]') as string[]).includes(issueId);
  } catch {
    return false;
  }
}

function rememberAffected(issueId: string, on: boolean) {
  try {
    const kept = (JSON.parse(localStorage.getItem(SAID_KEY) || '[]') as string[]).filter((id) => id !== issueId);
    localStorage.setItem(SAID_KEY, JSON.stringify(on ? [...kept, issueId].slice(-50) : kept));
  } catch {
    /* Remembered for this page only. */
  }
}

const noChange = () => () => {};

/** ฉันก็เจอ at the end of an active notice, with how many said so; pressing again takes it back. */
function AffectedButton({ slug, issue }: { slug: string; issue: KnownIssue }) {
  // What this browser said before, read after the page is drawn (the server keeps only a hash of the token).
  const before = useSyncExternalStore(noChange, () => saidAffected(issue.id), () => false);
  const [pressed, setPressed] = useState<boolean | null>(null);
  const on = pressed ?? before;
  const run = useRunAction();
  const refresh = useInvalidate();
  const press = () =>
    run(async () => {
      await reportAffected(slug, issue.id, !on, readerToken());
      rememberAffected(issue.id, !on);
      setPressed(!on);
      await refresh(`/api/public/${slug}/issues`);
    });
  const count = issue.affected ?? 0;
  return (
    <span className="known-issue-affected">
      {count > 0 && <span className="known-issue-count">ลูกค้าเจอปัญหานี้ {count.toLocaleString('th-TH')} คน</span>}
      <button type="button" className={`btn sm known-issue-follow${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => void press()}>
        <Icon name={on ? 'check' : 'users'} />
        {on ? 'คุณแจ้งว่าเจอแล้ว' : 'ฉันก็เจอ'}
      </button>
    </span>
  );
}

/** The notices on a customer's chat page (the visitor's and the signed-in customer's), for the organization `slug`. */
export function KnownIssuesBar({ slug, follow = false }: { slug: string; follow?: boolean }) {
  const found = useApi<{ issues: KnownIssue[] }>(slug ? `/api/public/${slug}/issues` : null, { refetchInterval: POLL_MS });
  const issues = found.data?.issues ?? [];
  const active = follow && issues.some((i) => i.status === 'active');
  const following = useApi<{ following: string[] }>(active ? followingPath(slug) : null);
  const mine = following.data?.following ?? [];
  const run = useRunAction();
  const toast = useToast();
  const refresh = useInvalidate();
  const toggle = (issue: KnownIssue, on: boolean) =>
    run(async () => {
      await followIssue(slug, issue.id, on);
      await refresh(followingPath(slug));
      toast(on ? 'จะแจ้งให้ทราบเมื่อแก้เสร็จ ทางช่องทางที่คุณตั้งไว้ในการแจ้งเตือน' : 'เลิกติดตามแล้ว');
    });
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
          {issue.status === 'active' && <AffectedButton slug={slug} issue={issue} />}
          {active && issue.status === 'active' && following.data && (
            mine.includes(issue.id) ? (
              <button type="button" className="btn sm known-issue-follow is-on" aria-pressed="true" onClick={() => void toggle(issue, false)}>
                <Icon name="check" />
                ติดตามอยู่
              </button>
            ) : (
              <button type="button" className="btn sm known-issue-follow" aria-pressed="false" onClick={() => void toggle(issue, true)}>
                <Icon name="bell" />
                แจ้งฉันเมื่อแก้แล้ว
              </button>
            )
          )}
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
          <strong>ลูกค้าเห็นประกาศอยู่:</strong>{' '}
          {active.map((i) => `${i.title}มีปัญหา${i.affected ? ` (ลูกค้าแจ้งว่าเจอ ${i.affected.toLocaleString('th-TH')} คน)` : ''}`).join(' · ')}
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
