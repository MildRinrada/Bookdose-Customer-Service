'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { useDialogs } from '@/components/ui/Dialogs';
import {
  ApprovalSteps,
  approvalHeadline,
  ContractActionButton,
  ContractActionLink,
  ContractDocument,
  ContractEventRows,
  ContractSignBox,
  ContractSteps,
  ContractVersionRows,
  contractKindLabels,
  contractStatusLabels,
  contractStatusTones,
  customerContractApi,
  customerProjectLinks,
  PrintButton,
  ProjectPage,
  ReviewButtons,
  type ContractDetail,
  type ReviewDecision,
  type SignedContract,
} from '@/features/contracts';
import { useToast } from '@/components/ui/Toast';
import { APPROVALS_PATH } from '@/features/team/api';
import { useCustomer } from '@/lib/customer-session';
import { useApi, useInvalidate } from '@/lib/query';
import { OVERVIEW_PATH } from './api';
import { DocAskForm, ProjectFlowForm, ReviewForm, useCustomerProjectHandlers } from './components/ProjectForms';
import { useOrgs, useOverview } from './hooks';

/* One document for the customer: read it, ask about it or ask for changes in its chat, review it on their step of
   the approval flow, sign it once every reviewer passed it, download or print (pages/contracts/customer-document.html).
   Once signed it is a project: the shared project page with the customer's handlers (the old project-customer.js),
   on ?tab=. */

export function DocumentScreen({ slug, id, tab = '' }: { slug: string; id: string; tab?: string }) {
  const path = customerContractApi(slug, id).path;
  const query = useApi<ContractDetail>(path);
  const orgs = useOrgs();
  const overview = useOverview();
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <PageLoading />;
  const data = query.data;
  const orgName = orgs.find((o) => o.slug === slug)?.name || overview.contracts.find((x) => x.id === data.contract.id)?.org_name || '';
  if (data.project) return <CustomerProject data={data as SignedContract} slug={slug} tab={tab} orgName={orgName} />;
  return <CustomerDocument data={data} slug={slug} orgName={orgName} />;
}

function CustomerProject({ data, slug, tab, orgName }: { data: SignedContract; slug: string; tab: string; orgName: string }) {
  const { openModal } = useDialogs();
  const handlers = useCustomerProjectHandlers(slug, data);
  const links = customerProjectLinks(slug, data.contract.id);
  const chat = data.contract.conversation_id;
  return (
    <ProjectPage
      data={data}
      tab={tab}
      back="/customer/documents"
      backLabel="สัญญาและโครงการทั้งหมด"
      org={orgName}
      links={links}
      handlers={handlers}
      actions={
        <>
          <ContractActionButton
            icon="chat"
            label="สอบถามเกี่ยวกับโครงการนี้"
            onClick={() => openModal('สอบถามเกี่ยวกับเอกสารนี้', <DocAskForm kind="ask" slug={slug} contractId={data.contract.id} />)}
          />
          {chat && <ContractActionLink href={`/customer/chats/${slug}/${chat}`} icon="chat" label="เปิดแชทของโครงการ" />}
        </>
      }
    />
  );
}

function CustomerDocument({ data, slug, orgName }: { data: ContractDetail; slug: string; orgName: string }) {
  const me = useCustomer();
  const { openModal, closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const doc = data.contract;
  const links = customerProjectLinks(slug, doc.id);
  const version = data.document?.version || doc.version || '';
  const tone = contractStatusTones[doc.status];
  // Signing and asking for changes are final decisions; a team member's role may not allow them.
  const decide = !data.access || data.access.can.includes('decide');
  const owner = !data.access || data.access.can.includes('team');
  // The version's approval flow: reviewers in order before anyone may sign (none: sign at once as before).
  const run = doc.status === 'review' ? (data.approval?.contract ?? null) : null;
  const signable = decide && (!run || run.ready);
  const ask = (kind: 'ask' | 'changes') =>
    openModal(
      kind === 'changes' ? 'ขอแก้ไขเงื่อนไข' : 'สอบถามเกี่ยวกับเอกสารนี้',
      <DocAskForm kind={kind} slug={slug} contractId={doc.id} />,
    );
  const review = (decision: ReviewDecision) =>
    openModal(
      decision === 'approved' ? 'ผ่านการตรวจ' : 'ส่งกลับแก้ไข',
      <ReviewForm
        decision={decision}
        what={`เอกสาร ${doc.reference} เวอร์ชัน ${version}`}
        onSend={async (remark) => {
          await customerContractApi(slug, doc.id).reviewContract(decision, remark);
          closeModal(true);
          toast(decision === 'approved' ? 'บันทึกผลการตรวจแล้ว' : 'ส่งกลับแก้ไขแล้ว ทีมงานได้รับหมายเหตุในแชท');
          await refresh(links.base, OVERVIEW_PATH, APPROVALS_PATH);
        }}
      />,
    );
  return (
    <>
      <Link href="/customer/documents" className="back-link no-print">
        <Icon name="back" />
        เอกสารทั้งหมดของฉัน
      </Link>
      <section className={`customer-banner tone-${tone} no-print`}>
        <div className="customer-banner-main">
          <span className="customer-banner-ref">
            {contractKindLabels[doc.kind]} {doc.reference} · เวอร์ชัน {version} · {orgName}
          </span>
          <h1>{doc.title}</h1>
          <p>
            <strong>{contractStatusLabels[doc.status]}</strong>
          </p>
          <div className="contract-actions">
            <button type="button" className="btn sm" onClick={() => ask('ask')}>
              <Icon name="chat" />
              สอบถามเกี่ยวกับเอกสารนี้
            </button>
            {doc.status === 'review' && decide && (
              <button type="button" className="btn sm" onClick={() => ask('changes')}>
                <Icon name="edit" />
                ขอแก้ไขเงื่อนไข
              </button>
            )}
            {doc.conversation_id && (
              <Link className="btn sm subtle" href={`/customer/chats/${slug}/${doc.conversation_id}`}>
                <Icon name="chat" />
                เปิดแชทของเอกสาร
              </Link>
            )}
            {owner && (
              <button
                type="button"
                className="btn sm subtle"
                onClick={() => openModal('ขั้นตอนอนุมัติของเอกสารนี้', <ProjectFlowForm slug={slug} contractId={doc.id} />, { wide: true })}
              >
                <Icon name="listOrdered" />
                ขั้นตอนอนุมัติ
              </button>
            )}
            <PrintButton />
          </div>
        </div>
        <div className="customer-banner-side">
          <ContractSteps status={doc.status} />
        </div>
      </section>
      <div className="contract-layout">
        <div className="contract-main">
          <section className="card contract-view">
            <ContractDocument data={data} orgName={orgName} filePath={links.file} />
          </section>
        </div>
        <aside className="contract-side no-print">
          {run && (
            <section className="card approval-card">
              <div className="card-header">
                <div>
                  <h2>ขั้นตอนอนุมัติ</h2>
                  <p>{approvalHeadline(run, 'customer')}</p>
                </div>
              </div>
              <div className="card-body">
                <ApprovalSteps run={run} finalLabel="ลงนาม" />
                {run.my_turn && (
                  <>
                    <p className="tiny muted">อ่านเอกสารและไฟล์แนบ แล้วเลือกผ่านการตรวจ หรือส่งกลับแก้ไขพร้อมหมายเหตุ</p>
                    <ReviewButtons onReview={review} />
                  </>
                )}
              </div>
            </section>
          )}
          {doc.status === 'review' && !decide && !run?.my_turn && (
            <p className="notice">เอกสารนี้รอผู้มีสิทธิ์ลงนามของ{data.access?.owner_name ? ` ${data.access.owner_name}` : 'ลูกค้า'} ตรวจและลงนาม</p>
          )}
          {doc.status === 'review' && decide && !signable && (
            <p className="notice">ลงนามได้เมื่อผู้ตรวจทุกขั้นผ่านการตรวจแล้ว ระหว่างนี้ยังขอแก้ไขเงื่อนไขได้</p>
          )}
          {doc.status === 'review' && signable && (
            <ContractSignBox
              base={links.base}
              side="customer"
              name={me.name}
              kind={doc.kind}
              reference={doc.reference}
              version={version}
              onSigned={() => refresh(links.base, OVERVIEW_PATH)}
            />
          )}
          {doc.status === 'changes' && <p className="notice">ทีมงานกำลังแก้ไขตามคำขอ เวอร์ชันใหม่จะแสดงที่นี่เมื่อพร้อมให้ตรวจอีกครั้ง</p>}
          {doc.status === 'awaiting_org' && <p className="notice">คุณลงนามแล้ว รอ {orgName} ลงนามฝั่งผู้รับจ้าง</p>}
          <section className="card">
            <div className="card-header">
              <h2>เวอร์ชัน</h2>
            </div>
            <ol className="contract-versions">
              <ContractVersionRows versions={data.versions} current={data.document?.version} />
            </ol>
          </section>
          <section className="card">
            <div className="card-header">
              <h2>ความเคลื่อนไหว</h2>
            </div>
            <ol className="contract-events">
              <ContractEventRows events={data.events} withIp={false} />
            </ol>
          </section>
        </aside>
      </div>
    </>
  );
}
