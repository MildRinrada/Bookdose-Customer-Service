"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { FileInput, filesOf } from "@/components/ui/FileInput";
import { Form } from "@/components/ui/Form";
import { readFile, type Upload } from "@/lib/files";
import { baht, date, longDate } from "@/lib/format";
import {
  invoiceStatusLabels,
  invoiceStatusTones,
  receiptTitle,
} from "../labels";
import type { ProjectLinks } from "../links";
import type { InvoiceView } from "../types";
import { ContractFileItem, PrintButton } from "./common";

/* The invoice or, once paid, its receipt: a page that prints (or saves as PDF) on its own, like the contract, with
   the PromptPay QR and the amount in Thai words from the server (pages/contracts/invoice-*.html). */

/** The printable invoice / receipt (pages/contracts/invoice-document.html). */
export function InvoiceDocument({
  data,
  receipt,
}: {
  data: InvoiceView;
  receipt: boolean;
}) {
  const inv = data.invoice;
  const s = data.seller;
  const b = data.buyer;
  const waiting = inv.status === "unpaid" || inv.status === "submitted";
  const title = receipt
    ? receiptTitle(data)
    : s.vat
      ? "ใบแจ้งหนี้/ใบวางบิล"
      : "ใบแจ้งหนี้";
  const number = receipt ? inv.receipt_reference : inv.reference;
  const total = baht(inv.total);
  const stamp =
    inv.status === "void"
      ? "ยกเลิก"
      : !receipt && inv.status === "paid"
        ? "ชำระแล้ว"
        : "";
  return (
    <article className="contract-document invoice-document">
      {stamp && (
        <div className="contract-watermark" aria-hidden="true">
          {stamp}
        </div>
      )}
      <header className="invoice-head">
        <div className="invoice-seller">
          <strong className="invoice-org">{s.name}</strong>
          {s.address && <span>{s.address}</span>}
          {s.tax_id && (
            <span>
              เลขประจำตัวผู้เสียภาษี {s.tax_id}
              {s.branch ? ` · ${s.branch}` : ""}
            </span>
          )}
        </div>
        <div className="invoice-title">
          <h1>{title}</h1>
          <dl>
            <div>
              <dt>เลขที่</dt>
              <dd>{number}</dd>
            </div>
            <div>
              <dt>วันที่</dt>
              <dd>{longDate(receipt ? inv.paid_at : inv.issued_at)}</dd>
            </div>
            {receipt ? (
              <div>
                <dt>อ้างอิง</dt>
                <dd>{inv.reference}</dd>
              </div>
            ) : (
              <div>
                <dt>ครบกำหนด</dt>
                <dd>{longDate(inv.due_date)}</dd>
              </div>
            )}
          </dl>
        </div>
      </header>
      <section className="invoice-buyer">
        <span className="muted">{receipt ? "ได้รับเงินจาก" : "ลูกค้า"}</span>
        <strong>{b.name}</strong>
        {b.address && <span>{b.address}</span>}
        {b.tax_id && (
          <span>
            เลขประจำตัวผู้เสียภาษี {b.tax_id}
            {b.branch ? ` · ${b.branch}` : ""}
          </span>
        )}
        <span className="muted">{b.email}</span>
      </section>
      <div className="table-scroll">
        <table className="invoice-lines">
          <thead>
            <tr>
              <th>รายการ</th>
              <th className="num">จำนวนเงิน</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                งวดที่ {data.milestone.seq}: {data.milestone.title}
                <span className="muted">
                  ตาม {data.contract.reference} {data.contract.title}
                </span>
              </td>
              <td className="num">{baht(inv.subtotal)}</td>
            </tr>
          </tbody>
          <tfoot>
            {s.vat && (
              <>
                <tr>
                  <th>มูลค่าก่อนภาษี</th>
                  <td className="num">{baht(inv.subtotal)}</td>
                </tr>
                <tr>
                  <th>ภาษีมูลค่าเพิ่ม {inv.vat_rate}%</th>
                  <td className="num">{baht(inv.vat)}</td>
                </tr>
              </>
            )}
            <tr className="invoice-total">
              <th>รวมทั้งสิ้น</th>
              <td className="num">{total}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="invoice-words">({data.total_words})</p>
      {!receipt && waiting && (
        <section className="invoice-pay">
          <div className="grow">
            <h2>ช่องทางชำระเงิน</h2>
            {s.bank && (
              <p>
                <strong>{s.bank}</strong>
                <br />
                ชื่อบัญชี {s.account_name}
                <br />
                เลขที่บัญชี{" "}
                <span className="invoice-account">{s.account_number}</span>
              </p>
            )}
            {s.promptpay && <p>พร้อมเพย์ {s.promptpay}</p>}
            {!s.bank && !s.promptpay && (
              <p className="muted">ติดต่อผู้รับจ้างเพื่อขอช่องทางชำระเงิน</p>
            )}
            <p className="tiny muted">
              ชำระแล้วแนบสลิปในหน้านี้ ผู้รับจ้างจะตรวจและออกใบเสร็จให้
            </p>
          </div>
          {data.qr && (
            <figure className="invoice-qr">
              {/* A data: URL drawn by the server. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={data.qr}
                alt={`QR พร้อมเพย์ ยอด ${total}`}
                width={180}
                height={180}
              />
              <figcaption>
                สแกนด้วยแอปธนาคาร
                <br />
                ยอด {total}
              </figcaption>
            </figure>
          )}
        </section>
      )}
      {receipt && (
        <p className="invoice-received">
          ได้รับเงินถูกต้องแล้ว
          {inv.confirmed_by ? ` · ผู้รับเงิน ${inv.confirmed_by}` : ""}
        </p>
      )}
      <footer className="contract-foot">
        <p className="tiny muted">
          เอกสารออกโดยระบบ Bookdose · {number}
          {receipt ? ` อ้างอิง ${inv.reference}` : ""}
        </p>
      </footer>
    </article>
  );
}

/** The team's buttons on an invoice (pages/contracts/invoice-staff-actions.html); see useStaffInvoiceHandlers. */
export type InvoiceHandlers = {
  confirm?: () => void;
  reject?: () => void;
  void?: () => void;
};

/** The customer's slip form (in the invoice's side column). `onSubmit` gets the file as the API takes it. */
export function InvoiceSlipForm({
  submitted,
  onSubmit,
}: {
  submitted: boolean;
  onSubmit: (file: Upload, note: string) => Promise<unknown>;
}) {
  const [names, setNames] = useState("");
  // A fresh picker after sending (the old page was drawn again).
  const [picker, setPicker] = useState(0);
  return (
    <Form
      className="card"
      onSubmit={async (values, form) => {
        const file = filesOf(form, "slip")[0];
        if (!file) throw new Error("กรุณาเลือกไฟล์สลิป");
        await onSubmit(await readFile(file), values.note || "");
        form.reset();
        setNames("");
        setPicker((n) => n + 1);
      }}
    >
      <div className="card-header">
        <div>
          <h2>แนบสลิปการชำระเงิน</h2>
          <p>
            {submitted
              ? "ส่งสลิปแล้ว รอทีมงานตรวจ · แนบเพิ่มได้"
              : "โอนเข้าบัญชีหรือสแกน QR พร้อมเพย์ แล้วแนบสลิปที่นี่"}
          </p>
        </div>
      </div>
      <div className="card-body project-slip">
        <div>
          <FileInput
            key={picker}
            id="slip-file"
            name="slip"
            multiple={false}
            className="attach-input"
            accept=".png,.jpg,.jpeg,.pdf"
            onFiles={(files) => setNames(files.map((f) => f.name).join(", "))}
          />
          <label className="btn sm" htmlFor="slip-file">
            <Icon name="paperclip" />
            เลือกไฟล์สลิป
          </label>{" "}
          <span className="tiny muted">
            {names || "PNG, JPG หรือ PDF ไม่เกิน 5 MB"}
          </span>
        </div>
        <div className="field">
          <label htmlFor="slip-note">หมายเหตุ (ถ้ามี)</label>
          <input
            id="slip-note"
            name="note"
            maxLength={500}
            placeholder="เช่น โอนจากบัญชีบริษัท"
          />
        </div>
        <button className="btn primary" type="submit">
          <Icon name="send" />
          ส่งสลิป
        </button>
      </div>
    </Form>
  );
}

/** The invoice page for either side (the old invoicePageHTML). view 'receipt' shows the receipt of a paid invoice.
    The team passes `staff` handlers; the customer passes `onSlip` (upload the slip, then refresh). */
export function InvoicePage({
  data,
  view,
  links,
  staff,
  onSlip,
}: {
  data: InvoiceView;
  view: string | null | undefined;
  links: ProjectLinks;
  staff?: InvoiceHandlers;
  onSlip?: (file: Upload, note: string) => Promise<unknown>;
}) {
  const inv = data.invoice;
  const receipt = view === "receipt" && inv.status === "paid";
  const isStaff = links.side === "org";
  const waiting = inv.status === "unpaid" || inv.status === "submitted";
  const due =
    inv.status === "paid" || inv.status === "void" ? "" : date(inv.due_date);
  return (
    <>
      <Link href={links.project("billing")} className="back-link no-print">
        <Icon name="back" />
        ใบแจ้งหนี้ของ {data.contract.reference}
      </Link>
      <section
        className={`customer-banner tone-${invoiceStatusTones[inv.status]} no-print`}
      >
        <div className="customer-banner-main">
          <span className="customer-banner-ref">
            {data.contract.reference} · {data.contract.title}
          </span>
          <h1>
            {receipt
              ? `${receiptTitle(data)} ${inv.receipt_reference}`
              : `ใบแจ้งหนี้ ${inv.reference}`}
          </h1>
          <p>
            <strong>{invoiceStatusLabels[inv.status]}</strong> · ยอดชำระ{" "}
            {baht(inv.total)}
            {due ? ` · ครบกำหนด ${due}` : ""}
          </p>
          <div className="contract-actions">
            {inv.status === "paid" && (
              <>
                <Link
                  className={`btn sm${receipt ? " primary" : ""}`}
                  href={links.invoice(inv.id, "receipt")}
                >
                  <Icon name="receipt" />
                  ใบเสร็จ {inv.receipt_reference}
                </Link>
                <Link
                  className={`btn sm${receipt ? "" : " primary"}`}
                  href={links.invoice(inv.id)}
                >
                  ใบแจ้งหนี้
                </Link>
              </>
            )}
            <PrintButton />
            {isStaff && (
              <>
                {waiting && (
                  <button
                    type="button"
                    className="btn sm primary"
                    onClick={() => staff?.confirm?.()}
                  >
                    <Icon name="check" />
                    ยืนยันรับชำระ ออกใบเสร็จ
                  </button>
                )}
                {inv.status === "submitted" && (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => staff?.reject?.()}
                  >
                    สลิปไม่ถูกต้อง
                  </button>
                )}
                {waiting && (
                  <button
                    type="button"
                    className="btn sm subtle"
                    onClick={() => staff?.void?.()}
                  >
                    ยกเลิกใบแจ้งหนี้
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </section>
      <div className="contract-layout">
        <div className="contract-main">
          <section className="card contract-view">
            <InvoiceDocument data={data} receipt={receipt} />
          </section>
        </div>
        <aside className="contract-side no-print">
          {inv.reject_reason && (
            <p className="notice danger-notice">
              สลิปก่อนหน้าไม่ผ่านการตรวจ: {inv.reject_reason}
            </p>
          )}
          {inv.void_reason && (
            <p className="notice">ใบแจ้งหนี้นี้ถูกยกเลิก: {inv.void_reason}</p>
          )}
          {!isStaff && waiting && onSlip && (
            <InvoiceSlipForm
              submitted={inv.status === "submitted"}
              onSubmit={onSlip}
            />
          )}
          <section className="card">
            <div className="card-header">
              <h2>สลิปที่แนบ</h2>
            </div>
            {data.slips.length ? (
              <ul className="contract-files card-body">
                {data.slips.map((f) => (
                  <ContractFileItem
                    key={f.id}
                    file={f}
                    path={links.file(f.id)}
                  />
                ))}
              </ul>
            ) : (
              <p className="card-body muted">ยังไม่มีสลิป</p>
            )}
            {inv.slip_note && (
              <p className="card-body tiny">
                หมายเหตุจากลูกค้า: {inv.slip_note}
              </p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
