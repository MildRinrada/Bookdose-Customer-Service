/* Shapes the organization settings send and read (backend/modules/organization/schema.py). */

/** One choice a customer picks when starting a chat; team_id '' = the organization's first team. */
export type CustomerCategory = { name: string; team_id: string };

/** PATCH /api/settings */
export type SettingsBody = {
  response_hours: string;
  resolution_hours: string;
  welcome: string;
  canned_reply: string;
};

/** POST /api/members (new account) or PATCH /api/members/<id> (role, team, active). */
export type MemberBody = {
  role: string;
  team_id: string;
  name?: string;
  email?: string;
  password?: string;
  active?: boolean;
};

/** The member list's filters (kept while moving between screens, like uiState.members). */
export type MemberFilters = { q?: string; role?: string };

export type SupportStatus = 'pending' | 'approved' | 'denied' | 'cancelled' | 'ended' | 'expired';

/** A row of GET /api/support-access. */
export type SupportRequest = {
  id: string;
  status: SupportStatus;
  reason: string;
  hours: number;
  requester: { name: string; email: string };
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  note: string;
  expires_at: string | null;
  ended_at: string | null;
  ended_by: string | null;
};
