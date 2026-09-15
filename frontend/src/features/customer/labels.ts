import { baht, date } from '@/lib/format';
import { caseState, customerStates, type CustomerState } from '@/lib/labels';
import type { CustomerOrg } from '@/lib/types';
import type { CaseFields, CustomerAlert, CustomerChat, CustomerContract, PortalSession } from './types';

/* The customer's words for what the team is doing. The case states themselves live in lib/labels (caseState), since
   the contracts' project issues use them too; they are re-exported here for the customer screens. */

export { caseState, customerStates, type CustomerState, type CustomerTone } from '@/lib/labels';

/** A chat that is not part of a case is "received" until the team closes it. */
export function chatState(c: Pick<CustomerChat, 'ticket_status' | 'status'>): CustomerState {
  return c.ticket_status ? caseState(c.ticket_status) : c.status === 'closed' ? customerStates.done : customerStates.received;
}

/** The same for the open chat (GET /api/public/<org>/session). */
export function chatView(data: PortalSession): CustomerState {
  return data.ticket ? caseState(data.ticket.status) : data.conversation.status === 'closed' ? customerStates.done : customerStates.received;
}

/** "ภายใน 4 ชั่วโมง" reads as a promise; a half-hour setting still has to read properly. */
export function replyPromise(org: Pick<CustomerOrg, 'response_hours'> | undefined): string {
  const hours = Number(org?.response_hours);
  if (!Number.isFinite(hours) || hours <= 0) return '';
  return hours < 1
    ? `${Math.round(hours * 60)} นาที`
    : hours >= 24 && hours % 24 === 0
      ? `${hours / 24} วัน`
      : `${Number.isInteger(hours) ? hours : hours.toFixed(1)} ชั่วโมง`;
}

export const ratingLabels: Record<number, string> = { 1: 'ไม่พอใจ', 2: 'ไม่ค่อยพอใจ', 3: 'เฉย ๆ', 4: 'พอใจ', 5: 'พอใจมาก' };

/** The cases' groups: '' all, open (not done yet), waiting (for the customer), done. */
export type CaseGroup = '' | 'open' | 'waiting' | 'done';
export const caseGroups: CaseGroup[] = ['', 'open', 'waiting', 'done'];

export function caseInGroup(t: Pick<CaseFields, 'status'>, key: CaseGroup): boolean {
  const tone = caseState(t.status).tone;
  return !key || (key === 'open' ? tone !== 'done' : tone === key);
}

/** What the team promised next, or when it finished. */
export function caseDueText(t: CaseFields): string {
  if (caseState(t.status).tone === 'done') return `เสร็จเมื่อ ${date(t.resolved_at || t.updated_at, true)}`;
  if (t.next_followup_at) return `ทีมงานนัดติดตาม ${date(t.next_followup_at, true)}`;
  if (!t.first_response_at) return `ตอบครั้งแรกภายใน ${date(t.first_response_due_at, true)}`;
  return `กำหนดเสร็จภายใน ${date(t.resolution_due_at, true)}`;
}

/** The documents' groups: waiting (for the customer to sign), open (not finished), done (signed by both). */
export function documentInGroup(c: Pick<CustomerContract, 'status'>, key: string): boolean {
  return !key || (key === 'waiting' ? c.status === 'review' : key === 'done' ? c.status === 'completed' : c.status !== 'completed' && c.status !== 'cancelled');
}

export const documentGroups: Array<[string, string]> = [
  ['', 'ทั้งหมด'],
  ['waiting', 'รอฉันตรวจและลงนาม'],
  ['open', 'ยังไม่เสร็จ'],
  ['done', 'ลงนามครบแล้ว'],
];

export const billingGroups: Record<string, string> = { '': 'ทั้งหมด', unpaid: 'รอชำระ', submitted: 'รอตรวจสลิป', paid: 'ชำระแล้ว' };

type AlertKindView = { icon: string; tone: string; title: (a: CustomerAlert) => string; detail: (a: CustomerAlert) => string; href: (a: CustomerAlert) => string };

const chatHref = (a: CustomerAlert) => `/customer/chats/${a.org_slug}/${a.conversation_id}`;
const caseHref = (a: CustomerAlert) => `/customer/cases/${a.org_slug}/${a.case_id}`;
const documentHref = (a: CustomerAlert, tab = '') => `/customer/documents/${a.org_slug}/${a.contract_id}${tab ? `?tab=${tab}` : ''}`;

/** การแจ้งเตือน: the icon, tone, words and link of each kind of alert. */
export const alertKinds: Record<CustomerAlert['kind'], AlertKindView> = {
  reply: { icon: 'chat', tone: 'new', title: (a) => `${a.org_name} ตอบกลับแล้ว`, detail: (a) => a.subject, href: chatHref },
  survey: { icon: 'star', tone: 'new', title: (a) => `ช่วยให้คะแนนการบริการของ ${a.org_name}`, detail: (a) => a.subject, href: chatHref },
  waiting: { icon: 'clock', tone: 'waiting', title: (a) => `${a.org_name} รอข้อมูลจากคุณ · BD-${a.number}`, detail: (a) => a.subject, href: caseHref },
  done: {
    icon: 'checkCircle',
    tone: 'done',
    title: (a) => `เคส BD-${a.number} ของ ${a.org_name} ดำเนินการเรียบร้อยแล้ว`,
    detail: (a) => a.subject,
    href: caseHref,
  },
  contract: {
    icon: 'file',
    tone: 'waiting',
    title: (a) => `${a.org_name} ส่ง ${a.reference} ให้คุณตรวจและลงนาม`,
    detail: (a) => a.subject,
    href: (a) => documentHref(a),
  },
  contract_done: { icon: 'checkCircle', tone: 'done', title: (a) => `${a.reference} ลงนามครบแล้ว`, detail: (a) => a.subject, href: (a) => documentHref(a) },
  delivery: {
    icon: 'send',
    tone: 'waiting',
    title: (a) => `${a.org_name} ส่งมอบงานให้คุณตรวจรับ · ${a.reference}`,
    detail: (a) => a.subject,
    href: (a) => documentHref(a, 'milestones'),
  },
  invoice: {
    icon: 'receipt',
    tone: 'waiting',
    title: (a) => `ใบแจ้งหนี้ ${a.reference} รอชำระ ${baht(a.total)}`,
    detail: (a) => `${a.subject} · ครบกำหนด ${date(a.due_date)}`,
    href: (a) => `/customer/billing/${a.org_slug}/${a.invoice_id}`,
  },
  receipt: {
    icon: 'checkCircle',
    tone: 'done',
    title: (a) => `${a.org_name} ยืนยันรับชำระ ${a.reference} แล้ว`,
    detail: (a) => `ดาวน์โหลดใบเสร็จได้ · ${a.subject}`,
    href: (a) => `/customer/billing/${a.org_slug}/${a.invoice_id}?view=receipt`,
  },
  warranty: {
    icon: 'shield',
    tone: 'waiting',
    title: (a) => `การรับประกัน ${a.reference} จะหมดใน ${a.days_left} วัน`,
    detail: (a) => `${a.subject} · ขอต่อสัญญา MA ได้`,
    href: (a) => documentHref(a, 'warranty'),
  },
  followup: {
    icon: 'calendar',
    tone: 'plan',
    title: (a) => `${a.org_name} นัดติดตามเคส BD-${a.number}`,
    detail: (a) => `${date(a.at, true)} · ${a.subject}`,
    href: caseHref,
  },
};
