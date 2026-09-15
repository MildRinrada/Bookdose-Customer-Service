"use client";

import { useCallback } from "react";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/ui/Toast";
import { download } from "@/lib/api/client";
import { date } from "@/lib/format";
import { contractEventLabels } from "../labels";
import type {
  ContractEvent,
  ContractFile,
  ContractInfo,
  ContractStatus,
  ContractVersion,
  Project,
} from "../types";

/* Small pieces both sides draw the same way: the step bars, file rows, versions, the audit trail and printing. */

/** A click that fails says why in the toast, as the old action dispatcher did. */
export function useAct() {
  const toast = useToast();
  return useCallback(
    (work: () => Promise<unknown> | unknown) => async () => {
      try {
        await work();
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), true);
      }
    },
    [toast],
  );
}

/** ol.customer-progress: numbered steps, done ones ticked (pages/customer/customer-steps.html). */
export function ProgressSteps({
  steps,
  step,
  allDone = false,
}: {
  steps: string[];
  step: number;
  allDone?: boolean;
}) {
  return (
    <ol className="customer-progress">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < step || allDone;
        const current = n === step && !allDone;
        return (
          <li
            key={n}
            className={`customer-progress-step${done ? " done" : ""}${current ? " current" : ""}`}
            aria-current={current ? "step" : undefined}
          >
            <span className="customer-progress-dot" aria-hidden="true">
              {done ? <Icon name="check" /> : n}
            </span>
            <span className="customer-progress-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** ร่างเอกสาร → รอการตรวจสอบ → รอลงนาม → อนุมัติเรียบร้อย */
export function ContractSteps({ status }: { status: ContractStatus }) {
  const step =
    (
      {
        draft: 1,
        changes: 1,
        review: 2,
        awaiting_org: 3,
        completed: 4,
      } as Record<string, number>
    )[status] || 1;
  return (
    <ProgressSteps
      steps={["ร่างเอกสาร", "รอการตรวจสอบ", "รอลงนาม", "อนุมัติเรียบร้อย"]}
      step={step}
      allDone={status === "completed"}
    />
  );
}

/** พูดคุยและเจรจา → สัญญา/TOR → งวดงานและชำระเงิน → รับประกันและดูแล */
export function JourneySteps({
  contract,
  project,
}: {
  contract: Pick<ContractInfo, "status">;
  project: Project | null;
}) {
  const step =
    contract.status !== "completed" ? 2 : !project?.delivered_at ? 3 : 4;
  return (
    <ProgressSteps
      steps={[
        "พูดคุยและเจรจา",
        "สัญญา/TOR",
        "งวดงานและชำระเงิน",
        "รับประกันและดูแล",
      ]}
      step={step}
    />
  );
}

/** One downloadable file (li): the document's attachments, a delivery's work, a payment slip. */
export function ContractFileItem({
  file,
  path,
  onRemove,
}: {
  file: ContractFile;
  path: string;
  onRemove?: () => void;
}) {
  const toast = useToast();
  return (
    <li>
      <button
        type="button"
        className="link-button"
        onClick={() =>
          download(path, file.name).catch((error: Error) =>
            toast(error.message, true),
          )
        }
      >
        <Icon name="paperclip" />
        {file.name}
      </button>
      <span className="muted">{Math.ceil(file.size / 1024)} KB</span>
      {onRemove && (
        <button
          type="button"
          className="icon-btn sm"
          aria-label={`นำไฟล์ ${file.name} ออก`}
          title="นำออก"
          onClick={onRemove}
        >
          <Icon name="close" />
        </button>
      )}
    </li>
  );
}

/** The li rows of ol.contract-versions; `current` is the version being read. */
export function ContractVersionRows({
  versions,
  current,
}: {
  versions: ContractVersion[];
  current: string | null | undefined;
}) {
  return (
    <>
      {versions.map((v) => (
        <li
          key={v.version}
          className={v.version === current ? "current" : undefined}
        >
          <strong>เวอร์ชัน {v.version}</strong>
          <span className="muted">
            {v.sent_at
              ? `ส่งเมื่อ ${date(v.sent_at, true)}`
              : "ฉบับร่าง ยังไม่ส่ง"}
          </span>
          {v.note && <span className="tiny">{v.note}</span>}
        </li>
      ))}
    </>
  );
}

const parties: Record<string, string> = {
  org: "ผู้รับจ้าง",
  customer: "ผู้ว่าจ้าง",
  system: "ระบบ",
};

/** The li rows of ol.contract-events, newest first. The IP addresses are for the team only (withIp). */
export function ContractEventRows({
  events,
  withIp,
}: {
  events: ContractEvent[];
  withIp: boolean;
}) {
  return (
    <>
      {[...events].reverse().map((e, i) => (
        <li key={`${e.created_at}-${i}`}>
          <time dateTime={e.created_at}>{date(e.created_at, true)}</time>
          <span>
            <strong>{contractEventLabels[e.action] || e.action}</strong> ·{" "}
            {parties[e.party] || e.party} {e.actor}
            {e.version ? ` · v${e.version}` : null}
            {e.detail ? (
              <span className="contract-event-detail">{e.detail}</span>
            ) : null}
            {withIp && e.ip ? <code>IP {e.ip}</code> : null}
          </span>
        </li>
      ))}
    </>
  );
}

/** Printing (or saving as PDF) shows only the document, with its watermark and hash on every page. */
export function printContract() {
  const root = document.documentElement;
  root.classList.add("printing-contract");
  window.addEventListener(
    "afterprint",
    () => root.classList.remove("printing-contract"),
    { once: true },
  );
  window.print();
}

export function PrintButton({
  className = "btn sm subtle",
}: {
  className?: string;
}) {
  return (
    <button type="button" className={className} onClick={printContract}>
      <Icon name="download" />
      ดาวน์โหลด / พิมพ์ PDF
    </button>
  );
}
