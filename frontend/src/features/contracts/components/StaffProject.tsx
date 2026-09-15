"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { ErrorState, PageLoading } from "@/components/ui/display";
import { useDialogs } from "@/components/ui/Dialogs";
import { FormActions } from "@/components/ui/fields";
import { FileInput, filesOf } from "@/components/ui/FileInput";
import { Form } from "@/components/ui/Form";
import { useToast } from "@/components/ui/Toast";
import { readFile } from "@/lib/files";
import { baht } from "@/lib/format";
import { useApi, useInvalidate } from "@/lib/query";
import { useWork } from "@/lib/session";
import {
  confirmPayment,
  CONTRACTS_PREFIX,
  deliverMilestone,
  invoicePath,
  issueInvoice,
  rejectSlip,
  setMilestoneProgress,
  startMilestone,
  voidInvoice,
} from "../api";
import { orgProjectLinks, type ProjectLinks } from "../links";
import type { InvoiceView, ProjectMilestone } from "../types";
import { useAct } from "./common";
import { useOpenContractNew } from "./ContractNewForm";
import { InvoicePage, type InvoiceHandlers } from "./InvoicePage";
import {
  ContractActionButton,
  ContractActionLink,
  ProjectPage,
  type ProjectHandlers,
  type SignedContract,
} from "./ProjectPage";
import { ProjectReasonForm } from "./ProjectReasonForm";

/* The team's side of a signed project: start a milestone and report its progress, deliver its work for inspection,
   bill milestones, confirm or reject payment slips, void an invoice and draft the MA contract the customer asked
   for (the old project-staff.js). */

function DeliverForm({
  m,
  round,
  onDone,
}: {
  m: ProjectMilestone;
  round: number;
  onDone: (
    form: HTMLFormElement,
    values: Record<string, string>,
  ) => Promise<unknown>;
}) {
  const { closeModal } = useDialogs();
  const [names, setNames] = useState("");
  return (
    <Form onSubmit={(values, form) => onDone(form, values)}>
      <p>
        <strong>{m.title}</strong> · รอบที่ {round}
      </p>
      <div className="field">
        <label htmlFor="deliver-note">รายละเอียดงานที่ส่งมอบ</label>
        <textarea
          id="deliver-note"
          name="note"
          rows={4}
          maxLength={3000}
          placeholder="สิ่งที่ส่งมอบในรอบนี้ และสิ่งที่แก้ตามหมายเหตุของลูกค้า"
        />
      </div>
      <div className="field">
        <label htmlFor="deliver-links">
          ลิงก์พรีวิวหรือไฟล์งาน (บรรทัดละ 1 ลิงก์)
        </label>
        <textarea
          id="deliver-links"
          name="links"
          rows={3}
          placeholder="https://preview.example.com"
        />
      </div>
      <div className="field">
        <FileInput
          id="deliver-files"
          name="files"
          className="attach-input"
          accept=".pdf,.png,.jpg,.jpeg"
          onFiles={(files) => setNames(files.map((f) => f.name).join(", "))}
        />
        <label className="btn sm subtle" htmlFor="deliver-files">
          <Icon name="paperclip" />
          แนบไฟล์ PDF / รูปภาพ
        </label>{" "}
        <span className="tiny muted">
          {names || "ไม่เกิน 5 ไฟล์ ไฟล์ละ 5 MB"}
        </span>
      </div>
      <p className="tiny muted">
        ลูกค้าได้รับแจ้งให้ตรวจรับ แล้วกดอนุมัติรับงาน หรือส่งกลับแก้ไข
        {Number(m.amount)
          ? ` · เมื่ออนุมัติ ระบบออกใบแจ้งหนี้ ${baht(m.amount)} (ก่อน VAT ถ้ามี) ให้อัตโนมัติ`
          : ""}
      </p>
      <FormActions label="ส่งมอบให้ลูกค้า" onCancel={() => closeModal()} />
    </Form>
  );
}

/** The org handlers for <ProjectPage> (start, progress, deliver, invoice, create the MA contract). */
export function useStaffProjectHandlers(
  data: SignedContract,
  links: ProjectLinks,
): ProjectHandlers {
  const router = useRouter();
  const toast = useToast();
  const refresh = useInvalidate();
  const act = useAct();
  const { openModal, closeModal, confirm } = useDialogs();
  const openContractNew = useOpenContractNew();
  const id = data.contract.id;
  return useMemo<ProjectHandlers>(
    () => ({
      start: (m) =>
        void act(async () => {
          await startMilestone(id, m.id);
          toast("เริ่มงานงวดนี้แล้ว");
          await refresh(CONTRACTS_PREFIX);
        })(),
      saveProgress: async (m, progress) => {
        await setMilestoneProgress(id, m.id, progress);
        toast("บันทึกความคืบหน้าแล้ว");
        await refresh(CONTRACTS_PREFIX);
      },
      deliver: (m) => {
        const round =
          data.project.deliveries.filter((d) => d.milestone_id === m.id)
            .length + 1;
        openModal(
          "ส่งมอบให้ตรวจรับ",
          <DeliverForm
            m={m}
            round={round}
            onDone={async (form, values) => {
              // The server checks each file's type, content and size (at most 5 files).
              const files = await Promise.all(
                filesOf(form, "files").map(readFile),
              );
              const urls = String(values.links || "")
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean);
              await deliverMilestone(id, m.id, {
                note: values.note || "",
                links: urls,
                files,
              });
              closeModal(true);
              toast("ส่งมอบแล้ว ลูกค้าได้รับแจ้งให้ตรวจรับ");
              await refresh(CONTRACTS_PREFIX);
            }}
          />,
        );
      },
      invoice: (m) =>
        confirm({
          title: "ออกใบแจ้งหนี้",
          message: `ออกใบแจ้งหนี้งวด “${m.title}” ยอด ${baht(m.amount)} (ก่อน VAT ถ้ามี) ลูกค้าจะเห็นช่องทางชำระเงินและแนบสลิปได้ทันที`,
          cancelLabel: "ยังไม่ออก",
          confirmLabel: "ออกใบแจ้งหนี้",
          run: async () => {
            const r = await issueInvoice(id, m.id);
            toast("ออกใบแจ้งหนี้แล้ว");
            void refresh(CONTRACTS_PREFIX);
            router.push(links.invoice(r.id));
          },
        }),
      createMA: () => void openContractNew({ renews: data.contract }),
    }),
    [
      act,
      closeModal,
      confirm,
      data,
      id,
      links,
      openContractNew,
      openModal,
      refresh,
      router,
      toast,
    ],
  );
}

/** The team's project page: banner actions (สร้างสัญญา MA, แชทกับลูกค้า) and the org handlers. */
export function StaffProjectView({
  data,
  tab,
}: {
  data: SignedContract;
  tab: string;
}) {
  const work = useWork();
  const c = data.contract;
  const project = data.project;
  const links = useMemo(() => orgProjectLinks(c.id), [c.id]);
  const handlers = useStaffProjectHandlers(data, links);
  const canMA = Boolean(project.delivered_at && !project.renews);
  const actions =
    canMA || c.conversation_id ? (
      <>
        {canMA && (
          <ContractActionButton
            icon="plus"
            label="สร้างสัญญา MA"
            onClick={() => handlers.createMA?.()}
          />
        )}
        {c.conversation_id && (
          <ContractActionLink
            href={`/inbox/${c.conversation_id}`}
            icon="chat"
            label="แชทกับลูกค้า"
          />
        )}
      </>
    ) : null;
  return (
    <ProjectPage
      data={data}
      tab={tab}
      back="/contracts"
      backLabel="สัญญา / TOR ทั้งหมด"
      org={work.tenant.name}
      actions={actions}
      links={links}
      handlers={handlers}
    />
  );
}

/** The org handlers for <InvoicePage> (confirm the payment, reject the slip, void the invoice). */
export function useStaffInvoiceHandlers(
  data: InvoiceView,
  links: ProjectLinks,
): InvoiceHandlers {
  const router = useRouter();
  const toast = useToast();
  const refresh = useInvalidate();
  const { openModal, closeModal, confirm } = useDialogs();
  const inv = data.invoice;
  const contractId = data.contract.id;
  return useMemo<InvoiceHandlers>(
    () => ({
      confirm: () =>
        confirm({
          title: "ยืนยันรับชำระเงิน",
          message: `ยืนยันว่าได้รับ ${baht(inv.total)} สำหรับ ${inv.reference} แล้ว ระบบจะออกใบเสร็จเลขถัดไปให้ลูกค้าดาวน์โหลด และแก้ไขภายหลังไม่ได้`,
          cancelLabel: "ยังไม่ยืนยัน",
          confirmLabel: "ยืนยันรับชำระ",
          run: async () => {
            const r = await confirmPayment(contractId, inv.id);
            toast(`ออกใบเสร็จ ${r.receipt} แล้ว`);
            await refresh(CONTRACTS_PREFIX);
          },
        }),
      reject: () =>
        openModal(
          "สลิปไม่ถูกต้อง",
          <ProjectReasonForm
            name="reason"
            required
            max={500}
            label="เหตุผลที่ลูกค้าจะเห็น"
            hint="ใบแจ้งหนี้กลับเป็นรอชำระ ลูกค้าแนบสลิปใหม่ได้"
            submitLabel="ส่งกลับให้ลูกค้า"
            onSubmit={async (reason) => {
              await rejectSlip(contractId, inv.id, reason);
              closeModal(true);
              toast("ส่งกลับให้ลูกค้าแนบสลิปใหม่แล้ว");
              await refresh(CONTRACTS_PREFIX);
            }}
          />,
        ),
      void: () =>
        openModal(
          "ยกเลิกใบแจ้งหนี้",
          <ProjectReasonForm
            name="reason"
            required
            max={500}
            label="เหตุผลที่ยกเลิก"
            hint="ลูกค้าจะไม่เห็นใบแจ้งหนี้นี้อีก ออกใบใหม่ของงวดเดิมได้"
            submitLabel="ยกเลิกใบแจ้งหนี้"
            onSubmit={async (reason) => {
              await voidInvoice(contractId, inv.id, reason);
              closeModal(true);
              toast("ยกเลิกใบแจ้งหนี้แล้ว");
              void refresh(CONTRACTS_PREFIX);
              router.push(links.project("billing"));
            }}
          />,
        ),
    }),
    [
      closeModal,
      confirm,
      contractId,
      inv,
      links,
      openModal,
      refresh,
      router,
      toast,
    ],
  );
}

function StaffInvoiceView({
  data,
  view,
  links,
}: {
  data: InvoiceView;
  view: string;
  links: ProjectLinks;
}) {
  const staff = useStaffInvoiceHandlers(data, links);
  return <InvoicePage data={data} view={view} links={links} staff={staff} />;
}

/** /contracts/<id>?tab=billing&invoice=<id>[&view=receipt] */
export function StaffInvoiceScreen({
  contractId,
  invoiceId,
  view,
}: {
  contractId: string;
  invoiceId: string;
  view: string;
}) {
  const q = useApi<InvoiceView>(invoicePath(contractId, invoiceId));
  const links = useMemo(() => orgProjectLinks(contractId), [contractId]);
  if (q.isPending) return <PageLoading />;
  if (q.error)
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return <StaffInvoiceView data={q.data} view={view} links={links} />;
}
