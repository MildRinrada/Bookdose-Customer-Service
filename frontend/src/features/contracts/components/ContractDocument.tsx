"use client";

import { Icon } from "@/components/Icon";
import { Markdown } from "@/features/rich/Markdown";
import { date } from "@/lib/format";
import {
  amountText,
  contractKindLabels,
  milestoneKindLabels,
  signatureVerifiedLabels,
} from "../labels";
import type { ContractDetail } from "../types";
import { ContractFileItem } from "./common";

/* The contract or TOR itself, as both sides see it: text, milestones, attached files, both signatures, the watermark
   and, once sealed, the SHA-256 hash (pages/contracts/contract-document.html). */

type DocumentData = Pick<
  ContractDetail,
  "contract" | "document" | "files" | "signatures" | "renews"
>;

function ContractSignature({
  data,
  party,
  orgName,
}: {
  data: DocumentData;
  party: "customer" | "org";
  orgName: string;
}) {
  const c = data.contract;
  const s = data.signatures.find((x) => x.party === party);
  const who = party === "customer" ? c.customer_name : orgName;
  return (
    <div className={`contract-signature${s ? " signed" : ""}`}>
      <span className="contract-signature-party">
        {party === "customer" ? "ผู้ว่าจ้าง" : "ผู้รับจ้าง"}
      </span>
      <div className="contract-signature-mark">
        {s ? (
          s.method === "type" ? (
            <span className="signature-typed">{s.mark}</span>
          ) : (
            // A data: URL checked by the server (PNG/JPEG); next/image adds nothing for it.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.mark} alt={`ลายเซ็นของ ${s.signer_name}`} />
          )
        ) : (
          <span className="muted">ยังไม่ลงนาม</span>
        )}
      </div>
      <strong>{s ? s.signer_name : who}</strong>
      {s && (
        <span className="tiny muted">
          {date(s.signed_at, true)} · {signatureVerifiedLabels[s.verified_by]}
        </span>
      )}
    </div>
  );
}

/** `filePath(id)` is the API path of an attached file for the side reading it (ProjectLinks.file). */
export function ContractDocument({
  data,
  orgName,
  filePath,
}: {
  data: DocumentData;
  orgName: string;
  filePath: (fileId: string) => string;
}) {
  const c = data.contract;
  const d = data.document;
  const sealed = c.status === "completed" && Boolean(c.document_hash);
  const milestones = d?.milestones ?? [];
  const warranty = d?.warranty_days
    ? data.renews
      ? `ระยะบริการ ${d.warranty_days} วัน ต่อจากวันสิ้นสุดความคุ้มครองของ ${data.renews.reference}`
      : `ระยะรับประกัน ${d.warranty_days} วัน นับจากวันที่ผู้ว่าจ้างตรวจรับงวดส่งมอบสุดท้าย`
    : "";
  const watermark = sealed
    ? `${c.reference} · ลงนามครบ · Bookdose`
    : c.status === "cancelled"
      ? "ยกเลิกแล้ว"
      : "ร่าง · ยังไม่มีผลผูกพัน";
  const version = d?.version || "";
  return (
    <article className={`contract-document${sealed ? " sealed" : ""}`}>
      <div className="contract-watermark" aria-hidden="true">
        {watermark}
      </div>
      <header className="contract-head">
        <div>
          <span className="contract-kind">{contractKindLabels[c.kind]}</span>
          <strong>{c.reference}</strong>
          <span className="muted">เวอร์ชัน {version}</span>
        </div>
        <span className="muted">{orgName}</span>
      </header>
      <h1 className="contract-title">{c.title}</h1>
      <dl className="contract-parties">
        <div>
          <dt>ผู้รับจ้าง</dt>
          <dd>{orgName}</dd>
        </div>
        <div>
          <dt>ผู้ว่าจ้าง</dt>
          <dd>
            {c.customer_name} · {c.customer_email}
          </dd>
        </div>
      </dl>
      <Markdown
        className="article-content contract-body"
        text={d?.body || ""}
      />
      {milestones.length > 0 && (
        <section className="contract-section">
          <h2>งวดงานและการชำระเงิน</h2>
          <div className="table-scroll">
            <table className="contract-milestones">
              <thead>
                <tr>
                  <th>ชนิด</th>
                  <th>รายการ</th>
                  <th>ครบกำหนด</th>
                  <th>จำนวนเงิน</th>
                </tr>
              </thead>
              <tbody>
                {milestones.map((m, i) => (
                  <tr key={i}>
                    <td>{milestoneKindLabels[m.kind]}</td>
                    <td>{m.title}</td>
                    <td>{m.due_date ? date(m.due_date) : "-"}</td>
                    <td>{amountText(m.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {data.files.length > 0 && (
        <section className="contract-section">
          <h2>เอกสารแนบ</h2>
          <ul className="contract-files">
            {data.files.map((f) => (
              <ContractFileItem key={f.id} file={f} path={filePath(f.id)} />
            ))}
          </ul>
        </section>
      )}
      {warranty && (
        <section className="contract-section">
          <h2>การรับประกันและดูแลหลังการขาย</h2>
          <p>{warranty}</p>
          {d?.support_terms ? (
            <Markdown className="article-content" text={d.support_terms} />
          ) : null}
        </section>
      )}
      <section className="contract-signatures">
        <ContractSignature data={data} party="customer" orgName={orgName} />
        <ContractSignature data={data} party="org" orgName={orgName} />
      </section>
      <footer className="contract-foot">
        {sealed ? (
          <>
            <p className="contract-seal">
              <Icon name="shield" />
              <span>
                ปิดผนึกเมื่อ {c.completed_at ? date(c.completed_at, true) : ""}{" "}
                · SHA-256 <code>{c.document_hash}</code>
              </span>
            </p>
            <p className="tiny muted">
              ขอให้ Bookdose ตรวจรหัสด้านบนเพื่อยืนยันเอกสารฉบับนี้ได้
              ถ้าเนื้อหา ไฟล์แนบ หรือลายเซ็นถูกแก้แม้ตัวอักษรเดียว รหัสจะไม่ตรง
            </p>
          </>
        ) : (
          <p className="muted">
            เอกสารยังลงนามไม่ครบทั้งสองฝ่าย จึงยังไม่มีผลผูกพัน
          </p>
        )}
      </footer>
      {sealed && (
        <div className="contract-print-footer">
          {c.reference} v{version} · SHA-256 {c.document_hash}
        </div>
      )}
    </article>
  );
}
