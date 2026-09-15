import type { Capability, ClientRole, ContractKind, ContractStatus } from '@/features/contracts/types';

/* Shapes of backend/modules/client_team answers (team, approval flows, what waits for the customer), snake_case as sent. */

export type MemberStatus = 'invited' | 'active' | 'declined' | 'removed';
export type MemberRole = Exclude<ClientRole, 'owner'>;

/** A row of the owner's team (history included). */
export type TeamMember = {
  id: string;
  email: string;
  /** The account's name once the invitation is accepted, '' before. */
  name: string;
  role: MemberRole;
  role_label: string;
  all_projects: boolean;
  projects: string[];
  status: MemberStatus;
  invited_at: string;
  accepted_at: string | null;
};

/** A project the owner can give a member (MA contracts follow their project). */
export type TeamProject = { id: string; reference: string; title: string; status: ContractStatus };

/** A team the customer belongs to. */
export type Membership = {
  owner_id: string;
  owner_name: string;
  role: MemberRole;
  role_label: string;
  all_projects: boolean;
  projects: string[];
  accepted_at: string;
};

export type RoleInfo = { key: MemberRole; label: string; can: Capability[] };

/** GET /api/public/<org>/team */
export type TeamView = {
  mine: { members: TeamMember[]; projects: TeamProject[] };
  memberships: Membership[];
  roles: RoleInfo[];
};

/** Someone who can be a step of an approval flow: the owner (role 'owner') or a member whose role has review. */
export type Reviewer = { account_id: string; name: string; role: ClientRole; role_label: string };

export type FlowKind = 'delivery' | 'contract';

/** GET /api/public/<org>/team/flows: the owner's default flows (account ids in order). */
export type FlowsView = Record<FlowKind, string[]> & { reviewers: Reviewer[] };

/** GET /api/public/<org>/contracts/<id>/flow: one project's flows for its owner. */
export type ProjectFlowView = Record<FlowKind, { use_default: boolean; steps: string[] }> & {
  /** What the project follows without its own flow. */
  default: Record<FlowKind, string[]>;
  reviewers: Reviewer[];
};

/** A row of GET /api/customer/approvals: a review step or a final decision waiting for the customer. */
export type ApprovalItem = {
  target: FlowKind;
  contract_id: string;
  milestone_id: string | null;
  milestone_title: string | null;
  /** The step that waits; with final, the number of steps (0: no reviewers). */
  step: number;
  steps: number;
  /** Every reviewer approved: it waits for the customer's final decision (accept / sign). */
  final: boolean;
  at: string;
  org_slug: string;
  org_name: string;
  reference: string;
  title: string;
  kind: ContractKind;
};
