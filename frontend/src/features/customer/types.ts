import type { AiState } from '@/features/ai/types';
import type { Message } from '@/features/inbox/types';

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

export type AlertKind = 'reply' | 'survey' | 'waiting' | 'done' | 'followup';

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
export type NotificationSettings = {
  events: NotifyEvent[];
  email: { ready: boolean; verified: boolean; address: string };
  line: LineOrg[];
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
};

/** GET /api/public/<org>/cases/<id> */
export type CaseDetail = {
  case: CaseFields;
  conversations: Array<{ id: string; subject: string; status: string; updated_at: string }>;
  /** When the team plans to get back to the customer. */
  followups: string[];
  rating: number | null;
};

/** A row of GET /api/customer/faq: a public article of an organization the customer can contact. */
export type CustomerArticle = OrgLabel & {
  id: string;
  title: string;
  category: string;
  body: string;
  updated_at: string;
  global?: boolean;
};
