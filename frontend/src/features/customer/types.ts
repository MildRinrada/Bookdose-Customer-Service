import type { AiState } from '@/features/ai/types';
import type { ContractKind, ContractStatus, Coverage, InvoiceStatus } from '@/features/contracts/types';
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

/** A row of overview.contracts: a contract or TOR sent to the customer at least once. */
export type CustomerContract = OrgLabel & {
  id: string;
  number: number;
  kind: ContractKind;
  title: string;
  status: ContractStatus;
  version: string;
  updated_at: string;
  completed_at: string | null;
  renews_id: string | null;
  delivered_at: string | null;
  coverage_start: string | null;
  coverage_end: string | null;
  ma_requested_at: string | null;
  progress: number | null;
  coverage: Coverage | null;
  reference: string;
};

/** A row of overview.invoices (void ones are left out by the server). */
export type CustomerInvoice = OrgLabel & {
  id: string;
  contract_id: string;
  milestone_id: string;
  number: number;
  total: string;
  status: InvoiceStatus;
  issued_at: string;
  due_date: string;
  paid_at: string | null;
  receipt_number: number | null;
  contract_number: number;
  kind: ContractKind;
  title: string;
  milestone_title: string;
  reference: string;
  receipt_reference: string;
  contract_reference: string;
};

/** A row of overview.deliveries: work waiting for the customer to inspect. */
export type CustomerDelivery = OrgLabel & {
  milestone_id: string;
  title: string;
  submitted_at: string;
  contract_id: string;
  number: number;
  kind: ContractKind;
  contract_title: string;
  reference: string;
};

export type AlertKind =
  | 'reply'
  | 'survey'
  | 'waiting'
  | 'done'
  | 'followup'
  | 'contract'
  | 'contract_done'
  | 'delivery'
  | 'invoice'
  | 'receipt'
  | 'warranty';

/** A row of overview.alerts; which ids are set depends on the kind. */
export type CustomerAlert = OrgLabel & {
  kind: AlertKind;
  /** Waits for the customer (counted on the bell). */
  action: boolean;
  at: string;
  subject: string;
  conversation_id?: string;
  case_id?: string;
  number?: number;
  contract_id?: string;
  reference?: string;
  invoice_id?: string;
  total?: string;
  due_date?: string;
  days_left?: number;
};

/** GET /api/customer/overview */
export type OverviewData = {
  conversations: CustomerChat[];
  cases: CustomerCase[];
  contracts: CustomerContract[];
  invoices: CustomerInvoice[];
  deliveries: CustomerDelivery[];
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
