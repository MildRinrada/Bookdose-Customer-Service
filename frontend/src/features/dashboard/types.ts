/* Shapes of GET /api/automation/overview (automation.service.overview). Field names are the server's. */

import type { Escalation } from '@/features/automation/types';
import type { Role, StaffAlerts } from '@/lib/types';

export type AgentActivity = {
  id: string;
  name: string;
  role: Role;
  team_id: string | null;
  last_seen: string | null;
  open: number;
  resolved_today: number;
  replies_today: number;
  /** Minutes, 30 days; null when nothing to measure. */
  avg_first_response: number | null;
  csat: number | null;
};

export type CsatSummary = {
  count: number;
  sent: number;
  average: number | null;
  satisfied: number | null;
  distribution: Record<string, number>;
};

/** New conversations per weekday (0 = Sunday) and hour of the viewer's local time, over `weeks` weeks. */
export type Heatmap = { weeks: number; counts: number[][] };

export type ManagerOverview = {
  agents: AgentActivity[];
  heatmap: Heatmap;
  csat: CsatSummary;
  automation: {
    rules: number;
    macros: number;
    escalations_today: number;
    followups_due: number;
    escalation_enabled: boolean | number;
    escalation_minutes: number;
    csat_enabled: boolean | number;
  };
  escalations: Escalation[];
  generated_at: string;
};

export type Overview = { me: StaffAlerts; manager: ManagerOverview | null };
