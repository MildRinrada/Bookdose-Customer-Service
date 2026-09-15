"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { ErrorState, PageLoading } from "@/components/ui/display";
import { useDialogs } from "@/components/ui/Dialogs";
import { FormActions, TextField } from "@/components/ui/fields";
import { Form } from "@/components/ui/Form";
import { useToast } from "@/components/ui/Toast";
import { useApi, useInvalidate } from "@/lib/query";
import { useStaffUser, useWork } from "@/lib/session";
import {
  cancelContract,
  contractPath,
  CONTRACTS_PREFIX,
  reviseContract,
} from "./api";
import { ContractDocument } from "./components/ContractDocument";
import { ContractEditor } from "./components/ContractEditor";
import { ContractSignBox } from "./components/ContractSignBox";
import {
  ContractEventRows,
  ContractSteps,
  ContractVersionRows,
  PrintButton,
} from "./components/common";
import {
  ContractActionButton,
  type SignedContract,
} from "./components/ProjectPage";
import {
  StaffInvoiceScreen,
  StaffProjectView,
} from "./components/StaffProject";
import {
  contractKindLabels,
  contractStatusLabels,
  contractStatusTones,
} from "./labels";
import { orgProjectLinks } from "./links";
import type { ContractDetail } from "./types";

/* One document on the team's side (/contracts/<id>): what can be done now is on top, the document (or its editor)
   in the middle, and its versions, chat and audit trail on the side. Once both sides have signed it is a project
   (?tab=), and an invoice of it opens with ?invoice=<id> (&view=receipt). */

export function ContractDetailScreen({
  id,
  tab = "",
  invoice = "",
  view = "",
}: {
  id: string;
  tab?: string;
  invoice?: string;
  view?: string;
}) {
  const q = useApi<ContractDetail>(contractPath(id));
  if (q.isPending) return <PageLoading />;
  if (q.error)
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const data = q.data;
  if (data.project) {
    if (invoice)
      return (
        <StaffInvoiceScreen contractId={id} invoiceId={invoice} view={view} />
      );
    return <StaffProjectView data={data as SignedContract} tab={tab} />;
  }
  return <ContractDetailView data={data} />;
}

function ReviseForm({ contractId }: { contractId: string }) {
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <Form
      onSubmit={async (values) => {
        const result = await reviseContract(contractId, values.note || "");
        closeModal(true);
        toast(
          `เริ่มเวอร์ชัน ${result.version} แล้ว แก้ไขแล้วกดส่งให้ลูกค้าอีกครั้ง`,
        );
        await refresh(CONTRACTS_PREFIX);
      }}
    >
      <p>
        ระบบคัดลอกเวอร์ชันล่าสุดเป็นฉบับร่างเวอร์ชันใหม่ให้แก้ต่อ
        เวอร์ชันเดิมยังเก็บไว้ทั้งหมด ลายเซ็นที่มีอยู่ใช้กับเวอร์ชันใหม่ไม่ได้
        ลูกค้าต้องลงนามใหม่
      </p>
      <TextField
        label="เหตุผลที่แก้ (ลูกค้าเห็นในประวัติเอกสาร)"
        name="note"
        max={500}
        required={false}
        placeholder="เช่น เลื่อนงวดชำระตามที่ลูกค้าขอ"
      />
      <FormActions label="เริ่มเวอร์ชันใหม่" onCancel={() => closeModal()} />
    </Form>
  );
}

function ContractDetailView({ data }: { data: ContractDetail }) {
  const work = useWork();
  const user = useStaffUser();
  const toast = useToast();
  const refresh = useInvalidate();
  const { openModal, confirm } = useDialogs();
  const c = data.contract;
  const d = data.document;
  const editable = Boolean(d?.editable);
  const admin = work.role === "admin";
  const version = d?.version || c.version || "";
  const links = orgProjectLinks(c.id);

  const actions: ReactNode[] = [];
  if (!editable && ["review", "changes", "awaiting_org"].includes(c.status))
    actions.push(
      <ContractActionButton
        key="revise"
        icon="edit"
        label="แก้ไขเป็นเวอร์ชันใหม่"
        onClick={() =>
          openModal("แก้ไขเป็นเวอร์ชันใหม่", <ReviseForm contractId={c.id} />)
        }
      />,
    );
  if (!editable || c.status === "completed")
    actions.push(<PrintButton key="print" className="btn sm" />);
  if (!["completed", "cancelled"].includes(c.status))
    actions.push(
      <ContractActionButton
        key="cancel"
        icon="close"
        label="ยกเลิกเอกสาร"
        danger
        onClick={() =>
          confirm({
            title: "ยกเลิกเอกสาร",
            message:
              "ลูกค้าจะเห็นว่าเอกสารนี้ถูกยกเลิก และลงนามต่อไม่ได้ ประวัติทั้งหมดยังเก็บไว้",
            cancelLabel: "ไม่ยกเลิก",
            confirmLabel: "ยกเลิกเอกสาร",
            tone: "danger",
            run: async () => {
              await cancelContract(c.id);
              toast("ยกเลิกเอกสารแล้ว");
              await refresh(CONTRACTS_PREFIX);
            },
          })
        }
      />,
    );

  return (
    <>
      <Link href="/contracts" className="back-link no-print">
        <Icon name="back" />
        สัญญา / TOR ทั้งหมด
      </Link>
      <section
        className={`customer-banner tone-${contractStatusTones[c.status]} no-print`}
      >
        <div className="customer-banner-main">
          <span className="customer-banner-ref">
            {contractKindLabels[c.kind]} {c.reference} · เวอร์ชัน {version}
          </span>
          <h1>{c.title}</h1>
          <p>
            <strong>{contractStatusLabels[c.status]}</strong> · ผู้ว่าจ้าง{" "}
            {c.customer_name} · {c.customer_email}
          </p>
          <div className="contract-actions">{actions}</div>
        </div>
        <div className="customer-banner-side">
          <ContractSteps status={c.status} />
        </div>
      </section>
      <div className="contract-layout">
        <div className="contract-main">
          {editable ? (
            <ContractEditor key={d!.version} data={data} />
          ) : (
            <>
              <section className="card contract-view">
                <ContractDocument
                  data={data}
                  orgName={work.tenant.name}
                  filePath={links.file}
                />
              </section>
              {c.status === "awaiting_org" &&
                (admin ? (
                  <ContractSignBox
                    base={links.base}
                    side="org"
                    name={user.name}
                    kind={c.kind}
                    reference={c.reference}
                    version={version}
                    onSigned={() => refresh(CONTRACTS_PREFIX)}
                  />
                ) : (
                  <p className="notice">
                    ลูกค้าลงนามแล้ว รอผู้ดูแลองค์กรลงนามฝั่งผู้รับจ้าง
                  </p>
                ))}
            </>
          )}
        </div>
        <aside className="contract-side no-print">
          <section className="card">
            <div className="card-header">
              <h2>เวอร์ชัน</h2>
            </div>
            <ol className="contract-versions">
              <ContractVersionRows versions={data.versions} current={version} />
            </ol>
          </section>
          <section className="card">
            <div className="card-header">
              <h2>แชทของเอกสาร</h2>
            </div>
            <div className="card-body">
              {c.conversation_id ? (
                <Link className="btn" href={`/inbox/${c.conversation_id}`}>
                  <Icon name="chat" />
                  เปิดแชทกับลูกค้า
                </Link>
              ) : (
                <p className="muted">
                  เมื่อลูกค้ากด “สอบถามเกี่ยวกับเอกสารนี้” หรือขอแก้ไข
                  แชทจะมาที่กล่องข้อความและลิงก์ไว้ที่นี่
                </p>
              )}
            </div>
          </section>
          <section className="card">
            <div className="card-header">
              <div>
                <h2>Audit trail</h2>
                <p>ทุกขั้นตอน พร้อมเวลาและ IP สำหรับกรณีข้อพิพาท</p>
              </div>
            </div>
            <ol className="contract-events">
              <ContractEventRows events={data.events} withIp />
            </ol>
          </section>
        </aside>
      </div>
    </>
  );
}
