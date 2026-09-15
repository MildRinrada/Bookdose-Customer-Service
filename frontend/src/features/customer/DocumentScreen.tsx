'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { useDialogs } from '@/components/ui/Dialogs';
import {
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
  type ContractDetail,
  type SignedContract,
} from '@/features/contracts';
import { useCustomer } from '@/lib/customer-session';
import { useApi, useInvalidate } from '@/lib/query';
import { OVERVIEW_PATH } from './api';
import { DocAskForm, useCustomerProjectHandlers } from './components/ProjectForms';
import { useOrgs, useOverview } from './hooks';

/* One document for the customer: read it, ask about it or ask for changes in its chat, sign it, download or print
   (pages/contracts/customer-document.html). Once signed it is a project: the shared project page with the
   customer's handlers (the old project-customer.js), on ?tab=. */

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
  const { openModal } = useDialogs();
  const refresh = useInvalidate();
  const doc = data.contract;
  const links = customerProjectLinks(slug, doc.id);
  const version = data.document?.version || doc.version || '';
  const tone = contractStatusTones[doc.status];
  const ask = (kind: 'ask' | 'changes') =>
    openModal(
      kind === 'changes' ? 'ขอแก้ไขเงื่อนไข' : 'สอบถามเกี่ยวกับเอกสารนี้',
      <DocAskForm kind={kind} slug={slug} contractId={doc.id} />,
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
            {doc.status === 'review' && (
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
          {doc.status === 'review' && (
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
