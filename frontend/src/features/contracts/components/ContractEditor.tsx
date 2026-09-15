"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useDialogs } from "@/components/ui/Dialogs";
import { TextField, useFieldValidation } from "@/components/ui/fields";
import { FileInput } from "@/components/ui/FileInput";
import { Form } from "@/components/ui/Form";
import { useToast } from "@/components/ui/Toast";
import {
  RichTextField,
  RichToolbar,
  useRichEditor,
} from "@/features/rich/RichEditor";
import { readFile } from "@/lib/files";
import { useInvalidate } from "@/lib/query";
import { useWork } from "@/lib/session";
import {
  addContractFiles,
  CONTRACTS_PREFIX,
  removeContractFile,
  saveDraft,
  sendContract,
  type DraftBody,
} from "../api";
import { milestoneKindLabels } from "../labels";
import { orgProjectLinks } from "../links";
import type { ContractDetail, DocumentMilestone } from "../types";
import { ContractDocument } from "./ContractDocument";
import { ContractFileItem, useAct } from "./common";

/* The draft being written (pages/contracts/contract-editor.html): title, text, milestones, warranty and support
   terms, attached files; save it as often as needed, preview it, then send it to the customer. The fields are not
   controlled, so what is typed stays when the page refreshes after saving. */

type Row = { key: number; m: DocumentMilestone };

const blankMilestone: DocumentMilestone = {
  kind: "payment",
  title: "",
  due_date: "",
  amount: "",
};

function MilestoneRow({
  m,
  onRemove,
}: {
  m: DocumentMilestone;
  onRemove: () => void;
}) {
  // The message goes at the end of the row, where the old form put it.
  const titleCheck = useFieldValidation();
  return (
    <div className="milestone-row">
      <select name="m_kind" aria-label="ชนิดงวด" defaultValue={m.kind}>
        {Object.entries(milestoneKindLabels).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      <input
        name="m_title"
        defaultValue={m.title}
        maxLength={200}
        placeholder="เช่น ส่งมอบระบบงวดที่ 1"
        aria-label="รายการ"
        required
        {...titleCheck.bind}
      />
      <input
        name="m_due"
        type="date"
        defaultValue={m.due_date}
        aria-label="วันครบกำหนด"
      />
      <input
        name="m_amount"
        defaultValue={m.amount}
        inputMode="decimal"
        placeholder="จำนวนเงิน (บาท)"
        aria-label="จำนวนเงิน"
      />
      <button
        type="button"
        className="icon-btn"
        aria-label="ลบงวดนี้"
        title="ลบงวดนี้"
        onClick={onRemove}
      >
        <Icon name="trash" />
      </button>
      {titleCheck.errorNode}
    </div>
  );
}

const fieldValue = (form: HTMLFormElement, name: string) =>
  (
    form.elements.namedItem(name) as
      HTMLInputElement | HTMLTextAreaElement | null
  )?.value ?? "";

function editorPayload(form: HTMLFormElement): DraftBody {
  return {
    title: fieldValue(form, "title").trim(),
    body: fieldValue(form, "body"),
    warranty_days: Number(fieldValue(form, "warranty_days") || 0),
    support_terms: fieldValue(form, "support_terms"),
    milestones: [...form.querySelectorAll<HTMLElement>(".milestone-row")].map(
      (row) => ({
        kind: (row.querySelector<HTMLSelectElement>('[name="m_kind"]')?.value ??
          "payment") as DocumentMilestone["kind"],
        title: (
          row.querySelector<HTMLInputElement>('[name="m_title"]')?.value ?? ""
        ).trim(),
        due_date:
          row.querySelector<HTMLInputElement>('[name="m_due"]')?.value ?? "",
        amount: (
          row.querySelector<HTMLInputElement>('[name="m_amount"]')?.value ?? ""
        ).trim(),
      }),
    ),
  };
}

export function ContractEditor({ data }: { data: ContractDetail }) {
  const c = data.contract;
  const d = data.document!;
  const work = useWork();
  const editor = useRichEditor();
  const toast = useToast();
  const refresh = useInvalidate();
  const act = useAct();
  const { openModal, confirm } = useDialogs();
  const rowsBox = useRef<HTMLDivElement>(null);
  // <Form> does not pass a ref on; the milestone box is inside the form.
  const formOf = () => rowsBox.current!.closest("form")!;
  const nextKey = useRef(d.milestones.length);
  const focusNew = useRef(false);
  // A new picker after each upload, as the page drawn again did before.
  const [picker, setPicker] = useState(0);
  const [rows, setRows] = useState<Row[]>(() =>
    d.milestones.map((m, key) => ({ key, m })),
  );
  const links = orgProjectLinks(c.id);

  // A new milestone row starts with the cursor in its title.
  useEffect(() => {
    if (!focusNew.current) return;
    focusNew.current = false;
    rowsBox.current?.lastElementChild
      ?.querySelector<HTMLInputElement>('[name="m_title"]')
      ?.focus();
  }, [rows]);

  const save = () => saveDraft(c.id, editorPayload(formOf()));

  const preview = () => {
    const payload = editorPayload(formOf());
    openModal(
      "ตัวอย่างเอกสาร",
      <ContractDocument
        data={{
          ...data,
          contract: { ...c, title: payload.title },
          document: {
            ...d,
            body: payload.body,
            milestones: payload.milestones,
            warranty_days: payload.warranty_days,
            support_terms: payload.support_terms,
          },
        }}
        orgName={work.tenant.name}
        filePath={links.file}
      />,
      { wide: true },
    );
  };

  const send = () =>
    void act(async () => {
      await save();
      confirm({
        title: "ส่งให้ลูกค้าตรวจ",
        message: `${c.customer_name} จะเห็นเวอร์ชัน ${d.version} และลงนามได้ทันที หลังส่งแล้วเวอร์ชันนี้แก้ไม่ได้`,
        cancelLabel: "ยังไม่ส่ง",
        confirmLabel: "ส่งให้ลูกค้าตรวจ",
        run: async () => {
          await sendContract(c.id);
          toast("ส่งเอกสารให้ลูกค้าแล้ว");
          await refresh(CONTRACTS_PREFIX);
        },
      });
    })();

  const removeFile = (fileId: string) =>
    void act(async () => {
      await save();
      await removeContractFile(c.id, fileId);
      toast("นำไฟล์ออกแล้ว");
      await refresh(CONTRACTS_PREFIX);
    })();

  return (
    <Form
      className="card contract-editor"
      onSubmit={async () => {
        await save();
        toast("บันทึกร่างแล้ว");
        await refresh(CONTRACTS_PREFIX);
      }}
    >
      <div className="card-header">
        <div>
          <h2>ฉบับร่าง เวอร์ชัน {d.version}</h2>
          <p>
            {d.note ? `เหตุผลที่แก้: ${d.note} · ` : ""}
            บันทึกได้หลายครั้งจนกว่าจะส่ง หลังส่งแล้วเวอร์ชันนี้แก้ไม่ได้
          </p>
        </div>
      </div>
      <div className="card-body">
        {data.renews && (
          <p className="notice">
            สัญญา MA ต่อการดูแลของ {data.renews.reference} · {data.renews.title}
          </p>
        )}
        <TextField
          label="ชื่อเอกสาร"
          name="title"
          defaultValue={c.title}
          max={200}
        />
        <div className="field editor-field">
          <div className="editor-head">
            <label htmlFor="contract-body">เนื้อหาเอกสาร</label>
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
            id="contract-body"
            name="body"
            defaultValue={d.body}
            maxLength={50000}
            label="เนื้อหาเอกสาร"
            placeholder="พิมพ์ข้อตกลง ขอบเขตงาน และเงื่อนไข"
            className="article-content editor-input contract-input"
          />
        </div>
        <h3 className="contract-subhead">งวดงานและการชำระเงิน</h3>
        <p className="tiny muted">
          หลังลงนามครบ แต่ละงวดจะเป็นรายการติดตาม:
          งวดส่งมอบให้ทีมกดยืนยันเมื่อส่งแล้ว งวดชำระเงินให้ลูกค้าแนบหลักฐานได้
        </p>
        <div className="milestone-rows" id="milestone-rows" ref={rowsBox}>
          {rows.map((row) => (
            <MilestoneRow
              key={row.key}
              m={row.m}
              onRemove={() =>
                setRows((all) => all.filter((r) => r.key !== row.key))
              }
            />
          ))}
        </div>
        <button
          type="button"
          className="btn subtle sm"
          onClick={() => {
            focusNew.current = true;
            setRows((all) => [
              ...all,
              { key: nextKey.current++, m: blankMilestone },
            ]);
          }}
        >
          <Icon name="plus" />
          เพิ่มงวด
        </button>
        <h3 className="contract-subhead">การรับประกันและดูแลหลังการขาย</h3>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="warranty-days">
              {data.renews
                ? "ระยะบริการ MA (วัน) ต่อจากวันสิ้นสุดความคุ้มครองเดิม"
                : "ระยะรับประกัน (วัน) นับจากตรวจรับงวดส่งมอบสุดท้าย"}
            </label>
            <input
              id="warranty-days"
              name="warranty_days"
              type="number"
              min={0}
              max={3650}
              defaultValue={d.warranty_days}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="support-terms">
            เงื่อนไขการดูแล (SLA) ที่ลูกค้าเห็นในหน้ารับประกัน
          </label>
          <textarea
            id="support-terms"
            name="support_terms"
            rows={3}
            maxLength={5000}
            defaultValue={d.support_terms}
          />
        </div>
        <h3 className="contract-subhead">เอกสารแนบ</h3>
        {data.files.length > 0 && (
          <ul className="contract-files">
            {data.files.map((f) => (
              <ContractFileItem
                key={f.id}
                file={f}
                path={links.file(f.id)}
                onRemove={() => removeFile(f.id)}
              />
            ))}
          </ul>
        )}
        <FileInput
          key={picker}
          name="contract_files"
          id="contract-files"
          className="attach-input"
          accept=".pdf,.png,.jpg,.jpeg"
          aria-label="แนบไฟล์ PDF หรือรูปภาพ"
          onFiles={async (chosen) => {
            if (!chosen.length) return;
            try {
              // The server checks the type, the content and the size of each file.
              const files = await Promise.all(chosen.map(readFile));
              await save();
              await addContractFiles(c.id, files);
              toast("แนบไฟล์แล้ว");
              setPicker((n) => n + 1);
              await refresh(CONTRACTS_PREFIX);
            } catch (error) {
              toast(
                error instanceof Error ? error.message : String(error),
                true,
              );
              setPicker((n) => n + 1);
            }
          }}
        />
        <label className="btn subtle sm" htmlFor="contract-files">
          <Icon name="paperclip" />
          แนบไฟล์ PDF / รูปภาพ
        </label>
        <p className="tiny muted">
          เอกสาร PDF ที่ทำไว้จากที่อื่นแนบเป็นเอกสารประกอบได้ ไม่เกิน 5 MB
          ต่อไฟล์ ลูกค้าเห็นและดาวน์โหลดได้หลังส่ง
        </p>
        <div className="form-actions wrap">
          <button className="btn" type="submit">
            <Icon name="check" />
            บันทึกร่าง
          </button>
          <button className="btn" type="button" onClick={preview}>
            <Icon name="eye" />
            ดูตัวอย่าง
          </button>
          <button className="btn primary" type="button" onClick={send}>
            <Icon name="send" />
            บันทึกและส่งให้ลูกค้าตรวจ
          </button>
        </div>
      </div>
    </Form>
  );
}
