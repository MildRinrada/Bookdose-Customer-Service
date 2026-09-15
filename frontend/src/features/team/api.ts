import { api } from '@/lib/api/client';
import type { FlowKind, MemberRole } from './types';

/* Endpoints of backend/modules/client_team/routes.py: the customer's team with one organization, the approval flows
   and what waits for the customer's review or decision. Refresh teamPath(slug) (it prefixes the flows too) and
   OVERVIEW_PATH after a write. */

export const APPROVALS_PATH = '/api/customer/approvals';
export const teamPath = (slug: string) => `/api/public/${slug}/team`;
export const flowsPath = (slug: string) => `${teamPath(slug)}/flows`;
export const projectFlowPath = (slug: string, contractId: string) => `/api/public/${slug}/contracts/${contractId}/flow`;

export type MemberBody = { role: MemberRole; all_projects: boolean; projects: string[] };

export const inviteMember = (slug: string, body: MemberBody & { email: string }) => api<{ id: string }>(teamPath(slug), body);
export const updateMember = (slug: string, id: string, body: MemberBody) => api<{ ok: true }>(`${teamPath(slug)}/${id}`, body, 'PATCH');
export const removeMember = (slug: string, id: string) => api<{ ok: true }>(`${teamPath(slug)}/${id}`, undefined, 'DELETE');
export const acceptInvite = (slug: string, id: string) => api<{ ok: true }>(`${teamPath(slug)}/${id}/accept`, {});
export const declineInvite = (slug: string, id: string) => api<{ ok: true }>(`${teamPath(slug)}/${id}/decline`, {});

export const saveFlows = (slug: string, body: Partial<Record<FlowKind, string[]>>) => api<{ ok: true }>(flowsPath(slug), body);
export const saveProjectFlow = (slug: string, contractId: string, body: { kind: FlowKind; steps: string[]; use_default: boolean }) =>
  api<{ ok: true }>(projectFlowPath(slug, contractId), body);
