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

/** New conversations per weekday (0 = Sunday) and hour of the viewer's local time, over `weeks` weeks (the service
    report's busy hours; labels.heatmapParts). */
export type Heatmap = { weeks: number; counts: number[][] };

export type ManagerOverview = {
  agents: AgentActivity[];
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

/** วันนี้ของฉัน: the member's own row of the manager view (automation.service.my_today). */
export type MyDay = {
  replies: number;
  resolved: number;
  open: number;
  /** Minutes, 30 days. */
  avg_first_response: number | null;
  csat: number | null;
  csat_count: number;
};

type SetupAction = { label: string; href: string };

/** ตั้งค่าองค์กรให้ครบ (automation/setup.py): the steps, and what is broken now. */
export type SetupChecklist = {
  steps: Array<{ key: string; done: boolean; title: string; detail: string; action: SetupAction }>;
  problems: Array<{ key: string; level: 'critical' | 'warning'; title: string; detail: string; action: SetupAction }>;
};

/** Questions that ask the same thing and no public article answers (ai/insights.knowledge_gaps). */
export type KnowledgeGap = {
  label: string;
  count: number;
  /** How many of them the chatbot tried and found no article for. */
  bot_unsure: number;
  examples: string[];
  conversations: string[];
  last_at: string;
};

/** The owner's last AI summary of today, or where it stands. */
export type Brief = { id: string; status: string; lines: string[]; created_at: string; error: string };

export type Insights = {
  days: number;
  gaps: { total: number; groups: KnowledgeGap[] };
  ai: { drafts_enabled: boolean; chatbot_enabled: boolean; key_configured: boolean };
  brief: Brief | null;
};

/** setup and insights: the organization's owners only. */
export type Overview = { me: StaffAlerts; today?: MyDay; manager: ManagerOverview | null; setup?: SetupChecklist | null; insights?: Insights | null };

/** POST /api/tickets/next: the case to open now and why (none: nothing waits for the member). */
export type NextTask = {
  ticket: { id: string; number: number; subject: string } | null;
  reason: 'overdue' | 'due_soon' | 'unassigned' | 'mine' | 'none';
  taken: boolean;
};

/* Shapes of GET /api/customer/dashboard (customers/dashboard.py build). */

type OrgLabel = { org_slug: string; org_name: string };

export type OrgServiceLevel = OrgLabel & {
  cases: number;
  open: number;
  first_response_avg_minutes: number | null;
  first_response_on_time_pct: number | null;
  resolution_avg_hours: number | null;
  resolution_on_time_pct: number | null;
  csat_avg: number | null;
};

export type CustomerDashboard = { sla: { orgs: OrgServiceLevel[] } };
