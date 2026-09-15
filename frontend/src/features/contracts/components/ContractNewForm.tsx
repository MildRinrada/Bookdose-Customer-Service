"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useDialogs } from "@/components/ui/Dialogs";
import {
  FormActions,
  RequiredStar,
  SelectField,
  TextField,
  useFieldValidation,
} from "@/components/ui/fields";
import { filesOf } from "@/components/ui/FileInput";
import { Form } from "@/components/ui/Form";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api/client";
import { readFile } from "@/lib/files";
import { useInvalidate } from "@/lib/query";
import { useWork } from "@/lib/session";
import {
  CONTRACTS_PREFIX,
  createContract,
  importDocument,
  TEMPLATES_PATH,
  type NewContractBody,
} from "../api";
import { contractKindLabels } from "../labels";
import type {
  ContractCustomer,
  ContractInfo,
  ContractKind,
  ContractTemplate,
  ContractTemplates,
} from "../types";

/* สร้างเอกสาร (pages/contracts/contract-new.html): from a template, an imported Word/text file, or blank. With
   `renews` (a signed project), its MA contract: that customer only, and the MA template chosen. */

export type RenewsContract = Pick<
  ContractInfo,
  "id" | "account_id" | "reference" | "title"
>;

export function ContractNewForm({
  customers,
  templates,
  renews = null,
}: {
  customers: ContractCustomer[];
  templates: ContractTemplates;
  renews?: RenewsContract | null;
}) {
  const work = useWork();
  const router = useRouter();
  const toast = useToast();
  const refresh = useInvalidate();
  const { closeModal } = useDialogs();
  const customerCheck = useFieldValidation();
  const [importName, setImportName] = useState("");
  const people = renews
    ? customers.filter((a) => a.id === renews.account_id)
    : customers;
  const own = renews
    ? templates.organization.find((t) => /MA/.test(t.title))
    : undefined;
  const standard =
    renews && !own
      ? templates.platform.find((t) => /MA/.test(t.title))
      : undefined;
  const ma = own
    ? `org:${own.id}`
    : standard
      ? `platform:${standard.id}`
      : undefined;
  const group = (
    label: string,
    items: ContractTemplate[],
    scope: "org" | "platform",
  ) =>
    items.length ? (
      <optgroup label={label}>
        {items.map((t) => (
          <option key={t.id} value={`${scope}:${t.id}`}>
            {contractKindLabels[t.kind]} · {t.title}
          </option>
        ))}
      </optgroup>
    ) : null;

  return (
    <Form
      className="contract-new"
      onSubmit={async (values, form) => {
        const body: NewContractBody = {
          kind: values.kind as ContractKind,
          title: values.title,
          account_id: values.account_id,
          ...(values.renews_id ? { renews_id: values.renews_id } : {}),
        };
        if (values.source === "template") {
          if (!values.template) throw new Error("กรุณาเลือกแม่แบบ");
          const [scope, templateId] = values.template.split(":");
          Object.assign(body, {
            template_scope: scope,
            template_id: templateId,
          });
        } else if (values.source === "import") {
          const file = filesOf(form, "import")[0];
          if (!file) throw new Error("กรุณาเลือกไฟล์ Word, .txt หรือ .md");
          body.body = (await importDocument(await readFile(file))).body;
        }
        const result = await createContract(body);
        closeModal(true);
        toast("สร้างฉบับร่างแล้ว");
        void refresh(CONTRACTS_PREFIX);
        router.push(`/contracts/${result.id}`);
      }}
    >
      {renews && (
        <>
          <input type="hidden" name="renews_id" value={renews.id} />
          <p className="notice">
            ต่อการดูแลของ {renews.reference} · {renews.title} ·
            ระยะบริการเริ่มต่อจากวันสิ้นสุดความคุ้มครองเดิม
          </p>
        </>
      )}
      <div className="form-grid">
        <SelectField id="contract-kind" label="ชนิดเอกสาร" name="kind">
          <option value="contract">สัญญา</option>
          <option value="tor">TOR (ขอบเขตงาน)</option>
        </SelectField>
        <TextField
          label="ชื่อเอกสาร"
          name="title"
          max={200}
          defaultValue={
            renews ? `สัญญาบำรุงรักษา (MA) · ${renews.title}`.slice(0, 200) : ""
          }
          placeholder="เช่น จ้างพัฒนาระบบห้องสมุดดิจิทัล"
        />
      </div>
      <div className="field">
        <label htmlFor="contract-customer">
          ลูกค้า (ผู้ว่าจ้าง)
          <RequiredStar />
        </label>
        <select
          id="contract-customer"
          name="account_id"
          required
          defaultValue={renews ? renews.account_id : ""}
          {...customerCheck.bind}
        >
          {!renews && <option value="">เลือกลูกค้า</option>}
          {people.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.email}
            </option>
          ))}
        </select>
        {customerCheck.errorNode}
        {people.length === 0 && (
          <p className="notice">
            ยังไม่มีลูกค้าที่ติดต่อองค์กรนี้
            ให้ลูกค้าสมัครสมาชิกแล้วเพิ่มองค์กรด้วยรหัส{" "}
            <strong>{work.tenant.slug}</strong> ก่อน
          </p>
        )}
      </div>
      <fieldset className="contract-source">
        <legend>เริ่มจาก</legend>
        <label className="check">
          <input type="radio" name="source" value="template" defaultChecked />
          <span>แม่แบบ</span>
        </label>
        <select name="template" aria-label="แม่แบบ" defaultValue={ma}>
          {group("แม่แบบขององค์กร", templates.organization, "org")}
          {group("แม่แบบมาตรฐานจาก Bookdose", templates.platform, "platform")}
        </select>
        <label className="check">
          <input type="radio" name="source" value="import" />
          <span>นำเข้าไฟล์ Word (.docx), .txt หรือ .md แล้วแก้ในระบบ</span>
        </label>
        <input
          type="file"
          name="import"
          accept=".docx,.txt,.md"
          aria-label="ไฟล์ที่จะนำเข้า"
          onChange={(e) =>
            setImportName(
              [...(e.currentTarget.files ?? [])]
                .map((f) => `${f.name} (${Math.ceil(f.size / 1024)} KB)`)
                .join(", ") || "ยังไม่ได้เลือกไฟล์",
            )
          }
        />
        {/* Not the shared FileInput: its general file check refuses .docx, the point of importing. */}
        <span className="file-selection" aria-live="polite">
          {importName}
        </span>
        <label className="check">
          <input type="radio" name="source" value="blank" />
          <span>เอกสารเปล่า</span>
        </label>
      </fieldset>
      <p className="tiny muted">
        ไฟล์ PDF ที่ทำไว้แล้ว แนบเป็นเอกสารประกอบได้ในหน้าฉบับร่าง
      </p>
      <FormActions label="สร้างฉบับร่าง" onCancel={() => closeModal()} />
    </Form>
  );
}

/** The old openContractNew({ renews }): loads the customers and templates, then opens the form in the modal. A
    failure is said in the toast. */
export function useOpenContractNew() {
  const { openModal } = useDialogs();
  const toast = useToast();
  return useCallback(
    async ({ renews = null }: { renews?: RenewsContract | null } = {}) => {
      try {
        const [customers, templates] = await Promise.all([
          api<{ customers: ContractCustomer[] }>("/api/contract-customers"),
          api<ContractTemplates>(TEMPLATES_PATH),
        ]);
        openModal(
          renews ? "สร้างสัญญา MA" : "สร้างสัญญา / TOR",
          <ContractNewForm
            customers={customers.customers}
            templates={templates}
            renews={renews}
          />,
        );
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), true);
      }
    },
    [openModal, toast],
  );
}
