'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { useDialogs } from '@/components/ui/Dialogs';
import { FormActions, SelectField, TextArea, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { customerContractApi, ProjectReasonForm, type ProjectHandlers, type SignedContract } from '@/features/contracts';
import type { Buyer, Project } from '@/features/contracts/types';
import { baht } from '@/lib/format';
import { useInvalidate } from '@/lib/query';
import { OVERVIEW_PATH } from '../api';

/* The customer's forms on a contract and its project (pages/contracts/customer-document-ask.html, buyer-form.html,
   project-issue-form.html) and the handlers the shared <ProjectPage> calls (the old project-customer.js). */

type ContractApi = ReturnType<typeof customerContractApi>;

/** "สอบถามเกี่ยวกับเอกสารนี้" (kind ask) or "ขอแก้ไขเงื่อนไข" (kind changes): the text goes to the document's chat. */
export function DocAskForm({ kind, slug, contractId }: { kind: 'ask' | 'changes'; slug: string; contractId: string }) {
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const router = useRouter();
  const changes = kind === 'changes';
  return (
    <Form
      data-form="customer-doc-ask"
      data-kind={kind}
      onSubmit={async (values) => {
        const docApi = customerContractApi(slug, contractId);
        const result = changes ? await docApi.requestChanges(values.text ?? '') : await docApi.ask(values.text ?? '');
        closeModal(true);
        toast(changes ? 'ส่งคำขอแก้ไขแล้ว' : 'ส่งคำถามแล้ว');
        await refresh(docApi.path, OVERVIEW_PATH);
        router.push(`/customer/chats/${slug}/${result.conversation_id}`);
      }}
    >
      <TextArea id="doc-text" label={changes ? 'สิ่งที่ต้องการให้แก้' : 'คำถามถึงทีมงาน'} name="text" rows={5} max={2000} />
      <p className="tiny muted">
        {changes
          ? 'ทีมงานจะได้รับข้อความในแชทของเอกสารนี้ และส่งเวอร์ชันใหม่ให้ตรวจอีกครั้ง ระหว่างนี้ยังลงนามเวอร์ชันเดิมไม่ได้'
          : 'ข้อความจะไปที่แชทของเอกสารนี้ ทีมงานเห็นว่าอ้างถึงเอกสารฉบับไหน'}
      </p>
      <FormActions label={changes ? 'ส่งคำขอแก้ไข' : 'ส่งคำถาม'} onCancel={() => closeModal()} />
    </Form>
  );
}

/** ข้อมูลใบเสร็จ/ใบกำกับภาษี */
function BuyerForm({ buyer, onSave }: { buyer: Buyer; onSave: (b: { name: string; address: string; tax_id: string; branch: string }) => Promise<unknown> }) {
  const { closeModal } = useDialogs();
  return (
    <Form
      data-form="buyer-save"
      onSubmit={(values) => onSave({ name: values.name ?? '', address: values.address || '', tax_id: values.tax_id || '', branch: values.branch || '' })}
    >
      <TextField label="ชื่อบุคคลหรือบริษัท" name="name" defaultValue={buyer.name} max={200} />
      <TextArea id="buyer-address" label="ที่อยู่" name="address" rows={3} max={500} required={false} defaultValue={buyer.address} />
      <div className="form-grid">
        <TextField label="เลขประจำตัวผู้เสียภาษี (ถ้ามี)" name="tax_id" defaultValue={buyer.tax_id} max={20} required={false} />
        <TextField label="สำนักงาน/สาขา (ถ้ามี)" name="branch" defaultValue={buyer.branch} max={60} required={false} placeholder="เช่น สำนักงานใหญ่" />
      </div>
      <p className="tiny muted">ใช้กับใบเสร็จที่ออกหลังจากบันทึก ใบเสร็จที่ออกแล้วไม่เปลี่ยน</p>
      <FormActions label="บันทึก" onCancel={() => closeModal()} />
    </Form>
  );
}

type IssueBody = { kind: 'bug' | 'change'; milestone_id: string; subject: string; body: string };

/** แจ้งปัญหา / ขอเปลี่ยนแปลง */
function IssueForm({ project, onSave }: { project: Project; onSave: (issue: IssueBody) => Promise<unknown> }) {
  const { closeModal } = useDialogs();
  return (
    <Form
      data-form="issue-new"
      onSubmit={(values) =>
        onSave({
          kind: values.kind === 'change' ? 'change' : 'bug',
          milestone_id: values.milestone_id || '',
          subject: values.subject ?? '',
          body: values.body ?? '',
        })
      }
    >
      <fieldset className="contract-source">
        <legend>ประเภท</legend>
        <label className="check">
          <input type="radio" name="kind" value="bug" defaultChecked />
          <span>แจ้งปัญหา / Bug · ระบบทำงานไม่ถูกต้อง</span>
        </label>
        <label className="check">
          <input type="radio" name="kind" value="change" />
          <span>ขอเปลี่ยนแปลง · Requirement ใหม่ หรือนอกเหนือจาก TOR</span>
        </label>
      </fieldset>
      <SelectField label="งวดงานที่เกี่ยวข้อง" name="milestone_id" id="issue-milestone" defaultValue="">
        <option value="">ทั้งโครงการ</option>
        {project.milestones.map((m) => (
          <option key={m.id} value={m.id}>
            งวดที่ {m.seq}: {m.title}
          </option>
        ))}
      </SelectField>
      <TextField label="หัวข้อ" name="subject" max={200} placeholder="เช่น ค้นหาหนังสือด้วยชื่อผู้แต่งไม่เจอ" />
      <TextArea id="issue-body" label="รายละเอียด" name="body" rows={5} max={5000} placeholder="เกิดอะไรขึ้น ทำอะไรก่อนหน้า และควรเป็นอย่างไร" />
      <p className="tiny muted">
        ทีมงานได้รับเป็นเคสพร้อมแชท ติดตามสถานะได้ในแท็บนี้และในเคสของฉัน
        {project.coverage.state === 'active' ? ' · ตอนนี้อยู่ในระยะรับประกัน การแก้ข้อบกพร่องของงานที่ส่งมอบไม่มีค่าใช้จ่าย' : ''}
      </p>
      <FormActions label="ส่งถึงทีมงาน" onCancel={() => closeModal()} />
    </Form>
  );
}

/** The customer's handlers for <ProjectPage>: accept or send back a delivery, the buyer's details, a problem or
    change request, and asking for an MA contract. Every write refreshes the project and the overview. */
export function useCustomerProjectHandlers(slug: string, data: SignedContract): ProjectHandlers {
  const { openModal, closeModal, confirm } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const router = useRouter();
  const contractId = data.contract.id;
  return useMemo<ProjectHandlers>(() => {
    const docApi: ContractApi = customerContractApi(slug, contractId);
    const reload = () => refresh(docApi.path, OVERVIEW_PATH);
    return {
      accept: (m) =>
        confirm({
          title: 'อนุมัติรับงาน',
          message: `ยืนยันว่าตรวจงาน “${m.title}” แล้วและยอมรับงานงวดนี้${
            Number(m.amount) ? ` ระบบจะออกใบแจ้งหนี้ ${baht(m.amount)} (ก่อน VAT ถ้ามี) ให้` : ''
          } การอนุมัติย้อนกลับไม่ได้`,
          cancelLabel: 'ยังไม่อนุมัติ',
          confirmLabel: 'อนุมัติรับงาน',
          run: async () => {
            const r = await docApi.accept(m.id);
            toast(r.invoice_id ? 'อนุมัติรับงานแล้ว ใบแจ้งหนี้อยู่ในแท็บใบแจ้งหนี้/ใบเสร็จ' : 'อนุมัติรับงานแล้ว');
            await reload();
          },
        }),
      reject: (m) =>
        openModal(
          'ส่งกลับแก้ไข',
          <ProjectReasonForm
            name="remark"
            required
            max={2000}
            label={`สิ่งที่ต้องแก้ในงาน “${m.title}”`}
            hint="หมายเหตุจะส่งถึงทีมงานในแชทของโครงการ ทีมงานแก้แล้วส่งมอบรอบใหม่ให้ตรวจอีกครั้ง"
            submitLabel="ส่งกลับแก้ไข"
            onSubmit={async (remark) => {
              await docApi.reject(m.id, remark);
              closeModal(true);
              toast('ส่งกลับแก้ไขแล้ว ทีมงานได้รับหมายเหตุในแชท');
              await reload();
            }}
          />,
        ),
      editBuyer: () =>
        openModal(
          'ข้อมูลใบเสร็จ/ใบกำกับภาษี',
          <BuyerForm
            buyer={data.project.buyer}
            onSave={async (buyer) => {
              await docApi.saveBuyer(buyer);
              closeModal(true);
              toast('บันทึกข้อมูลใบเสร็จแล้ว');
              await reload();
            }}
          />,
        ),
      newIssue: () =>
        openModal(
          'แจ้งปัญหา / ขอเปลี่ยนแปลง',
          <IssueForm
            project={data.project}
            onSave={async (issue) => {
              await docApi.openIssue(issue);
              closeModal(true);
              toast('ส่งถึงทีมงานแล้ว ติดตามได้ในรายการนี้และในเคสของฉัน');
              await reload();
            }}
          />,
        ),
      requestMA: () =>
        openModal(
          'ขอต่อสัญญา MA',
          <ProjectReasonForm
            name="note"
            required={false}
            max={2000}
            label="รายละเอียดที่ต้องการ (ถ้ามี)"
            hint="คำขอจะไปที่แชทของโครงการ ทีมงานจะส่งสัญญา MA ให้ตรวจและลงนามในเมนูสัญญาและโครงการ"
            submitLabel="ส่งคำขอ"
            onSubmit={async (note) => {
              const r = await docApi.requestRenewal(note);
              closeModal(true);
              toast('ส่งคำขอต่อ MA แล้ว');
              await reload();
              router.push(`/customer/chats/${slug}/${r.conversation_id}`);
            }}
          />,
        ),
    };
  }, [slug, contractId, data, confirm, openModal, closeModal, toast, refresh, router]);
}
