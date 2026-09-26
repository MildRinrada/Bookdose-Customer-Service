import { api } from '@/lib/api/client';
import type { AutomationRule, AutomationSettings, DistributionSettings, Macro, MacroRunResult, MacroTarget } from './types';

/* Endpoints of backend/modules/automation/routes.py. Reads go through useApi(AUTOMATION_PATH). */

export const AUTOMATION_PATH = '/api/automation';

export type RuleBody = Pick<AutomationRule, 'name' | 'channel' | 'keywords' | 'set_priority' | 'set_team_id' | 'set_assignee_id' | 'set_tags'> & {
  enabled: boolean;
};

/** แจกเคสอัตโนมัติ (owners only). Cases already waiting are handed out as soon as it is saved. */
export const saveDistribution = (body: DistributionSettings) =>
  api<{ settings: DistributionSettings }>('/api/automation/distribution', body, 'PATCH');

export type MacroBody = Pick<Macro, 'name' | 'reply' | 'set_status' | 'followup_hours'>;

export const saveRule = (id: string | null, body: RuleBody) =>
  api<{ id: string }>(`/api/automation/rules${id ? `/${id}` : ''}`, body, id ? 'PATCH' : 'POST');

export const deleteRule = (id: string) => api<{ deleted: string }>(`/api/automation/rules/${id}`, undefined, 'DELETE');

export const saveMacro = (id: string | null, body: MacroBody) =>
  api<{ id: string }>(`/api/automation/macros${id ? `/${id}` : ''}`, body, id ? 'PATCH' : 'POST');

export const deleteMacro = (id: string) => api<{ deleted: string }>(`/api/automation/macros/${id}`, undefined, 'DELETE');

export const saveAutomationSettings = (body: AutomationSettings) => api<{ ok: true }>('/api/automation/settings', body, 'PATCH');

export const runMacro = (id: string, target: MacroTarget) =>
  api<MacroRunResult>(`/api/macros/${id}/run`, { [target.kind === 'ticket' ? 'ticket_id' : 'conversation_id']: target.id });

export const addFollowup = (ticketId: string, hours: number, note: string) =>
  api<{ id: string }>(`/api/tickets/${ticketId}/followups`, { hours, note });

export const finishFollowup = (id: string) => api<{ ok: true }>(`/api/followups/${id}/done`, {});

/** Queries a macro run can change: the case (status, reply, reminder), its conversations and the alerts. */
export const MACRO_RUN_PREFIXES = ['/api/tickets', '/api/conversations', '/api/inbox', '/api/automation'];

/** Queries a follow-up change touches: the case screen and the member's alerts / overview. */
export const FOLLOWUP_PREFIXES = ['/api/tickets', '/api/automation'];
