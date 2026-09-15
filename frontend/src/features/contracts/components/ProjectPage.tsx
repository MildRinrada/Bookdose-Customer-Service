"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { EmptyState } from "@/components/ui/display";
import { RequiredStar, useFieldValidation } from "@/components/ui/fields";
import { Form } from "@/components/ui/Form";
import { MarkdownBlocks } from "@/features/rich/Markdown";
import { baht, date, longDate, relative } from "@/lib/format";
import { caseState, statusLabels } from "@/lib/labels";
import {
  contractKindLabels,
  contractStatusLabels,
  contractStatusTones,
  coverageSummary,
  invoiceStatusLabels,
  invoiceStatusTones,
  isDoneIssue,
  isProjectTab,
  issueKindLabels,
  milestoneInvoice,
  milestoneKindLabels,
  milestoneState,
  projectStatus,
  projectTabLabels,
  roundLabels,
  roundTones,
  ticketStatusTones,
  type ProjectTab,
} from "../labels";
import type { ProjectLinks, ProjectSide } from "../links";
import type {
  Capability,
  ContractApproval,
  ContractDetail,
  Delivery,
  Project,
  ProjectMilestone,
  ReviewDecision,
} from "../types";
import {
  ApprovalSteps,
  approvalHeadline,
  ReviewButtons,
} from "./ApprovalSteps";
import { ContractDocument } from "./ContractDocument";
import { ProjectContext, useProject } from "./ProjectContext";
import { ProjectDrive } from "./ProjectDrive";
import {
  ContractEventRows,
  ContractFileItem,
  ContractVersionRows,
  JourneySteps,
  PrintButton,
} from "./common";

/* The project after a contract or TOR is signed, drawn the same way for the team and the customer: the journey,
   overall progress, the milestone timeline and each milestone's inspection rounds, invoices and receipts, problems
   and change requests, the warranty with its MA contracts, and the signed document
   (pages/contracts/project-*.html). What the side looking at it can do comes in through `handlers`; markup that only
   one side sees is chosen by links.side, as the old templates did. */

/** What the buttons of a project page do. The team's side passes the org handlers (useStaffProjectHandlers), the
    customer's side the customer ones; a missing handler leaves its button inert. */
export type ProjectHandlers = {
  // The team (side 'org')
  /** เริ่มงาน on a delivery that has not started. */
  start?: (m: ProjectMilestone) => void;
  /** The progress form of a delivery being worked on; throw to show the reason on the form. */
  saveProgress?: (m: ProjectMilestone, progress: number) => Promise<unknown>;
  /** ส่งมอบให้ตรวจรับ */
  deliver?: (m: ProjectMilestone) => void;
  /** ออกใบแจ้งหนี้ of a milestone with an amount and no invoice. */
  invoice?: (m: ProjectMilestone) => void;
  /** สร้างสัญญา MA (warranty tab). */
  createMA?: () => void;
  // The customer (side 'customer')
  /** อนุมัติรับงาน */
  accept?: (m: ProjectMilestone) => void;
  /** ส่งกลับแก้ไข */
  reject?: (m: ProjectMilestone) => void;
  /** ผ่านการตรวจ / ส่งกลับแก้ไข on the viewer's step of the round's approval flow. */
  review?: (m: ProjectMilestone, decision: ReviewDecision) => void;
  /** The owner's approval flows for this project (milestones tab). */
  editFlow?: () => void;
  /** แก้ไข the buyer's details for receipts (billing tab). */
  editBuyer?: () => void;
  /** แจ้งปัญหา / ขอเปลี่ยนแปลง (issues tab). */
  newIssue?: () => void;
  /** ขอต่อสัญญา MA (warranty tab). */
  requestMA?: () => void;
};

export type SignedContract = ContractDetail & { project: Project };

const NO_APPROVAL: ContractApproval = { contract: null, deliveries: {} };

/** One signed project page, for either side: banner, tabs, and the tab being read. */
export function ProjectPage({
  data,
  tab,
  back,
  backLabel,
  org,
  actions,
  links,
  handlers = {},
}: {
  data: SignedContract;
  /** ?tab= (anything unknown is the board). */
  tab: string | null | undefined;
  back: string;
  backLabel: string;
  /** The organization's name (the contractor). */
  org: string;
  /** Buttons and links in the banner (.contract-actions), e.g. <ContractActionButton> and <ContractActionLink>. */
  actions?: ReactNode;
  links: ProjectLinks;
  handlers?: ProjectHandlers;
}) {
  const c = data.contract;
  const project = data.project;
  const status = projectStatus(project);
  // The team may do everything; a customer-side viewer what their role on the contract allows.
  const can = (capability: Capability) =>
    links.side === "org" ||
    !data.access ||
    data.access.can.includes(capability);
  const allowed = (key: ProjectTab) => key !== "billing" || can("billing");
  const approval = data.approval ?? NO_APPROVAL;
  const current: ProjectTab =
    isProjectTab(tab) && allowed(tab) ? tab : "board";
  const content = {
    board: () => <ProjectBoard project={project} />,
    milestones: () => <ProjectMilestones project={project} />,
    drive: () => <ProjectDrive />,
    billing: () => <ProjectBilling project={project} />,
    issues: () => <ProjectIssues project={project} />,
    warranty: () => <ProjectWarranty project={project} />,
    document: () => <ProjectDocument data={data} org={org} />,
  }[current]();
  return (
    <ProjectContext.Provider
      value={{ links, handlers, side: links.side, can, approval }}
    >
      <Link href={back} className="back-link no-print">
        <Icon name="back" />
        {backLabel}
      </Link>
      <section
        className={`customer-banner project-banner tone-${status.tone} no-print`}
      >
        <div className="customer-banner-main">
          <span className="customer-banner-ref">
            {contractKindLabels[c.kind]} {c.reference} · เวอร์ชัน {c.version} ·{" "}
            {org}
          </span>
          <h1>{c.title}</h1>
          <p>
            <strong>{status.text}</strong>
            {project.renews && (
              <>
                {" "}
                · ต่อการดูแลของ{" "}
                <Link href={links.contract(project.renews.id)}>
                  {project.renews.reference}
                </Link>
              </>
            )}
          </p>
          <div className="project-banner-progress">
            <progress
              className="project-meter"
              max={100}
              value={project.progress}
              aria-label="ความคืบหน้าโครงการ"
            >
              {project.progress}%
            </progress>
            <strong>{project.progress}%</strong>
          </div>
          {actions ? <div className="contract-actions">{actions}</div> : null}
        </div>
        <div className="customer-banner-side">
          <JourneySteps contract={c} project={project} />
        </div>
      </section>
      <ProjectTabs
        current={current}
        project={project}
        links={links}
        allowed={allowed}
      />
      <div className="project-content">{content}</div>
    </ProjectContext.Provider>
  );
}

/** A banner button (pages/contracts/contract-action.html). */
export function ContractActionButton({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`btn sm${danger ? " subtle" : ""}`}
      onClick={onClick}
    >
      <Icon name={icon} />
      {label}
    </button>
  );
}

/** A banner link (pages/contracts/project-action-link.html). */
export function ContractActionLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: string;
  label: string;
}) {
  return (
    <Link className="btn sm subtle" href={href}>
      <Icon name={icon} />
      {label}
    </Link>
  );
}

function ProjectTabs({
  current,
  project,
  links,
  allowed,
}: {
  current: ProjectTab;
  project: Project;
  links: ProjectLinks;
  /** Tabs the viewer may open (billing needs the billing capability). */
  allowed: (tab: ProjectTab) => boolean;
}) {
  const counts: Partial<Record<ProjectTab, number>> = {
    milestones: project.milestones.filter(
      (m) => m.status === "submitted" || m.status === "revision",
    ).length,
    billing: project.invoices.filter(
      (i) => i.status === "unpaid" || i.status === "submitted",
    ).length,
    issues: project.issues.filter((i) => !isDoneIssue(i.status)).length,
  };
  return (
    <nav className="project-tabs no-print" aria-label="ส่วนของโครงการ">
      {(Object.entries(projectTabLabels) as Array<[ProjectTab, string]>)
        .filter(([key]) => allowed(key))
        .map(([key, label]) => (
          <Link
            key={key}
            href={links.project(key)}
            aria-current={key === current ? "page" : undefined}
          >
            {label}
            {counts[key] ? <span className="count">{counts[key]}</span> : null}
          </Link>
        ))}
    </nav>
  );
}

// What waits, and for whom, as links into the tabs (on the customer's side, only what the viewer may act on).
function projectTodo(
  project: Project,
  side: ProjectSide,
  can: (capability: Capability) => boolean,
  approval: ContractApproval,
): Array<[ProjectTab, string]> {
  const items: Array<[ProjectTab, string]> = [];
  const n = (test: (m: ProjectMilestone) => boolean) =>
    project.milestones.filter(test).length;
  const unpaid = project.invoices.filter((i) => i.status === "unpaid").length;
  if (side === "customer") {
    // A round under review waits for its reviewer first; the decision is open once every step approved.
    const run = (m: ProjectMilestone) => approval.deliveries[m.id];
    const reviews = n((m) => m.status === "submitted" && Boolean(run(m)?.my_turn));
    const decisions = n(
      (m) => m.status === "submitted" && (!run(m) || run(m).ready),
    );
    if (reviews)
      items.push(["milestones", `มีงาน ${reviews} งวดถึงขั้นที่คุณต้องตรวจ`]);
    if (can("decide") && decisions)
      items.push(["milestones", `มีงาน ${decisions} งวดรอคุณตรวจรับ`]);
    if (unpaid) items.push(["billing", `ใบแจ้งหนี้รอชำระ ${unpaid} ใบ`]);
    if (
      can("decide") &&
      project.coverage.state === "active" &&
      (project.coverage.days_left ?? 0) <= 30 &&
      !project.ma_requested_at &&
      !project.renews
    )
      items.push([
        "warranty",
        `การรับประกันจะหมดใน ${project.coverage.days_left} วัน ขอต่อสัญญา MA ได้`,
      ]);
  } else {
    if (n((m) => m.status === "revision"))
      items.push([
        "milestones",
        `ลูกค้าส่งกลับแก้ไข ${n((m) => m.status === "revision")} งวด`,
      ]);
    const slips = project.invoices.filter(
      (i) => i.status === "submitted",
    ).length;
    if (slips) items.push(["billing", `สลิปรอตรวจ ${slips} ใบ`]);
    const unbilled = n(
      (m) =>
        Number(m.amount) > 0 &&
        !milestoneInvoice(project, m) &&
        (m.kind === "payment" || m.status === "done"),
    );
    if (unbilled)
      items.push(["milestones", `งวดที่ยังไม่ออกใบแจ้งหนี้ ${unbilled} งวด`]);
    if (project.ma_requested_at)
      items.push(["warranty", "ลูกค้าขอต่อสัญญา MA"]);
    const open = project.issues.filter((i) => !isDoneIssue(i.status)).length;
    if (open)
      items.push([
        "issues",
        `ปัญหา/คำขอเปลี่ยนแปลงที่ยังเปิดอยู่ ${open} รายการ`,
      ]);
  }
  return items;
}

export function ProjectBoard({ project }: { project: Project }) {
  const { links, side, can, approval } = useProject();
  const ms = project.milestones;
  const next = ms.find((m) => m.status !== "done");
  const cover = coverageSummary(project);
  const deliveries = ms.filter((m) => m.kind === "delivery");
  const todo = projectTodo(project, side, can, approval);
  const totals = project.totals;
  return (
    <div className="project-board">
      <section className="card project-stats">
        <div className="project-stat">
          <span className="muted">ความคืบหน้า</span>
          <strong>{project.progress}%</strong>
          <progress
            className="project-meter"
            max={100}
            value={project.progress}
          >
            {project.progress}%
          </progress>
          <span className="tiny muted">
            {deliveries.length
              ? "งวดที่ตรวจรับแล้วนับเต็ม งวดที่กำลังทำนับตามที่ทีมรายงาน"
              : "นับจากงวดชำระเงินที่ชำระแล้ว"}
          </span>
        </div>
        <div className="project-stat">
          <span className="muted">งวดที่เสร็จ</span>
          <strong>
            {ms.filter((m) => m.status === "done").length} / {ms.length}
          </strong>
          <span className="tiny muted">
            {next
              ? `ถัดไป: ${next.title}${next.due_date ? ` · ${date(next.due_date)}` : ""}`
              : "ครบทุกงวดแล้ว"}
          </span>
        </div>
        {totals && (
          <div className="project-stat">
            <span className="muted">ชำระแล้ว</span>
            <strong>{baht(totals.paid)}</strong>
            <span className="tiny muted">
              ออกใบแจ้งหนี้แล้ว {baht(totals.billed)} · มูลค่าตามสัญญา{" "}
              {baht(totals.contract)} (ก่อน VAT)
            </span>
          </div>
        )}
        <div className="project-stat">
          <span className="muted">การรับประกัน</span>
          <strong className={`tone-text-${cover.tone}`}>{cover.title}</strong>
          <span className="tiny muted">{cover.text}</span>
        </div>
      </section>
      {todo.length > 0 && (
        <section className="notice project-todo">
          {todo.map(([tab, text], i) => (
            <Link
              key={i}
              className="project-todo-item"
              href={links.project(tab)}
            >
              <Icon name="arrow" />
              {text}
            </Link>
          ))}
        </section>
      )}
      <section className="card">
        <div className="card-header">
          <div>
            <h2>ไทม์ไลน์งวดงาน</h2>
            <p>ตามที่ระบุในสัญญา/TOR</p>
          </div>
          <Link className="btn sm subtle" href={links.project("milestones")}>
            รายละเอียดและการตรวจรับ
          </Link>
        </div>
        <ol className="project-timeline">
          {ms.map((m) => {
            const s = milestoneState(project, m);
            return (
              <li key={m.id} className={`project-line tone-${s.tone}`}>
                <span className="project-line-dot" aria-hidden="true">
                  {m.seq}
                </span>
                <div className="grow">
                  <strong>{m.title}</strong>
                  <span className="muted">
                    {milestoneKindLabels[m.kind]} · ครบกำหนด{" "}
                    {m.due_date ? date(m.due_date) : "ไม่ได้กำหนด"}
                    {Number(m.amount) ? ` · ${baht(m.amount)}` : ""}
                  </span>
                  {m.kind === "delivery" && m.status !== "done" && (
                    <progress
                      className="project-meter sm"
                      max={100}
                      value={m.progress}
                    >
                      {m.progress}%
                    </progress>
                  )}
                </div>
                <span className={`customer-state tone-${s.tone}`}>
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

function ProjectRound({ d }: { d: Delivery }) {
  const { links } = useProject();
  const decision = roundLabels[d.decision];
  return (
    <li className="project-round">
      <div className="project-round-head">
        <strong>รอบที่ {d.round}</strong>
        <span className="muted">
          ส่งโดย {d.submitted_by} · {date(d.submitted_at, true)}
        </span>
        <span className={`customer-state tone-${roundTones[d.decision]}`}>
          {decision}
        </span>
      </div>
      {d.note && <p className="project-round-note">{d.note}</p>}
      {d.links.length > 0 && (
        <ul className="project-links">
          {d.links.map((url, i) => (
            <li key={i}>
              <a href={url} target="_blank" rel="noopener noreferrer">
                <Icon name="external" />
                {url}
              </a>
            </li>
          ))}
        </ul>
      )}
      {d.files.length > 0 && (
        <ul className="contract-files">
          {d.files.map((f) => (
            <ContractFileItem key={f.id} file={f} path={links.file(f.id)} />
          ))}
        </ul>
      )}
      {d.remark && (
        <p className="project-remark">
          {d.decision === "rejected" && (
            <>
              <strong>ต้องแก้:</strong>{" "}
            </>
          )}
          {d.remark}
        </p>
      )}
      {d.decided_at && (
        <p className="tiny muted">
          {decision}เมื่อ {date(d.decided_at, true)}
          {d.decided_by ? ` · ${d.decided_by}` : ""}
        </p>
      )}
    </li>
  );
}

function ProjectMilestoneCard({
  project,
  m,
}: {
  project: Project;
  m: ProjectMilestone;
}) {
  const { links, handlers, side, can, approval } = useProject();
  const state = milestoneState(project, m);
  const staff = side === "org";
  const run = m.status === "submitted" ? approval.deliveries[m.id] : undefined;
  const invoice = milestoneInvoice(project, m);
  const working =
    m.kind === "delivery" &&
    ["pending", "in_progress", "revision"].includes(m.status);
  const lastRejected = [...project.deliveries]
    .reverse()
    .find((d) => d.milestone_id === m.id && d.decision === "rejected");
  const progress = m.status === "done" ? 100 : m.progress;
  const revision =
    m.status === "revision" && lastRejected ? lastRejected.remark : "";
  const rounds = project.deliveries
    .filter((d) => d.milestone_id === m.id)
    .reverse();
  return (
    <section className="card project-milestone" id={`milestone-${m.id}`}>
      <div className="card-header">
        <div>
          <span className="project-seq">
            งวดที่ {m.seq} · {milestoneKindLabels[m.kind]}
          </span>
          <h2>{m.title}</h2>
          <p>
            ครบกำหนด {m.due_date ? date(m.due_date) : "ไม่ได้กำหนด"}
            {Number(m.amount) ? ` · ${baht(m.amount)}` : ""}
          </p>
        </div>
        <span className={`customer-state tone-${state.tone}`}>
          {state.label}
        </span>
      </div>
      <div className="card-body">
        {m.kind === "delivery" && (
          <div className="project-milestone-progress">
            <progress className="project-meter" max={100} value={progress}>
              {progress}%
            </progress>
            <span>{progress}%</span>
          </div>
        )}
        {!staff && m.status === "submitted" && run && !run.ready && (
          <div className="notice project-inspect approval-box">
            <strong>{approvalHeadline(run, "customer")}</strong>
            <span>
              {run.my_turn
                ? "ดูรายละเอียด ไฟล์ และลิงก์ในรอบล่าสุดด้านล่าง แล้วเลือกผ่านการตรวจ หรือส่งกลับแก้ไขพร้อมหมายเหตุ"
                : "งานงวดนี้อยู่ระหว่างตรวจตามขั้นตอนอนุมัติ อนุมัติรับงานได้เมื่อผู้ตรวจทุกขั้นผ่าน"}
            </span>
            <ApprovalSteps run={run} finalLabel="อนุมัติรับงาน" />
            {run.my_turn && (
              <ReviewButtons onReview={(d) => handlers.review?.(m, d)} />
            )}
            {!run.my_turn && can("decide") && (
              <div className="contract-actions">
                <button
                  type="button"
                  className="btn sm subtle"
                  onClick={() => handlers.reject?.(m)}
                >
                  <Icon name="edit" />
                  ส่งกลับแก้ไขเลย
                </button>
              </div>
            )}
          </div>
        )}
        {!staff &&
          m.status === "submitted" &&
          (!run || run.ready) &&
          !can("decide") && (
            <p className="notice">งานงวดนี้รอผู้มีสิทธิ์อนุมัติตรวจรับ</p>
          )}
        {!staff &&
          m.status === "submitted" &&
          (!run || run.ready) &&
          can("decide") && (
            <div className="notice project-inspect">
              <strong>งานงวดนี้รอคุณตรวจรับ</strong>
              <span>
                {run
                  ? `${approvalHeadline(run, "customer")} เลือกอนุมัติรับงาน หรือส่งกลับแก้ไข`
                  : "ดูรายละเอียด ไฟล์ และลิงก์ในรอบล่าสุดด้านล่าง แล้วเลือกอนุมัติรับงาน หรือส่งกลับแก้ไข"}
              </span>
              {run && <ApprovalSteps run={run} finalLabel="อนุมัติรับงาน" />}
              <div className="contract-actions">
                <button
                  type="button"
                  className="btn primary sm"
                  onClick={() => handlers.accept?.(m)}
                >
                  <Icon name="check" />
                  อนุมัติรับงาน
                </button>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => handlers.reject?.(m)}
                >
                  <Icon name="edit" />
                  ส่งกลับแก้ไข
                </button>
              </div>
            </div>
          )}
        {staff && m.status === "submitted" && !run && (
          <p className="notice">ส่งมอบแล้ว รอลูกค้าตรวจรับ</p>
        )}
        {staff && run && (
          <div className="notice project-inspect approval-box">
            <strong>ส่งมอบแล้ว · {approvalHeadline(run, "org")}</strong>
            <ApprovalSteps run={run} finalLabel="ลูกค้าอนุมัติรับงาน" />
          </div>
        )}
        {revision && (
          <p className="project-remark">
            <strong>หมายเหตุจากการตรวจรับ:</strong> {revision}
          </p>
        )}
        {staff && working && (
          <div className="project-work">
            {m.status === "pending" && (
              <button
                type="button"
                className="btn sm"
                onClick={() => handlers.start?.(m)}
              >
                <Icon name="bolt" />
                เริ่มงาน
              </button>
            )}
            {/* Keyed by the saved value so a refresh shows what was saved. */}
            <ProgressForm
              key={`${m.id}-${progress}`}
              m={m}
              progress={progress}
              onSave={handlers.saveProgress}
            />
            <button
              type="button"
              className="btn sm primary"
              onClick={() => handlers.deliver?.(m)}
            >
              <Icon name="send" />
              ส่งมอบให้ตรวจรับ
            </button>
          </div>
        )}
        {staff &&
          Number(m.amount) > 0 &&
          !invoice &&
          (m.kind === "payment" || m.status === "done") && (
            <div>
              <button
                type="button"
                className="btn sm"
                onClick={() => handlers.invoice?.(m)}
              >
                <Icon name="receipt" />
                ออกใบแจ้งหนี้
              </button>
            </div>
          )}
        {!staff && m.kind === "payment" && !invoice && m.status !== "done" && (
          <p className="muted">ทีมงานจะออกใบแจ้งหนี้งวดนี้ตามกำหนดในสัญญา</p>
        )}
        {invoice && (
          <p className="project-invoice-link">
            <Icon name="receipt" />
            <Link href={links.invoice(invoice.id)}>
              {invoice.reference}
            </Link> · {invoiceStatusLabels[invoice.status]}
          </p>
        )}
        {m.done_at && (
          <p className="tiny muted">
            เสร็จสิ้นเมื่อ {date(m.done_at, true)}
            {m.done_by ? ` · ${m.done_by}` : ""}
          </p>
        )}
        {rounds.length > 0 && (
          <>
            <h3 className="contract-subhead">การส่งมอบและตรวจรับ</h3>
            <ol className="project-rounds">
              {rounds.map((d) => (
                <ProjectRound key={d.id} d={d} />
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}

/** The team's progress report on a delivery being worked on (form.project-progress-form). */
function ProgressForm({
  m,
  progress,
  onSave,
}: {
  m: ProjectMilestone;
  progress: number;
  onSave?: ProjectHandlers["saveProgress"];
}) {
  const check = useFieldValidation();
  return (
    <Form
      className="project-progress-form"
      onSubmit={async (values) => {
        await onSave?.(m, Number(values.progress));
      }}
    >
      <label htmlFor={`progress-${m.id}`}>
        ความคืบหน้า (%)
        <RequiredStar />
      </label>
      <input
        id={`progress-${m.id}`}
        name="progress"
        type="number"
        min={0}
        max={100}
        defaultValue={progress}
        required
        {...check.bind}
      />
      <button className="btn sm subtle" type="submit">
        บันทึก
      </button>
      {check.errorNode}
    </Form>
  );
}

export function ProjectMilestones({ project }: { project: Project }) {
  const { side, can, handlers } = useProject();
  return (
    <div className="project-milestones">
      {side === "customer" && (
        <div className="project-help approval-help">
          <p className="muted">
            งวดส่งมอบ: ทีมงานส่งงานให้ตรวจ ผู้ตรวจตามขั้นตอนอนุมัติ (ถ้ามี)
            ตรวจตามลำดับ แล้วผู้มีสิทธิ์อนุมัติเลือกอนุมัติรับงาน
            หรือส่งกลับแก้ไขพร้อมหมายเหตุ
            งวดที่มียอดเงินจะออกใบแจ้งหนี้เมื่ออนุมัติ
          </p>
          {can("team") && handlers.editFlow && (
            <button
              type="button"
              className="btn sm subtle"
              onClick={() => handlers.editFlow?.()}
            >
              <Icon name="listOrdered" />
              ขั้นตอนอนุมัติของโครงการนี้
            </button>
          )}
        </div>
      )}
      {project.milestones.length ? (
        project.milestones.map((m) => (
          <ProjectMilestoneCard key={m.id} project={project} m={m} />
        ))
      ) : (
        <section className="card">
          <div className="card-body">
            <p className="muted">สัญญานี้ไม่มีงวดงาน</p>
          </div>
        </section>
      )}
    </div>
  );
}

export function ProjectBilling({ project }: { project: Project }) {
  const { links, handlers, side } = useProject();
  const b = project.buyer;
  const totals = project.totals;
  // A customer-side viewer without billing gets neither (the tab is hidden for them too).
  if (!b || !totals)
    return (
      <section className="card">
        <EmptyState
          title="ไม่มีสิทธิ์ดูใบแจ้งหนี้"
          description="บทบาทของคุณในโครงการนี้ไม่รวมใบแจ้งหนี้และการชำระเงิน"
          icon="receipt"
        />
      </section>
    );
  return (
    <div className="project-billing">
      <section className="card">
        <div className="card-header">
          <div>
            <h2>ใบแจ้งหนี้และใบเสร็จ</h2>
            <p>
              ออกเมื่อตรวจรับงวดที่มียอดเงิน
              หรือเมื่อทีมออกใบแจ้งหนี้งวดชำระเงิน · ชำระแล้ว{" "}
              {baht(totals.paid)} จาก {baht(totals.billed)}
            </p>
          </div>
          {side === "org" && (
            <Link className="btn sm subtle" href="/settings?tab=billing">
              <Icon name="settings" />
              บัญชีรับเงินและภาษี
            </Link>
          )}
        </div>
        {project.invoices.length ? (
          <div className="table-scroll">
            <table className="project-invoice-table">
              <thead>
                <tr>
                  <th>เลขที่</th>
                  <th>งวด</th>
                  <th>ยอดชำระ</th>
                  <th>ออกเมื่อ</th>
                  <th>ครบกำหนด</th>
                  <th>สถานะ</th>
                  <th>ใบเสร็จ</th>
                </tr>
              </thead>
              <tbody>
                {project.invoices.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <Link
                        className="contract-link"
                        href={links.invoice(i.id)}
                      >
                        {i.reference}
                      </Link>
                    </td>
                    <td>
                      {project.milestones.find((m) => m.id === i.milestone_id)
                        ?.title || ""}
                    </td>
                    <td>{baht(i.total)}</td>
                    <td>{date(i.issued_at)}</td>
                    <td>{date(i.due_date)}</td>
                    <td>
                      <span
                        className={`customer-state tone-${invoiceStatusTones[i.status]}`}
                      >
                        {invoiceStatusLabels[i.status]}
                      </span>
                    </td>
                    <td>{i.receipt_reference || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card-body">
            <p className="muted">ยังไม่มีใบแจ้งหนี้</p>
          </div>
        )}
      </section>
      <section className="card">
        <div className="card-header">
          <div>
            <h2>ข้อมูลผู้ซื้อในใบเสร็จ/ใบกำกับภาษี</h2>
            <p>ใช้กับใบเสร็จที่ออกหลังจากบันทึก</p>
          </div>
          {side === "customer" && (
            <button
              type="button"
              className="btn sm"
              onClick={() => handlers.editBuyer?.()}
            >
              <Icon name="edit" />
              แก้ไข
            </button>
          )}
        </div>
        <dl className="project-facts card-body">
          <div>
            <dt>ชื่อ</dt>
            <dd>{b.name}</dd>
          </div>
          <div>
            <dt>ที่อยู่</dt>
            <dd>{b.address || "-"}</dd>
          </div>
          <div>
            <dt>เลขประจำตัวผู้เสียภาษี</dt>
            <dd>
              {b.tax_id || "-"}
              {b.branch ? ` · ${b.branch}` : ""}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

export function ProjectIssues({ project }: { project: Project }) {
  const { links, handlers, side, can } = useProject();
  const customer = side === "customer";
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>แจ้งปัญหาและขอเปลี่ยนแปลง</h2>
          <p>
            แยกตามงวดงาน · แต่ละรายการเป็นเคสที่ติดตามสถานะได้
            {customer ? " และคุยต่อได้ในแชทของเคส" : ""}
          </p>
        </div>
        {customer && can("issues") && (
          <button
            type="button"
            className="btn sm primary"
            onClick={() => handlers.newIssue?.()}
          >
            <Icon name="plus" />
            แจ้งปัญหา / ขอเปลี่ยนแปลง
          </button>
        )}
      </div>
      {project.issues.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>เคส</th>
                <th>ประเภท</th>
                <th>งวดงาน</th>
                <th>หัวข้อ</th>
                <th>สถานะ</th>
                <th>อัปเดต</th>
              </tr>
            </thead>
            <tbody>
              {project.issues.map((x) => {
                const st = customer
                  ? caseState(x.status)
                  : {
                      label: statusLabels[x.status],
                      tone: ticketStatusTones[x.status],
                    };
                return (
                  <tr key={x.ticket_id}>
                    <td>
                      <Link
                        className="contract-link"
                        href={links.issue(x.ticket_id)}
                      >
                        BD-{x.number}
                      </Link>
                    </td>
                    <td>
                      <span
                        className={`customer-state tone-${x.kind === "bug" ? "waiting" : "working"}`}
                      >
                        {issueKindLabels[x.kind]}
                      </span>
                    </td>
                    <td>
                      {project.milestones.find((m) => m.id === x.milestone_id)
                        ?.title || "ทั้งโครงการ"}
                    </td>
                    <td>{x.subject}</td>
                    <td>
                      <span className={`customer-state tone-${st.tone}`}>
                        {st.label}
                      </span>
                    </td>
                    <td>{relative(x.updated_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card-body">
          <p className="muted">
            ยังไม่มีการแจ้งปัญหาหรือขอเปลี่ยนแปลง
            {customer
              ? " · พบข้อผิดพลาด หรืออยากได้สิ่งที่อยู่นอกเหนือ TOR กดปุ่มด้านบนได้เลย"
              : ""}
          </p>
        </div>
      )}
    </section>
  );
}

export function ProjectWarranty({ project }: { project: Project }) {
  const { links, handlers, side, can } = useProject();
  const c = project.coverage;
  const summary = coverageSummary(project);
  const customer = side === "customer";
  const active = c.state === "active";
  const elapsed = c.total_days
    ? Math.round((100 * (c.total_days - (c.days_left ?? 0))) / c.total_days)
    : 0;
  const isMA = Boolean(project.renews);
  const requested = project.ma_requested_at
    ? date(project.ma_requested_at, true)
    : "";
  return (
    <div className="project-warranty">
      <section className={`card warranty-card tone-${summary.tone}`}>
        <div className="card-body">
          <span className="muted">
            {isMA ? "ระยะบริการ MA" : "การรับประกันและดูแลหลังการขาย"}
          </span>
          {active && (
            <p className="warranty-days">
              <strong>{c.days_left}</strong> วัน
            </p>
          )}
          <h2>{summary.title}</h2>
          <p>{summary.text}</p>
          {active && (
            <progress
              className="project-meter"
              max={100}
              value={elapsed}
              aria-label={`ใช้ระยะดูแลไปแล้ว ${elapsed}%`}
            >
              {elapsed}%
            </progress>
          )}
        </div>
      </section>
      <section className="card">
        <div className="card-header">
          <div>
            <h2>เงื่อนไขการดูแล (SLA)</h2>
            <p>
              ตามที่ตกลงในสัญญา
              {project.warranty_days
                ? ` · ระยะ ${project.warranty_days} วัน`
                : ""}
            </p>
          </div>
        </div>
        <div className="card-body article-content">
          {project.support_terms ? (
            <MarkdownBlocks text={project.support_terms} />
          ) : (
            <p className="muted">สัญญานี้ไม่ได้ระบุเงื่อนไขเพิ่มเติม</p>
          )}
        </div>
      </section>
      <section className="card">
        <div className="card-header">
          <div>
            <h2>สัญญาบำรุงรักษา (MA)</h2>
            <p>
              ต่อการดูแลหลังหมดระยะรับประกัน
              โดยเริ่มต่อจากวันสิ้นสุดเดิมไม่มีช่วงขาด
            </p>
          </div>
          {customer &&
            can("decide") &&
            Boolean(project.delivered_at) &&
            !project.ma_requested_at &&
            !isMA && (
              <button
                type="button"
                className="btn sm primary"
                onClick={() => handlers.requestMA?.()}
              >
                <Icon name="restore" />
                ขอต่อสัญญา MA
              </button>
            )}
          {!customer && Boolean(project.delivered_at) && !isMA && (
            <button
              type="button"
              className="btn sm primary"
              onClick={() => handlers.createMA?.()}
            >
              <Icon name="plus" />
              สร้างสัญญา MA
            </button>
          )}
        </div>
        {requested && (
          <p className="notice project-inset">
            {customer
              ? `ส่งคำขอต่อ MA แล้วเมื่อ ${requested} ทีมงานจะส่งสัญญาให้ตรวจและลงนามในเมนูสัญญาและโครงการ`
              : `ลูกค้าขอต่อสัญญา MA เมื่อ ${requested} · กด “สร้างสัญญา MA” เพื่อร่างจากแม่แบบ`}
          </p>
        )}
        {!project.delivered_at && !isMA && (
          <p className="card-body muted">ขอต่อ MA ได้หลังส่งมอบงานครบทุกงวด</p>
        )}
        {project.renews && (
          <p className="card-body">
            สัญญานี้ต่อการดูแลของ{" "}
            <Link href={links.contract(project.renews.id)}>
              {project.renews.reference}
            </Link>{" "}
            · ขอต่อครั้งถัดไปได้จากหน้าโครงการหลัก
          </p>
        )}
        {project.renewals.length > 0 && (
          <ul className="project-renewals">
            {project.renewals.map((r) => (
              <li key={r.id}>
                <Link className="contract-link" href={links.contract(r.id)}>
                  {r.reference} · {r.title}
                </Link>
                <span className="muted">
                  {r.coverage_end
                    ? `${longDate(r.coverage_start)} – ${longDate(r.coverage_end)}`
                    : "ระยะบริการเริ่มเมื่อลงนามครบ"}
                </span>
                <span
                  className={`customer-state tone-${contractStatusTones[r.status]}`}
                >
                  {contractStatusLabels[r.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function ProjectDocument({
  data,
  org,
}: {
  data: SignedContract;
  org: string;
}) {
  const { links, side } = useProject();
  const c = data.contract;
  const staff = side === "org";
  return (
    <div className="contract-layout">
      <div className="contract-main">
        <section className="card contract-view">
          <ContractDocument data={data} orgName={org} filePath={links.file} />
        </section>
      </div>
      <aside className="contract-side no-print">
        <section className="card">
          <div className="card-body">
            <PrintButton className="btn" />
          </div>
        </section>
        <section className="card">
          <div className="card-header">
            <h2>เวอร์ชัน</h2>
          </div>
          <ol className="contract-versions">
            <ContractVersionRows versions={data.versions} current={c.version} />
          </ol>
        </section>
        {staff && c.conversation_id && (
          <section className="card">
            <div className="card-header">
              <h2>แชทของเอกสาร</h2>
            </div>
            <div className="card-body">
              <Link className="btn" href={`/inbox/${c.conversation_id}`}>
                <Icon name="chat" />
                เปิดแชทกับลูกค้า
              </Link>
            </div>
          </section>
        )}
        <section className="card">
          <div className="card-header">
            <div>
              <h2>{staff ? "Audit trail" : "ความเคลื่อนไหว"}</h2>
              {staff && <p>ทุกขั้นตอน พร้อมเวลาและ IP สำหรับกรณีข้อพิพาท</p>}
            </div>
          </div>
          <ol className="contract-events">
            <ContractEventRows events={data.events} withIp={staff} />
          </ol>
        </section>
      </aside>
    </div>
  );
}
