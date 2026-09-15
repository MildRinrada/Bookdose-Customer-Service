/* Shapes of the API answers every part of the app reads. A feature's own shapes live in src/features/<feature>/types.ts.
   Field names are the server's (snake_case), so a response can be used as it arrives. */

export type Role = 'admin' | 'manager' | 'agent';

export type Membership = { id: string; name: string; slug: string; status: string; role: Role };

/** GET /api/bootstrap: who is signed in (user is null when signed out) and how this copy is set up. */
export type Boot = {
  setup_required: boolean;
  setup_token_required: boolean;
  registration_available: boolean;
  /** The platform's own organization, where customers sign up on the main page. */
  home: { slug: string; name: string } | null;
  user: { id: string; name: string; email: string; platform_admin: boolean } | null;
  avatar: string;
  csrf: string | null;
  tenant_id: string | null;
  memberships: Membership[];
};

export type Member = { id: string; name: string; email: string; role: Role; team_id: string | null; active: boolean | number };

export type Team = { id: string; name: string } & Record<string, unknown>;

/** GET /api/workspace: the selected organization as the signed-in member sees it. */
export type Workspace = {
  tenant: { id: string; name: string; slug: string };
  role: Role;
  team_id: string | null;
  members: Member[];
  teams: Team[];
  settings: Record<string, unknown>;
  channels: unknown;
  macros: Macro[];
  customer_email: boolean;
  ai: Record<string, unknown> & { key_configured: boolean };
};

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
