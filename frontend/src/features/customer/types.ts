import type { AiState } from '@/features/ai/types';
import type { Message } from '@/features/inbox/types';
import type { CustomerTone } from '@/lib/labels';

/* Shapes of the customer's API answers (backend/modules/customers and portal), snake_case as the server sends them. */

/** Every row of the overview says which organization it belongs to. */
export type OrgLabel = { org_slug: string; org_name: string };

/** A row of overview.conversations: one of the customer's web chats. */
export type CustomerChat = OrgLabel & {
  id: string;
  subject: string;
  status: string;
  created_at: string;
  updated_at: string;
  ticket_id: string | null;
  ticket_number: number | null;
  ticket_status: string | null;
  category: string | null;
  /** Kind of the newest message the customer can see ('customer' | 'reply'). */
  last_kind: string | null;
  last_body: string | null;
  survey_pending: boolean;
  seen_at: string | null;
};

/** A case as the customer may see it (no priority, team, assignee or notes). */
export type CaseFields = {
  id: string;
  number: number;
  subject: string;
  category: string;
  status: string;
  created_at: string;
  updated_at: string;
  first_response_due_at: string;
  first_response_at: string | null;
  resolution_due_at: string;
  resolved_at: string | null;
  next_followup_at: string | null;
};

export type CustomerCase = CaseFields & OrgLabel;

export type AlertKind = 'reply' | 'survey' | 'waiting' | 'done' | 'followup' | 'issue';

/** A row of overview.alerts; which ids are set depends on the kind. */
export type CustomerAlert = OrgLabel & {
  kind: AlertKind;
  /** Waits for the customer (counted on the bell). */
  action: boolean;
  /** The words of the alert's button (what the customer does next). */
  action_label: string;
  at: string;
  subject: string;
  conversation_id?: string;
  case_id?: string;
  number?: number;
  /** 'issue': the known issue the customer followed, now fixed. */
  issue_id?: string;
};

/** A notification event with the channels it goes to (GET /api/customer/notification-settings). */
export type NotifyEvent = { key: string; label: string; email: boolean; line: boolean };

/** An organization whose LINE can send notices, or that the account is linked with. */
export type LineOrg = OrgLabel & {
  available: boolean;
  linked: boolean;
  linked_at: string | null;
  oa_name: string;
};

/** GET /api/customer/notification-settings */
/** ช่วงเวลาห้ามรบกวน (backend customers/notify.py): no email or LINE from start to end (Thai time, HH:MM); what falls
    due meanwhile goes out when it ends. */
export type QuietHours = { enabled: boolean; start: string; end: string };

/** The page's own alerts while it is open: a pop-up when the team answers, and a sound with it. */
export type PageAlerts = { popup: boolean; sound: boolean };

export type NotificationSettings = {
  events: NotifyEvent[];
  email: { ready: boolean; verified: boolean; address: string };
  line: LineOrg[];
  quiet?: QuietHours;
  /** Absent from a server older than the choice: both on. */
  page?: PageAlerts;
};

/** GET /api/public/<org>/line */
export type LineStatus = {
  available: boolean;
  linked: boolean;
  linked_at: string | null;
  oa_name: string;
  code_expires_at: string | null;
};

/** POST /api/public/<org>/line: a 6-digit code to send to the organization's LINE in a 1:1 chat (10 minutes). */
export type LineCode = { code: string; expires_at: string; oa_name: string };

/** GET /api/customer/overview */
export type OverviewData = {
  conversations: CustomerChat[];
  cases: CustomerCase[];
  alerts: CustomerAlert[];
  alert_count: number;
};

/** The satisfaction survey of a chat: one to answer, or the rating already given. */
export type PortalSurvey = { pending: boolean; rating: number | null; comment: string | null };

/** GET /api/public/<org>/session (the chat named by X-Conversation-ID). */
export type PortalSession = {
  conversation: { id: string; subject: string; status: string };
  messages: Message[];
  ticket: { id: string; number: number; status: string } | null;
  ai: AiState | null;
  survey: PortalSurvey | null;
  /** When the team last opened the chat after the customer wrote, for "อ่านแล้ว". */
  staff_read_at?: string | null;
  /** While the customer waits for the team: their place and the expected wait (conversations/queue.py). */
  queue?: PortalQueue | null;
  line?: PortalLine | null;
  /** การ์ดขอบคุณ of the finished case (backend automation/thanks.py), when the organization gives one. */
  thanks?: ThanksCardData | null;  /** ขอให้ติดต่อกลับ (backend portal/callback.py): the request waiting, the times to pick from, whether LINE is there. */
  callback?: CallbackState;
};

/** start / end: UTC ISO; day (YYYY-MM-DD) and label ("09:00-12:00") in Thai time. */
export type CallbackSlot = { start: string; end: string; day: string; label: string };
export type CallbackRequest = { id: string; method: 'phone' | 'line'; phone: string; start: string; end: string; note: string };
export type CallbackState = { waiting: CallbackRequest | null; slots: CallbackSlot[]; line_ready: boolean; phone: string };

/** แบบฟอร์มตามหมวดเรื่อง: a case field the start form asks for (categories [] = every category). */
export type StartField = { id: string; name: string; kind: 'text' | 'number' | 'date' | 'select' | 'checkbox'; options: string[]; categories: string[] };

/** Who looked after the case, as the customer sees them: the name on their replies, whether their photo is shown
    (else their initials), the thank-you (theirs, or the organization's), and whether the customer sent a heart back. */
export type ThanksCardData = { id: string; name: string; photo: boolean; message: string; case: number; created_at: string; hearted: boolean };

/** The customer's place in the team's queue; wait_minutes null when there is nothing to go by, away when nobody who
    could answer is available now. */
/** ไม่รีบ (backend portal/no_rush.py): the reply promised by (UTC ISO) and the same in words ("พรุ่งนี้ 18:00 น."). */
export type NoRush = { until: string; text: string };

export type PortalQueue = { position: number; wait_minutes: number | null; away: boolean; no_rush?: NoRush | null };

/** ขอคนเดิม (backend portal/same_member.py): the member of the customer's last case, as the start form offers them. */
export type LastMember = { name: string; finished_at: string };

/** ขอคนเดิม after starting: whether that member took the chat. */
export type AskedMember = { name: string; given: boolean };

/** Whether the chat can go on in the organization's LINE, or went there (channels/move.py). open_url opens the chat
    with the organization's LINE ('' when it has not set its LINE ID). */
export type PortalLine = { moved: boolean; oa_name: string; open_url: string; code_expires_at?: string | null };

/** POST .../line/continue: the code to send, and links that open LINE with it typed in / add the account. */
export type LineMoveCode = { code: string; expires_at: string; oa_name: string; send_url: string; add_url: string };

/** GET /api/public/<org>/cases/<id> */
export type CaseDetail = {
  case: CaseFields;
  conversations: Array<{ id: string; subject: string; status: string; updated_at: string }>;
  /** When the team plans to get back to the customer. */
  followups: string[];
  rating: number | null;
  /** ยังไม่หาย: whether the finished case can be sent back now, and until when (signed-in customers only). */
  reopen?: { allowed: boolean; until: string | null; days: number };
  /** แก้ไขแล้ว: whether the customer can finish the case now (signed-in customers only). */
  resolve?: { allowed: boolean };
  /** เส้นทางเคส: each step it reached and when, oldest first (backend tickets/journey.py). */
  journey: CaseJourneyStep[];
};

/** One step of a case as its customer reads it (lib/labels caseState). */
export type CaseJourneyStep = { state: CustomerTone; at: string };

/** A row of GET /api/customer/faq: a public article of an organization the customer can contact. */
export type CustomerArticle = OrgLabel & {
  id: string;
  title: string;
  category: string;
  body: string;
  updated_at: string;
  global?: boolean;
};
