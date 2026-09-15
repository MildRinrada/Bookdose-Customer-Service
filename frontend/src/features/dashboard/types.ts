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

/* Shapes of GET /api/customer/dashboard (customers/dashboard.py build). Money is a string with 2 decimals. */

type OrgLabel = { org_slug: string; org_name: string };

export type BudgetProject = OrgLabel & {
  contract_id: string;
  reference: string;
  title: string;
  /** Billed milestones at their invoice total (VAT included), the rest at what their invoice will say. */
  total: string;
  billed: string;
  paid: string;
  outstanding: string;
  overdue: string;
  next_due: { invoice_id: string; reference: string; due_date: string; total: string } | null;
};

export type UpcomingPayment = OrgLabel & {
  invoice_id: string;
  contract_id: string;
  reference: string;
  milestone_title: string;
  total: string;
  due_date: string;
  /** Negative once overdue. */
  days_left: number;
  status: 'unpaid' | 'submitted';
};

export type HealthState = 'on_track' | 'delayed' | 'ahead' | 'done' | 'not_started';

export type ProjectHealth = OrgLabel & {
  contract_id: string;
  reference: string;
  title: string;
  /** 0-100, as the project page shows it. */
  progress: number;
  /** 0-100: the share of the work due by today. */
  planned: number;
  state: HealthState;
  next: { title: string; due_date: string | null } | null;
  late: Array<{ title: string; due_date: string; days_late: number }>;
  finished_at: string | null;
  final_due: string | null;
};

export type OrgServiceLevel = OrgLabel & {
  cases: number;
  open: number;
  first_response_avg_minutes: number | null;
  first_response_on_time_pct: number | null;
  resolution_avg_hours: number | null;
  resolution_on_time_pct: number | null;
  csat_avg: number | null;
};

export type CustomerDashboard = {
  budget: {
    contract_total: string;
    billed: string;
    paid: string;
    outstanding: string;
    overdue: string;
    /** contract_total - paid */
    remaining: string;
    projects: BudgetProject[];
    upcoming: UpcomingPayment[];
    /** The last 12 months, oldest first; empty before any payment. */
    monthly: Array<{ month: string; paid: string }>;
  };
  health: { summary: Record<HealthState, number>; projects: ProjectHealth[] };
  sla: { orgs: OrgServiceLevel[] };
};
