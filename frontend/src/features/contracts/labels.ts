import { longDate } from "@/lib/format";
import type {
  ContractRow,
  Coverage,
  InvoiceStatus,
  InvoiceView,
  MilestoneStatus,
  Project,
  ProjectMilestone,
} from "./types";

/* Thai words for contract, project and invoice values, and the small sentences built from them, for both sides. */

export const contractKindLabels: Record<string, string> = {
  contract: "สัญญา",
  tor: "TOR",
};

export const contractStatusLabels: Record<string, string> = {
  draft: "ร่างเอกสาร",
  review: "รอลูกค้าตรวจและลงนาม",
  changes: "กำลังแก้ไขเป็นเวอร์ชันใหม่",
  awaiting_org: "รอผู้รับจ้างลงนาม",
  completed: "ลงนามครบ อนุมัติเรียบร้อย",
  cancelled: "ยกเลิกแล้ว",
};

/** Tone classes of .customer-state / .customer-banner (tone-received, tone-waiting, tone-working, tone-done, tone-cancelled). */
export type Tone = "received" | "waiting" | "working" | "done" | "cancelled";

export const contractStatusTones: Record<string, Tone> = {
  draft: "received",
  review: "waiting",
  changes: "received",
  awaiting_org: "working",
  completed: "done",
  cancelled: "cancelled",
};

export const contractEventLabels: Record<string, string> = {
  created: "สร้างเอกสาร",
  sent: "ส่งให้ลูกค้าตรวจ",
  viewed: "ลูกค้าเปิดอ่าน",
  change_requested: "ลูกค้าขอแก้ไขเงื่อนไข",
  revised: "เริ่มแก้ไขเวอร์ชันใหม่",
  signed: "ลูกค้าลงนาม",
  countersigned: "ผู้รับจ้างลงนาม",
  completed: "ปิดผนึกเอกสาร",
  cancelled: "ยกเลิกเอกสาร",
  started: "เริ่มดำเนินงานงวด",
  delivered: "ส่งมอบงานให้ตรวจรับ",
  accepted: "ลูกค้าอนุมัติรับงาน",
  rejected: "ลูกค้าส่งกลับแก้ไข",
  invoiced: "ออกใบแจ้งหนี้",
  slip_uploaded: "ลูกค้าแนบสลิปการชำระเงิน",
  slip_rejected: "สลิปไม่ผ่านการตรวจ",
  paid: "ยืนยันรับชำระเงิน ออกใบเสร็จ",
  invoice_void: "ยกเลิกใบแจ้งหนี้",
  coverage_started: "เริ่มระยะรับประกัน",
  issue_opened: "ลูกค้าแจ้งปัญหา/ขอเปลี่ยนแปลง",
  ma_requested: "ลูกค้าขอต่อสัญญา MA",
  renewed: "ต่อสัญญา MA แล้ว",
};

export const signatureVerifiedLabels: Record<string, string> = {
  email: "ยืนยันตัวตนด้วยรหัส OTP ทางอีเมล",
  password: "ยืนยันตัวตนด้วยรหัสผ่านบัญชี",
};

export const milestoneKindLabels: Record<string, string> = {
  delivery: "ส่งมอบงาน",
  payment: "ชำระเงิน",
};

export const milestoneStatusLabels: Record<string, string> = {
  pending: "ยังไม่เริ่ม",
  in_progress: "กำลังดำเนินงาน",
  submitted: "รอตรวจรับ",
  revision: "ส่งกลับแก้ไข",
  done: "เสร็จสิ้น",
};

export const milestoneStatusTones: Record<MilestoneStatus, Tone> = {
  pending: "received",
  in_progress: "working",
  submitted: "waiting",
  revision: "waiting",
  done: "done",
};

export const invoiceStatusLabels: Record<string, string> = {
  unpaid: "รอชำระ",
  submitted: "รอตรวจสลิป",
  paid: "ชำระแล้ว",
  void: "ยกเลิกแล้ว",
};

export const invoiceStatusTones: Record<InvoiceStatus, Tone> = {
  unpaid: "waiting",
  submitted: "working",
  paid: "done",
  void: "cancelled",
};

export const issueKindLabels: Record<string, string> = {
  bug: "แจ้งปัญหา (Bug)",
  change: "ขอเปลี่ยนแปลง",
};

/** Case statuses as tones, for the team's list of a project's issues. */
export const ticketStatusTones: Record<string, Tone> = {
  new: "received",
  open: "working",
  pending_customer: "waiting",
  pending_internal: "working",
  resolved: "done",
  closed: "done",
};

export const roundLabels: Record<string, string> = {
  pending: "รอตรวจรับ",
  accepted: "อนุมัติรับงานแล้ว",
  rejected: "ส่งกลับแก้ไข",
};
export const roundTones: Record<string, Tone> = {
  pending: "waiting",
  accepted: "done",
  rejected: "waiting",
};

export const projectTabLabels = {
  board: "ภาพรวมโครงการ",
  milestones: "งวดงานและตรวจรับ",
  billing: "ใบแจ้งหนี้/ใบเสร็จ",
  issues: "แจ้งปัญหา/ขอเปลี่ยนแปลง",
  warranty: "รับประกันและ MA",
  document: "เอกสารสัญญา",
} as const;

export type ProjectTab = keyof typeof projectTabLabels;

export const isProjectTab = (
  tab: string | null | undefined,
): tab is ProjectTab => Boolean(tab && tab in projectTabLabels);

/** The pills of the team's contract list; 'todo' is what waits for the team. */
export const contractFilters: Record<string, string> = {
  "": "ทั้งหมด",
  todo: "ต้องดำเนินการ",
  draft: "ร่าง",
  review: "รอลูกค้า",
  changes: "กำลังแก้ไข",
  awaiting_org: "รอเราลงนาม",
  completed: "เสร็จแล้ว",
  cancelled: "ยกเลิก",
};

/** A milestone amount in a draft: "15,000 บาท" (no forced decimals), '-' when empty. */
export function amountText(value: string | number | null | undefined): string {
  return value
    ? `${Number(value).toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`
    : "-";
}

/** What waits for the team on one document, in a few words ('' when nothing does). */
export function contractTodoText(c: ContractRow): string {
  const items: string[] = [];
  if (c.status === "awaiting_org") items.push("รอเราลงนาม");
  if (c.slips_waiting) items.push(`สลิปรอตรวจ ${c.slips_waiting}`);
  if (c.revisions) items.push(`ส่งกลับแก้ไข ${c.revisions}`);
  if (c.open_issues) items.push(`ปัญหาที่เปิดอยู่ ${c.open_issues}`);
  if (c.ma_requested_at) items.push("ลูกค้าขอต่อ MA");
  return items.join(" · ");
}

export const isDoneIssue = (status: string) =>
  ["resolved", "closed"].includes(status);

export function milestoneInvoice(project: Project, m: ProjectMilestone) {
  return project.invoices.find(
    (i) => i.milestone_id === m.id && i.status !== "void",
  );
}

/** A payment milestone stands where its invoice stands; a delivery where its work stands. */
export function milestoneState(
  project: Project,
  m: ProjectMilestone,
): { label: string; tone: Tone } {
  if (m.kind === "payment") {
    const invoice = milestoneInvoice(project, m);
    if (m.status === "done") return { label: "ชำระแล้ว", tone: "done" };
    return invoice
      ? {
          label: invoiceStatusLabels[invoice.status],
          tone: invoiceStatusTones[invoice.status],
        }
      : { label: "รอออกใบแจ้งหนี้", tone: "received" };
  }
  return {
    label: milestoneStatusLabels[m.status],
    tone: milestoneStatusTones[m.status],
  };
}

/** The line under a project's title. */
export function projectStatus(project: Project): { text: string; tone: Tone } {
  const c = project.coverage;
  if (project.renews)
    return c.state === "active"
      ? { text: `สัญญา MA · ดูแลอีก ${c.days_left} วัน`, tone: "done" }
      : c.state === "expired"
        ? { text: "สัญญา MA หมดระยะแล้ว", tone: "cancelled" }
        : { text: "สัญญา MA ลงนามครบแล้ว", tone: "working" };
  if (!project.delivered_at)
    return {
      text: `กำลังดำเนินโครงการ · คืบหน้า ${project.progress}%`,
      tone: "working",
    };
  if (c.state === "active")
    return {
      text: `ส่งมอบครบแล้ว · ${c.renewed ? "ดูแลตามสัญญา MA" : "อยู่ในระยะรับประกัน"} อีก ${c.days_left} วัน`,
      tone: "done",
    };
  if (c.state === "expired")
    return { text: "ส่งมอบครบแล้ว · หมดระยะดูแล", tone: "cancelled" };
  return { text: "ส่งมอบครบแล้ว", tone: "done" };
}

export function coverageSummary(project: Project): {
  title: string;
  text: string;
  tone: Tone;
} {
  const c: Coverage = project.coverage;
  const what = project.renews ? "ระยะบริการ MA" : "ระยะรับประกัน";
  if (c.state === "waiting")
    return {
      title: "ยังไม่เริ่มนับ",
      text: `${what} ${project.warranty_days} วัน เริ่มนับเมื่อตรวจรับงวดส่งมอบสุดท้าย`,
      tone: "received",
    };
  if (c.state === "none")
    return {
      title: "ไม่มีระยะรับประกัน",
      text: "สัญญานี้ไม่ได้กำหนดระยะรับประกัน",
      tone: "received",
    };
  if (c.state === "expired")
    return {
      title: "หมดระยะดูแลแล้ว",
      text: `สิ้นสุดเมื่อ ${longDate(c.end)} ขอต่อสัญญา MA เพื่อรับการดูแลต่อ`,
      tone: "cancelled",
    };
  return {
    title: c.renewed
      ? `ดูแลตามสัญญา MA อีก ${c.days_left} วัน`
      : `เหลือเวลาดูแลฟรีอีก ${c.days_left} วัน`,
    text: `${longDate(c.start)} ถึง ${longDate(c.end)}`,
    tone: (c.days_left ?? 0) <= 30 ? "waiting" : "done",
  };
}

export function receiptTitle(data: InvoiceView): string {
  return data.seller.vat ? "ใบเสร็จรับเงิน/ใบกำกับภาษี" : "ใบเสร็จรับเงิน";
}
