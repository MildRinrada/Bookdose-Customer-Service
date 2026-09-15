/* Shapes of the automation API (backend/modules/automation). Field names are the server's. */

/** A row of automation_rules: channel + keywords -> priority, team, owner. */
export type AutomationRule = {
  id: string;
  name: string;
  /** SQLite integer flag (0 / 1). */
  enabled: number | boolean;
  /** '' = any channel. */
  channel: string;
  /** One word per line. */
  keywords: string;
  set_priority: string;
  set_team_id: string;
  set_assignee_id: string;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
};

import type { Macro } from '@/lib/types';

/** A macro (one definition, in lib/types: the workspace carries them too). */
export type { Macro };

export type AutomationSettings = {
  escalation_enabled: boolean;
  escalation_minutes: number;
  csat_enabled: boolean;
  csat_message: string;
};

/** A row of recent_escalations (automation page, dashboard manager view). */
export type Escalation = {
  ticket_id: string;
  reason: 'unclaimed' | 'sla_risk' | (string & {});
  from_user_id: string | null;
  to_user_id: string | null;
  escalated_at: string;
  number: number;
  subject: string;
  status?: string;
  priority?: string;
  assignee_id?: string | null;
};

/** GET /api/automation */
export type AutomationPage = {
  rules: AutomationRule[];
  macros: Macro[];
  settings: AutomationSettings;
  escalations: Escalation[];
};

/** A follow-up reminder on a case (ticket detail: automation.followups). */
export type Followup = {
  id: string;
  ticket_id: string;
  due_at: string;
  note: string;
  user_id: string;
  user_name: string;
  created_at: string;
  done_at: string | null;
};

/** The latest CSAT survey of a case (ticket detail: automation.survey). */
export type Survey = {
  id: string;
  ticket_id: string;
  conversation_id: string;
  message_id: string | null;
  rating: number | null;
  sent_at: string;
  answered_at: string | null;
  comment: string;
};

/** The escalation of a case (ticket detail: automation.escalation). */
export type TicketEscalation = {
  ticket_id: string;
  reason: string;
  from_user_id: string | null;
  to_user_id: string | null;
  escalated_at: string;
};

/** GET /api/tickets/<id> → automation: what the automation module adds to a case. */
export type TicketAutomation = {
  followups: Followup[];
  escalation: TicketEscalation | null;
  survey: Survey | null;
};

/** POST /api/macros/<id>/run */
export type MacroRunResult = {
  done: Array<'reply' | 'status' | 'followup'>;
  skipped: Array<'reply' | 'ticket'>;
  ticket_id: string | null;
};

/** What a macro runs on. */
export type MacroTarget = { kind: 'ticket' | 'conversation'; id: string };
