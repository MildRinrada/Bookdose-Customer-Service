/* Shapes of the API answers every part of the app reads. A feature's own shapes live in src/features/<feature>/types.ts.
   Field names are the server's (snake_case), so a response can be used as it arrives. */

/** An organization's owner ('admin', เจ้าขององค์กร) or an agent who answers customers. */
export type Role = 'admin' | 'agent';

/** expires_at: when a support access approved by the organization ends (null for a permanent membership). */
export type Membership = { id: string; name: string; slug: string; status: string; role: Role; expires_at?: string | null };

/** GET /api/bootstrap: who is signed in (user is null when signed out) and how this copy is set up. */
export type Boot = {
  setup_required: boolean;
  setup_token_required: boolean;
  registration_available: boolean;
  /** The platform's own organization, where customers sign up on the main page. */
  home: { slug: string; name: string } | null;
  /** platform_owner: the account made at first-run setup, the one who manages the platform admins. */
  user: { id: string; name: string; email: string; platform_admin: boolean; platform_owner?: boolean } | null;
  avatar: string;
  csrf: string | null;
  tenant_id: string | null;
  memberships: Membership[];
  /** Session limits (docs/SECURITY-DESIGN.md §2), when the server sends them here too. */
  idle_expires_at?: string | null;
  absolute_expires_at?: string | null;
  /** Signed out because the cookie's session has just run out. */
  session_expired?: 'idle' | 'absolute';
  /** The platform's announcement to every organization's staff, while it lasts. */
  announcement?: { text: string; level: 'info' | 'warning'; ends_at: string | null } | null;
};

export type Member = {
  id: string;
  name: string;
  email: string;
  role: Role;
  team_id: string | null;
  active: boolean | number;
  /** A platform admin let in for support until then (null: a permanent member). */
  expires_at?: string | null;
  /** Whether routing may give them a new case now (ตั้งค่าบัญชี → สถานะการทำงาน). */
  availability?: Availability;
  /** They chose a photo: GET /api/members/<id>/photo has it (1 from the server, so a number). */
  has_photo?: number | boolean;
};

/** A member's work status: available for new cases, or why not (a break, busy, away, off shift, on leave). */
export type Availability = { available: boolean; status: WorkStatus; label: string; reason: string; since?: string | null };

export type WorkStatus = 'online' | 'break' | 'busy' | 'offline';

export type Team = { id: string; name: string; description?: string } & Record<string, unknown>;

/** GET /api/workspace: the selected organization as the signed-in member sees it. */
export type Workspace = {
  tenant: { id: string; name: string; slug: string };
  role: Role;
  /** A platform admin on a support access: they may look, never reply, take a case or change anything. */
  read_only?: boolean;
  team_id: string | null;
  members: Member[];
  teams: Team[];
  settings: Record<string, unknown>;
  channels: unknown;
  /** คำตอบสำเร็จรูปของทีม: prepared texts anyone may put into a reply and edit before sending (owners maintain them). */
  snippets: TeamSnippet[];
  macros: Macro[];
  customer_email: boolean;
  ai: Record<string, unknown> & { key_configured: boolean };
  /** Support access requests waiting for this organization's admins (always 0 for other roles). */
  support_pending?: number;
};

/** One of the team's prepared replies. The click writes it into the draft; a Macro is the one that sends. */
export type TeamSnippet = { id?: string; shortcut: string; text: string };

/** A macro: one click, several steps (Workspace.macros, GET /api/automation). */
export type Macro = {
  id: string;
  name: string;
  reply: string;
  /** '' = keep the status. */
  set_status: string;
  followup_hours: number;
  updated_at?: string;
};

/** A file attached to a message, as the conversation and portal APIs send it (`message.attachments[]`). */
export type MessageFile = { id: string; name: string; mime: string; size: number };

/** A row of GET /api/tickets. */
export type TicketSummary = {
  id: string;
  number: number;
  subject: string;
  status: string;
  priority: string;
  category?: string;
  channel?: string;
  assignee_id: string | null;
  team_id: string | null;
  contact_id?: string | null;
  contact_name?: string;
  created_at: string;
  updated_at: string;
  first_response_at: string | null;
  first_response_due_at: string;
  resolution_due_at: string;
  resolved_at?: string | null;
} & Record<string, unknown>;

/** GET /api/automation/alerts (and overview.me): what is addressed to the signed-in member. */
export type StaffAlerts = {
  escalations: Array<
    { ticket_id: string; number: number; subject: string; escalated_at: string; reason: string; status?: string; priority?: string } & Record<
      string,
      unknown
    >
  >;
  followups: Array<{ ticket_id: string; number: number; note: string; due_at: string; subject: string; status?: string } & Record<string, unknown>>;
  /** Five-star answers of the last 7 days on the member's own cases (celebrated once each). */
  praise?: Array<{ id: string; ticket_id: string; number: number; subject: string; comment: string; answered_at: string }>;
  mentions: Array<
    {
      conversation_id: string;
      ticket_id?: string | null;
      ticket_number: number | null;
      subject: string;
      author_name: string;
      body: string;
      created_at: string;
    } & Record<string, unknown>
  >;
};

/** GET /api/customer/account */
export type CustomerAccount =
  | { signed_in: false }
  | {
      signed_in: true;
      name: string;
      email: string;
      phone: string;
      csrf: string;
      email_verified: boolean;
      notify_email: boolean;
      consent_version: string;
      consent_at: string;
      created_at: string;
      /** The platform's announcement written for customers too, while it lasts. */
      announcement?: { text: string; level: 'info' | 'warning'; ends_at: string | null } | null;
      /** When the session ends without activity / at the latest (docs/SECURITY-DESIGN.md §2). */
      idle_expires_at?: string | null;
      absolute_expires_at?: string | null;
    };

export type SignedInCustomer = Extract<CustomerAccount, { signed_in: true }>;

/** A row of GET /api/customer/organizations: an organization the customer can contact. */
export type CustomerOrg = {
  slug: string;
  name: string;
  /** The platform's own organization (always first). */
  home: boolean;
  welcome?: string;
  response_hours?: number;
  categories?: string[];
  ai_enabled?: boolean;
} & Record<string, unknown>;
