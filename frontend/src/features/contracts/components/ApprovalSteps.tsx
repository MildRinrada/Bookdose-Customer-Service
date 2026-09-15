"use client";

import { Icon } from "@/components/Icon";
import { date } from "@/lib/format";
import type { ProjectSide } from "../links";
import type { ApprovalRun, ApprovalStep } from "../types";

/* A customer-side review (backend client_team/approvals.py): reviewers in order, then the final decision. The
   customer sees whose turn it is and, on their own turn, the review buttons; the team sees the progress read-only
   ("ลูกค้ากำลังตรวจ 1/2"). Markup: pages/team.css (.approval-*). */

type StepState = "done" | "returned" | "current" | "waiting";

function stepState(run: ApprovalRun, s: ApprovalStep): StepState {
  if (s.decision === "approved") return "done";
  if (s.decision === "returned") return "returned";
  return s.step === run.current ? "current" : "waiting";
}

const stepWords: Record<StepState, string> = {
  done: "ผ่านการตรวจ",
  returned: "ส่งกลับแก้ไข",
  current: "กำลังรอตรวจ",
  waiting: "รอขั้นก่อนหน้า",
};

/** One line about where a review stands, for the side looking at it. */
export function approvalHeadline(run: ApprovalRun, side: ProjectSide): string {
  const total = run.steps.length;
  if (run.ready)
    return side === "org"
      ? `ลูกค้าตรวจครบ ${total} ขั้นแล้ว รอผู้มีสิทธิ์อนุมัติขั้นสุดท้าย`
      : `ผ่านการตรวจครบ ${total} ขั้นแล้ว`;
  const waiting = run.steps[(run.current ?? 1) - 1];
  if (side === "org") return `ลูกค้ากำลังตรวจ ${run.current}/${total}`;
  if (run.my_turn) return `ถึงขั้นของคุณ: ขั้นที่ ${run.current}/${total}`;
  return `รอตรวจขั้นที่ ${run.current}/${total} · คุณ${waiting?.name ?? ""}`;
}

/** The steps of a review, and the final decision after them. */
export function ApprovalSteps({
  run,
  finalLabel,
}: {
  run: ApprovalRun;
  /** The final action, e.g. "อนุมัติรับงาน" or "ลงนาม". */
  finalLabel: string;
}) {
  return (
    <ol className="approval-steps">
      {run.steps.map((s) => {
        const state = stepState(run, s);
        return (
          <li key={s.step} className="approval-step" data-state={state}>
            <span className="approval-step-dot" aria-hidden="true">
              {state === "done" ? <Icon name="check" /> : s.step}
            </span>
            <div className="grow">
              <strong>คุณ{s.name}</strong>
              <span className="muted">
                {stepWords[state]}
                {s.decided_at ? ` · ${date(s.decided_at, true)}` : ""}
              </span>
              {s.remark && <p className="approval-remark">{s.remark}</p>}
            </div>
          </li>
        );
      })}
      <li
        className="approval-step"
        data-state={run.ready ? "current" : "waiting"}
      >
        <span className="approval-step-dot" aria-hidden="true">
          <Icon name="checkCircle" />
        </span>
        <div className="grow">
          <strong>{finalLabel}</strong>
          <span className="muted">
            {run.ready
              ? "เปิดให้ผู้มีสิทธิ์อนุมัติดำเนินการแล้ว"
              : "เมื่อผู้ตรวจทุกขั้นผ่านการตรวจ"}
          </span>
        </div>
      </li>
    </ol>
  );
}

/** ผ่านการตรวจ / ส่งกลับแก้ไข on the viewer's own step. */
export function ReviewButtons({
  onReview,
}: {
  onReview: (decision: "approved" | "returned") => void;
}) {
  return (
    <div className="contract-actions">
      <button
        type="button"
        className="btn primary sm"
        onClick={() => onReview("approved")}
      >
        <Icon name="check" />
        ผ่านการตรวจ
      </button>
      <button
        type="button"
        className="btn sm"
        onClick={() => onReview("returned")}
      >
        <Icon name="edit" />
        ส่งกลับแก้ไข
      </button>
    </div>
  );
}
