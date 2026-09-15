"use client";

import { Icon } from "@/components/Icon";
import { Form } from "@/components/ui/Form";
import { useToast } from "@/components/ui/Toast";
import { useInvalidate } from "@/lib/query";
import { useWork } from "@/lib/session";
import { BILLING_PATH, saveBillingSettings } from "../api";

/* ตั้งค่า → การรับชำระเงินและภาษี (pages/settings/billing-panel.html): the bank account and PromptPay shown on
   invoices, VAT and the tax details on receipts. Values come from the workspace's settings, like before; only an
   organization admin can save. */

export function BillingSettingsPanel() {
  const work = useWork();
  const toast = useToast();
  const refresh = useInvalidate();
  const value = (key: string) => String(work.settings[key] ?? "");
  const canEdit = work.role === "admin";
  return (
    <Form
      onSubmit={async (values, form) => {
        await saveBillingSettings({
          pay_bank: values.pay_bank || "",
          pay_account_name: values.pay_account_name || "",
          pay_account_number: values.pay_account_number || "",
          pay_promptpay: values.pay_promptpay || "",
          vat_registered: (
            form.elements.namedItem("vat_registered") as HTMLInputElement
          ).checked,
          tax_id: values.tax_id || "",
          tax_branch: values.tax_branch || "",
          org_address: values.org_address || "",
          invoice_due_days: Number(values.invoice_due_days || 0),
        });
        toast("บันทึกการรับชำระเงินและภาษีแล้ว");
        await refresh("/api/workspace", BILLING_PATH);
      }}
    >
      <section className="card">
        <div className="card-header">
          <div>
            <h2>บัญชีรับเงิน</h2>
            <p>
              แสดงในใบแจ้งหนี้ พร้อม QR พร้อมเพย์ตามยอดของแต่ละใบ ·
              ใบที่ออกแล้วไม่เปลี่ยนตาม
            </p>
          </div>
          <Icon name="receipt" />
        </div>
        <div className="card-body">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="pay-bank">ธนาคาร</label>
              <input
                id="pay-bank"
                name="pay_bank"
                defaultValue={value("pay_bank")}
                maxLength={100}
                placeholder="เช่น ธนาคารกสิกรไทย"
              />
            </div>
            <div className="field">
              <label htmlFor="pay-account-name">ชื่อบัญชี</label>
              <input
                id="pay-account-name"
                name="pay_account_name"
                defaultValue={value("pay_account_name")}
                maxLength={150}
              />
            </div>
            <div className="field">
              <label htmlFor="pay-account-number">เลขที่บัญชี</label>
              <input
                id="pay-account-number"
                name="pay_account_number"
                defaultValue={value("pay_account_number")}
                maxLength={30}
                inputMode="numeric"
              />
            </div>
            <div className="field">
              <label htmlFor="pay-promptpay">
                พร้อมเพย์ (เบอร์มือถือ หรือเลขประจำตัว 13 หลัก)
              </label>
              <input
                id="pay-promptpay"
                name="pay_promptpay"
                defaultValue={value("pay_promptpay")}
                maxLength={20}
                inputMode="numeric"
              />
            </div>
            <div className="field">
              <label htmlFor="due-days">กำหนดชำระ (วันหลังออกใบแจ้งหนี้)</label>
              <input
                id="due-days"
                name="invoice_due_days"
                type="number"
                min={0}
                max={120}
                defaultValue={value("invoice_due_days") || "15"}
              />
            </div>
          </div>
        </div>
      </section>
      <section className="card">
        <div className="card-header">
          <div>
            <h2>ภาษีและใบเสร็จ</h2>
            <p>
              จด VAT: ใบแจ้งหนี้คิดภาษีมูลค่าเพิ่ม 7% จากยอดในสัญญา
              และออกใบเสร็จรับเงิน/ใบกำกับภาษี · ไม่จด: ออกใบเสร็จรับเงิน
            </p>
          </div>
        </div>
        <div className="card-body">
          <label className="check">
            <input
              type="checkbox"
              name="vat_registered"
              defaultChecked={value("vat_registered") === "1"}
            />
            <span>องค์กรจดทะเบียนภาษีมูลค่าเพิ่ม (VAT)</span>
          </label>
          <div className="form-grid mt">
            <div className="field">
              <label htmlFor="tax-id">เลขประจำตัวผู้เสียภาษี</label>
              <input
                id="tax-id"
                name="tax_id"
                defaultValue={value("tax_id")}
                maxLength={20}
                inputMode="numeric"
              />
            </div>
            <div className="field">
              <label htmlFor="tax-branch">สำนักงาน/สาขา</label>
              <input
                id="tax-branch"
                name="tax_branch"
                defaultValue={value("tax_branch")}
                maxLength={60}
                placeholder="เช่น สำนักงานใหญ่"
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="org-address">ที่อยู่ในใบแจ้งหนี้และใบเสร็จ</label>
            <textarea
              id="org-address"
              name="org_address"
              rows={3}
              maxLength={500}
              defaultValue={value("org_address")}
            />
          </div>
        </div>
      </section>
      {canEdit ? (
        <div className="settings-save">
          <span className="muted">ใช้กับใบแจ้งหนี้ที่ออกหลังบันทึก</span>
          <button className="btn primary" type="submit">
            <Icon name="check" />
            บันทึกการรับชำระเงิน
          </button>
        </div>
      ) : (
        <p className="notice">เฉพาะผู้ดูแลองค์กรแก้ไขส่วนนี้ได้</p>
      )}
    </Form>
  );
}
