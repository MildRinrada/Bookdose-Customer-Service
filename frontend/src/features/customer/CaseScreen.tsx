'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { ProgressSteps } from '@/features/contracts';
import { date, relative, starsText } from '@/lib/format';
import { useApi } from '@/lib/query';
import { casePath } from './api';
import { useOrgs, useOverview } from './hooks';
import { caseState, chatState } from './labels';
import type { CaseDetail } from './types';

/* One case (pages/customer/customer-case.html): where it stands, what the team did and promised, its facts, and the
   chats that belong to it. */

export function CaseScreen({ slug, id }: { slug: string; id: string }) {
  const query = useApi<CaseDetail>(casePath(slug, id));
  const orgs = useOrgs();
  const overview = useOverview();
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <PageLoading />;
  const data = query.data;
  const t = data.case;
  const view = caseState(t.status);
  const done = view.tone === 'done';
  const listed = overview.cases.find((x) => x.id === t.id);
  const orgName = orgs.find((o) => o.slug === slug)?.name || listed?.org_name || '';
  const reference = `BD-${t.number}`;
  const replyChat = view.tone === 'waiting' ? data.conversations[0]?.id || '' : '';

  const timeline = [
    { title: 'เปิดเคส', detail: date(t.created_at, true), done: true },
    t.first_response_at
      ? { title: 'ทีมงานตอบครั้งแรก', detail: date(t.first_response_at, true), done: true }
      : { title: 'ทีมงานตอบครั้งแรก', detail: `ภายใน ${date(t.first_response_due_at, true)}`, done: false },
    ...(done ? [] : data.followups.map((at) => ({ title: 'ทีมงานนัดติดตาม', detail: date(at, true), done: false }))),
    done
      ? { title: 'ดำเนินการเรียบร้อย', detail: date(t.resolved_at || t.updated_at, true), done: true }
      : { title: 'กำหนดดำเนินการเสร็จ', detail: `ภายใน ${date(t.resolution_due_at, true)}`, done: false },
  ];
  const facts: Array<[string, string]> = [
    ['องค์กร', orgName || slug],
    ['เลขเคส', reference],
    ['หมวดหมู่', t.category],
    ['เปิดเมื่อ', date(t.created_at, true)],
    ['อัปเดตล่าสุด', relative(t.updated_at)],
    ...(data.rating ? [['คะแนนที่คุณให้', `${starsText(data.rating)} ${data.rating}/5`] as [string, string]] : []),
  ];

  return (
    <>
      <Link href="/customer/cases" className="back-link">
        <Icon name="back" />
        เคสทั้งหมดของฉัน
      </Link>
      <section className={`customer-banner tone-${view.tone}`}>
        <div className="customer-banner-main">
          <span className="customer-banner-ref">
            เคส {reference} · {orgName}
          </span>
          <h1>{t.subject}</h1>
          <p>
            <strong>{view.label}</strong> · {view.hint}
          </p>
          {replyChat && (
            <Link className="btn primary" href={`/customer/chats/${slug}/${replyChat}`}>
              <Icon name="chat" />
              ตอบกลับทีมงาน
            </Link>
          )}
        </div>
        <div className="customer-banner-side">
          <ProgressSteps steps={['ส่งเรื่องแล้ว', 'ทีมงานดูแล', 'เรียบร้อย']} step={view.step} />
        </div>
      </section>
      <div className="customer-case-grid">
        <section className="card">
          <div className="card-header">
            <div>
              <h2>ความคืบหน้าและกำหนดเวลา</h2>
              <p>สิ่งที่ทีมงานทำแล้ว และสิ่งที่ทีมรับปากไว้</p>
            </div>
          </div>
          <div className="card-body">
            <ol className="customer-timeline">
              {timeline.map((item, i) => (
                <li key={i} className={`customer-timeline-item${item.done ? ' done' : ''}`}>
                  <span className="customer-timeline-dot" aria-hidden="true">
                    {item.done && <Icon name="check" />}
                  </span>
                  <div className="customer-timeline-text">
                    <strong>{item.title}</strong>
                    <span>{item.detail}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>
        <aside className="customer-case-side">
          <section className="card">
            <div className="card-header">
              <h2>ข้อมูลเคส</h2>
            </div>
            <div className="card-body">
              <dl className="customer-facts">
                {facts.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>
          <section className="card">
            <div className="card-header">
              <h2>แชทในเคสนี้</h2>
            </div>
            {data.conversations.length ? (
              <div className="customer-link-list">
                {data.conversations.map((x) => (
                  <Link key={x.id} className="customer-link-row" href={`/customer/chats/${slug}/${x.id}`}>
                    <span className="customer-link-icon">
                      <Icon name="chat" />
                    </span>
                    <span className="customer-link-text">
                      <strong className="truncate">{x.subject}</strong>
                      <span className="muted">
                        {chatState({ status: x.status, ticket_status: t.status }).label} · {relative(x.updated_at)}
                      </span>
                    </span>
                    <Icon name="arrow" />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="card-body">
                <p className="muted">
                  ทีมงานบันทึกเคสนี้จากช่องทางอื่น ถ้าต้องการคุยเรื่องนี้ <Link href="/customer/chats/new">เริ่มแชทใหม่</Link> แล้วแจ้งเลขเคส {reference}
                </p>
              </div>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
