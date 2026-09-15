"use client";

import { useCallback } from "react";
import { Icon } from "@/components/Icon";
import { useDialogs } from "@/components/ui/Dialogs";
import { FormActions, TextField } from "@/components/ui/fields";
import { Form } from "@/components/ui/Form";
import { useToast } from "@/components/ui/Toast";
import {
  RichTextField,
  RichToolbar,
  useRichEditor,
} from "@/features/rich/RichEditor";
import { plainText, relative } from "@/lib/format";
import { useInvalidate } from "@/lib/query";
import { PLATFORM_TEMPLATES_PATH, saveTemplate, TEMPLATES_PATH } from "../api";
import { contractKindLabels } from "../labels";
import type { ContractTemplate } from "../types";

/* Contract and TOR templates: the form (pages/contracts/contract-template-form.html) for the organization's own
   templates and for the platform's standard ones, and one row of a template list. */

const PLACEHOLDERS = [
  "customer_name",
  "customer_email",
  "organization",
  "date",
  "number",
  "title",
];

export function ContractTemplateForm({
  template,
  scope = "org",
}: {
  template?: ContractTemplate | null;
  scope?: "org" | "platform";
}) {
  const editor = useRichEditor();
  const toast = useToast();
  const refresh = useInvalidate();
  const { closeModal } = useDialogs();
  const t = template ?? null;
  return (
    <Form
      className="article-editor"
      onSubmit={async (values) => {
        await saveTemplate(scope, t?.id ?? null, {
          title: values.title,
          kind: values.kind,
          body: values.body,
        });
        closeModal(true);
        toast("บันทึกแม่แบบแล้ว");
        await refresh(TEMPLATES_PATH, PLATFORM_TEMPLATES_PATH);
      }}
    >
      <div className="form-grid">
        <TextField
          label="ชื่อแม่แบบ"
          name="title"
          defaultValue={t?.title ?? ""}
          max={200}
        />
        <div className="field">
          <label htmlFor="template-kind">ชนิดเอกสาร</label>
          <select
            id="template-kind"
            name="kind"
            defaultValue={t?.kind ?? "contract"}
          >
            {Object.entries(contractKindLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field editor-field">
        <div className="editor-head">
          <label htmlFor="template-body">เนื้อหาแม่แบบ</label>
        </div>
        <RichToolbar
          editor={editor}
          tools={[
            "bold",
            "italic",
            "|",
            "h1",
            "h2",
            "normal",
            "|",
            "bullet",
            "number",
            "link",
          ]}
          label="จัดรูปแบบเอกสาร"
          titles={{ link: "ลิงก์" }}
        />
        <RichTextField
          editor={editor}
          id="template-body"
          name="body"
          defaultValue={t?.body ?? ""}
          maxLength={50000}
          label="เนื้อหาแม่แบบ"
          placeholder="เขียนข้อตกลงมาตรฐาน ใส่คำแทนค่าได้"
          className="article-content editor-input"
        />
        <small className="muted">
          คำที่แทนค่าได้:{" "}
          <code>{PLACEHOLDERS.map((p) => `{${p}}`).join(" ")}</code>{" "}
          ระบบใส่ข้อมูลจริงให้ตอนสร้างเอกสาร
        </small>
      </div>
      <FormActions label="บันทึกแม่แบบ" onCancel={() => closeModal()} />
    </Form>
  );
}

/** Opens the template form in the wide modal ("แก้ไขแม่แบบ" / "สร้างแม่แบบใหม่"). */
export function useContractTemplateForm() {
  const { openModal } = useDialogs();
  return useCallback(
    (
      template?: ContractTemplate | null,
      { scope = "org" }: { scope?: "org" | "platform" } = {},
    ) =>
      openModal(
        template ? "แก้ไขแม่แบบ" : "สร้างแม่แบบใหม่",
        <ContractTemplateForm template={template} scope={scope} />,
        { wide: true },
      ),
    [openModal],
  );
}

/** One li.contract-template (pages/contracts/contract-template-row.html). The organization's own and the platform
    console's rows have แก้ไข / ลบ; a standard template seen by an organization has ดูแม่แบบ. */
export function ContractTemplateRow({
  template,
  editable,
  onEdit,
  onDelete,
  onView,
}: {
  template: ContractTemplate;
  /** Own (organization) or platform console: edit and delete; otherwise view only. */
  editable: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onView?: () => void;
}) {
  return (
    <li className="contract-template">
      <div className="grow">
        <strong>{template.title}</strong>
        <span className="muted">
          {contractKindLabels[template.kind]} · อัปเดต{" "}
          {relative(template.updated_at)} · {template.author}
        </span>
        <span className="tiny muted">
          {plainText(template.body).slice(0, 140)}
        </span>
      </div>
      {editable ? (
        <>
          <button type="button" className="btn sm" onClick={onEdit}>
            <Icon name="edit" />
            แก้ไข
          </button>
          <button type="button" className="btn sm subtle" onClick={onDelete}>
            ลบ
          </button>
        </>
      ) : (
        <button type="button" className="btn sm subtle" onClick={onView}>
          <Icon name="eye" />
          ดูแม่แบบ
        </button>
      )}
    </li>
  );
}
