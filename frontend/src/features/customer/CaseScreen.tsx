'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { date, relative, starsText } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { caseExportUrl, casePath, OVERVIEW_PATH, reopenCase, resolveCase } from './api';
import { CaseJourney, journeyEvents } from './components/CaseJourney';
import { useOrgs, useOverview } from './hooks';
import { caseState, chatState } from './labels';
import type { CaseDetail } from './types';

/* One case (pages/customer/customer-case.html): where it stands (เส้นทางเคส, like tracking a parcel), what the team
   did and when, what it promised, its facts, and the chats that belong to it. The signed-in customer's page; a guest follows a case of their chat with the same view
   (features/guest/GuestCaseScreen). */

export function CaseScreen({ slug, id }: { slug: string; id: string }) {
  const query = useApi<CaseDetail>(casePath(slug, id));
  const orgs = useOrgs();
  const overview = useOverview();
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <PageLoading />;
  const data = query.data;
  const listed = overview.cases.find((x) => x.id === data.case.id);
  return (
    <CaseView
      data={data}
      orgName={orgs.find((o) => o.slug === slug)?.name || listed?.org_name || slug}
      back={{ href: '/customer/cases', label: 'เคสทั้งหมดของฉัน' }}
      chatHref={(chat) => `/customer/chats/${slug}/${chat}`}
      newChatHref="/customer/chats/new"
      actions={<CaseActions slug={slug} id={id} data={data} />}
    />
  );
}

/* What the signed-in customer can do with their case (customers/perks.py): finish it themselves when the problem is
   solved, send it back when the problem returned within a few days of it being finished, and keep it as a file. */
function CaseActions({ slug, id, data }: { slug: string; id: string; data: CaseDetail }) {
  const { openModal, confirm } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const reopen = data.reopen;
  const askResolve = () =>
    confirm({
      title: 'ปัญหาแก้ไขแล้ว',
      message: `เคส BD-${data.case.number} จะเปลี่ยนเป็นแก้ไขแล้ว และทีมงานจะได้รับแจ้ง ถ้าปัญหากลับมาอีก ส่งเคสกลับได้ภายใน ${reopen?.days ?? 7} วัน`,
      confirmLabel: 'ยืนยันว่าแก้ไขแล้ว',
      run: async () => {
        await resolveCase(slug, id);
        toast('บันทึกว่าแก้ไขแล้ว ขอบคุณที่แจ้งให้ทราบ');
        await refresh(casePath(slug, id), OVERVIEW_PATH);
      },
    });
  return (
    <>
      {data.resolve?.allowed && (
        <button type="button" className="btn primary" onClick={askResolve}>
          <Icon name="check" />
          แก้ไขแล้ว
        </button>
      )}
      {reopen?.allowed && (
        <button type="button" className="btn primary" onClick={() => openModal('ปัญหายังไม่หาย', <ReopenForm slug={slug} id={id} data={data} />)}>
          <Icon name="restore" />
          ยังไม่หาย
        </button>
      )}
      <a className="btn" href={caseExportUrl(slug, id)} download>
        <Icon name="download" />
        ดาวน์โหลดประวัติ
      </a>
    </>
  );
}

function ReopenForm({ slug, id, data }: { slug: string; id: string; data: CaseDetail }) {
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const router = useRouter();
  return (
    <Form
      data-form="case-reopen"
      onSubmit={async (values) => {
        const result = await reopenCase(slug, id, String(values.message ?? ''));
        closeModal(true);
        toast('ส่งเคสกลับให้ทีมงานแล้ว');
        await refresh(casePath(slug, id), OVERVIEW_PATH);
        if (result.conversation_id) router.push(`/customer/chats/${slug}/${result.conversation_id}`);
      }}
    >
      <p className="notice">
        เคส BD-{data.case.number} จะกลับไปให้ทีมงานดูแลต่อ พร้อมข้อความของคุณในแชทเดิม ไม่ต้องเริ่มเล่าใหม่ ส่งกลับได้ภายใน {data.reopen?.days ?? 7} วันหลังปิดเคส
      </p>
      <div className="field">
        <label htmlFor="reopen-message">ตอนนี้เป็นอย่างไร (ไม่บังคับ)</label>
        <textarea id="reopen-message" name="message" rows={4} maxLength={1000} autoFocus placeholder="เช่น ใช้ได้วันเดียวแล้วกลับมาเป็นเหมือนเดิม" />
      </div>
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => closeModal()}>
          ยกเลิก
        </button>
        <button type="submit" className="btn primary">
          <Icon name="send" />
          ส่งเคสกลับให้ทีมงาน
        </button>
      </div>
    </Form>
  );
}

export type CaseViewProps = {
  data: CaseDetail;
  orgName: string;
  back: { href: string; label: string };
  /** Where one of the case's chats opens. */
  chatHref: (conversationId: string) => string;
  newChatHref: string;
  /** Buttons of the signed-in customer's own (ยังไม่หาย, ดาวน์โหลดประวัติ). */
  actions?: ReactNode;
};

/** Where a case stands and what comes next, for whoever follows it. */
export function CaseView({ data, orgName, back, chatHref, newChatHref, actions }: CaseViewProps) {
  const t = data.case;
  const view = caseState(t.status);
  const done = view.tone === 'done';
  const reference = `BD-${t.number}`;
  const replyChat = view.tone === 'waiting' ? data.conversations[0]?.id || '' : '';

  // What happened, each change with its time (เส้นทางเคส), then what the team has promised and not done yet.
  const timeline = [
    ...journeyEvents(data.journey, t.first_response_at).map((e) => ({ title: e.title, detail: date(e.at, true), done: true })),
    ...(t.first_response_at ? [] : [{ title: 'ทีมงานตอบครั้งแรก', detail: `ภายใน ${date(t.first_response_due_at, true)}`, done: false }]),
    ...(done ? [] : data.followups.map((at) => ({ title: 'ทีมงานนัดติดตาม', detail: date(at, true), done: false }))),
    ...(done ? [] : [{ title: 'กำหนดดำเนินการเสร็จ', detail: `ภายใน ${date(t.resolution_due_at, true)}`, done: false }]),
  ];
  const facts: Array<[string, string]> = [
    ['องค์กร', orgName],
    ['เลขเคส', reference],
    ['หมวดหมู่', t.category],
    ['เปิดเมื่อ', date(t.created_at, true)],
    ['อัปเดตล่าสุด', relative(t.updated_at)],
    ...(data.rating ? [['คะแนนที่คุณให้', `${starsText(data.rating)} ${data.rating}/5`] as [string, string]] : []),
  ];

  return (
    <>
      <Link href={back.href} className="back-link">
        <Icon name="back" />
        {back.label}
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
          {(replyChat || actions) && (
            <div className="customer-banner-actions">
              {replyChat && (
                <Link className="btn primary" href={chatHref(replyChat)}>
                  <Icon name="chat" />
                  ตอบกลับทีมงาน
                </Link>
              )}
              {actions}
            </div>
          )}
        </div>
        <div className="customer-banner-side">
          <CaseJourney journey={data.journey} />
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
                  <Link key={x.id} className="customer-link-row" href={chatHref(x.id)}>
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
                  ทีมงานบันทึกเคสนี้จากช่องทางอื่น ถ้าต้องการคุยเรื่องนี้ <Link href={newChatHref}>เริ่มแชทใหม่</Link> แล้วแจ้งเลขเคส {reference}
                </p>
              </div>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
