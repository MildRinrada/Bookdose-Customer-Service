/* Shapes of backend/modules/contracts answers (service._view, project.view, project.invoice_view), snake_case as sent. */

export type ContractKind = "contract" | "tor";
export type ContractStatus =
  "draft" | "review" | "changes" | "awaiting_org" | "completed" | "cancelled";
export type MilestoneKind = "delivery" | "payment";
export type MilestoneStatus =
  "pending" | "in_progress" | "submitted" | "revision" | "done";
export type InvoiceStatus = "unpaid" | "submitted" | "paid" | "void";
export type Party = "org" | "customer" | "system";

/** What a person of the customer side may do on a contract (backend client_team/access.py). */
export type Capability =
  "documents" | "billing" | "review" | "decide" | "issues" | "team";
/** 'owner' is the account the contract was sent to; the others are members of the owner's team. */
export type ClientRole = "owner" | "manager" | "approver" | "finance" | "technical";

/** The viewer's role on a contract (customer view only). */
export type ContractAccess = {
  role: ClientRole;
  role_label: string;
  can: Capability[];
  owner_name: string;
};

export type Coverage = {
  state: "none" | "waiting" | "active" | "expired";
  start: string | null;
  end: string | null;
  days_left: number | null;
  total_days: number | null;
  renewed: boolean;
};

/** A row of GET /api/contracts. */
export type ContractRow = {
  id: string;
  number: number;
  kind: ContractKind;
  title: string;
  status: ContractStatus;
  version: string | null;
  reference: string;
  customer_name: string;
  customer_email: string;
  updated_at: string;
  next_due: string | null;
  slips_waiting: number;
  revisions: number;
  open_issues: number;
  ma_requested_at: string | null;
  progress: number | null;
  coverage: Coverage | null;
} & Record<string, unknown>;

export type ContractInfo = {
  id: string;
  number: number;
  kind: ContractKind;
  title: string;
  status: ContractStatus;
  /** The latest sent version ('' / null while only a draft exists). */
  version: string | null;
  account_id: string;
  customer_name: string;
  customer_email: string;
  conversation_id: string | null;
  document_hash: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  reference: string;
};

/** A milestone as written in the document (before signing). */
export type DocumentMilestone = {
  kind: MilestoneKind;
  title: string;
  due_date: string;
  amount: string;
};

export type ContractVersionDocument = {
  version: string;
  body: string;
  milestones: DocumentMilestone[];
  warranty_days: number;
  support_terms: string;
  note: string;
  sent_at: string | null;
  editable: boolean;
};

export type ContractFile = {
  id: string;
  name: string;
  mime?: string;
  size: number;
  sha256?: string;
};

export type Signature = {
  party: "org" | "customer";
  signer_name: string;
  signer_email: string;
  method: "draw" | "type" | "upload";
  mark: string;
  verified_by: "email" | "password";
  signed_at: string;
  ip?: string;
};

export type ContractVersion = {
  id?: string;
  version: string;
  note: string;
  author?: string;
  created_at?: string;
  sent_at: string | null;
};

export type ContractEvent = {
  version: string | null;
  party: Party;
  actor: string;
  action: string;
  detail: string;
  ip?: string;
  created_at: string;
};

export type ProjectMilestone = {
  id: string;
  seq: number;
  kind: MilestoneKind;
  title: string;
  due_date: string;
  amount: string;
  status: MilestoneStatus;
  progress: number;
  started_at: string | null;
  submitted_at: string | null;
  done_at: string | null;
  done_by: string | null;
};

export type Delivery = {
  id: string;
  milestone_id: string;
  round: number;
  note: string;
  submitted_by: string;
  submitted_at: string;
  decision: "pending" | "accepted" | "rejected";
  remark: string;
  decided_by: string | null;
  decided_at: string | null;
  links: string[];
  files: ContractFile[];
};

export type ProjectInvoice = {
  id: string;
  milestone_id: string;
  number: number;
  subtotal: string;
  vat: string;
  total: string;
  status: InvoiceStatus;
  issued_at: string;
  due_date: string;
  paid_at: string | null;
  reject_reason: string;
  void_reason: string;
  reference: string;
  receipt_reference: string;
};

export type ProjectIssue = {
  ticket_id: string;
  milestone_id: string | null;
  kind: "bug" | "change";
  created_at: string;
  number: number;
  subject: string;
  status: string;
  updated_at: string;
};

export type Buyer = {
  name: string;
  address: string;
  tax_id: string;
  branch: string;
  email: string;
};

export type RelatedContract = { id: string; reference: string; title: string };

export type Renewal = RelatedContract & {
  status: ContractStatus;
  coverage_start: string | null;
  coverage_end: string | null;
};

export type Project = {
  progress: number;
  milestones: ProjectMilestone[];
  deliveries: Delivery[];
  /** Empty for a customer-side viewer without billing. */
  invoices: ProjectInvoice[];
  /** null for a customer-side viewer without billing. */
  totals: { contract: string; billed: string; paid: string } | null;
  issues: ProjectIssue[];
  coverage: Coverage;
  warranty_days: number;
  support_terms: string;
  delivered_at: string | null;
  ma_requested_at: string | null;
  renewals: Renewal[];
  renews: RelatedContract | null;
  /** null for a customer-side viewer without billing. */
  buyer: Buyer | null;
};

/** One step of a customer-side review (backend client_team/approvals.py). */
export type ApprovalStep = {
  step: number;
  account_id: string;
  name: string;
  decision: "approved" | "returned" | null;
  remark: string;
  decided_at: string | null;
};

/** A review of a contract version or a delivery round: reviewers in order, then the final decision. */
export type ApprovalRun = {
  steps: ApprovalStep[];
  /** The step that waits (1-based); null once every step approved. */
  current: number | null;
  /** The viewer is the reviewer of the step that waits. */
  my_turn: boolean;
  /** The viewer may do the final action (accept / sign) once the review is ready. */
  can_decide: boolean;
  /** Every step approved: the final action is open. */
  ready: boolean;
};

/** The reviews still waiting on a contract (no entry: no reviewers, the decision alone). */
export type ContractApproval = {
  contract: ApprovalRun | null;
  deliveries: Record<string, ApprovalRun>;
};

export type ReviewDecision = "approved" | "returned";

/** GET /api/contracts/<id> (staff) and GET /api/public/<org>/contracts/<id> (customer). */
export type ContractDetail = {
  contract: ContractInfo;
  document: ContractVersionDocument | null;
  files: ContractFile[];
  signatures: Signature[];
  versions: ContractVersion[];
  project: Project | null;
  renews: RelatedContract | null;
  events: ContractEvent[];
  /** The viewer's role and capabilities (customer view only; contract.conversation_id is then the viewer's own chat). */
  access?: ContractAccess;
  /** The customer side's reviews still waiting (the team's side sees them read-only). */
  approval?: ContractApproval;
};

export type Seller = {
  name: string;
  address: string;
  tax_id: string;
  branch: string;
  vat: boolean;
  bank: string;
  account_name: string;
  account_number: string;
  promptpay: string;
};

/** GET /api/contracts/<id>/invoices/<id>, /api/public/<org>/contracts/<id>/invoices/<id> and /api/public/<org>/invoices/<id>. */
export type InvoiceView = {
  invoice: {
    id: string;
    number: number;
    subtotal: string;
    vat_rate: string;
    vat: string;
    total: string;
    status: InvoiceStatus;
    issued_at: string;
    due_date: string;
    slip_note: string;
    reject_reason: string;
    void_reason: string;
    paid_at: string | null;
    confirmed_by: string | null;
    receipt_number: number | null;
    reference: string;
    receipt_reference: string;
  };
  contract: {
    id: string;
    reference: string;
    title: string;
    kind: ContractKind;
  };
  milestone: { id: string; seq: number; title: string; kind: MilestoneKind };
  seller: Seller;
  buyer: Buyer;
  total_words: string;
  /** A PromptPay QR (data: URL) while the invoice waits for payment; '' otherwise. */
  qr: string;
  slips: ContractFile[];
};

export type ContractTemplate = {
  id: string;
  title: string;
  kind: ContractKind;
  body: string;
  author: string;
  updated_at: string;
};

/** GET /api/contract-templates */
export type ContractTemplates = {
  platform: ContractTemplate[];
  organization: ContractTemplate[];
  placeholders: string[];
};

/** GET /api/contract-customers */
export type ContractCustomer = { id: string; name: string; email: string };

/** POST .../otp */
export type OtpResult =
  { method: "email"; sent_to: string } | { method: "password" };
