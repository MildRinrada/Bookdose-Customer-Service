'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { api, setStaffCredentials, type ApiError } from './api/client';
import { useApi } from './query';
import { resetUiState } from './ui-state';
import type { Boot, Membership, StaffAlerts, TicketSummary, Workspace } from './types';

/* The staff side's session: who is signed in (bootstrap), the selected organization (workspace), its case list and
   the member's alerts. The staff layout loads all four before a screen opens, so screens can call useWork() and
   get the workspace without waiting. */

export function useBoot() {
  return useQuery<Boot, ApiError>({
    queryKey: ['/api/bootstrap'],
    queryFn: async () => {
      const boot = await api<Boot>('/api/bootstrap');
      setStaffCredentials(boot.csrf, boot.tenant_id);
      return boot;
    },
  });
}

/** The membership of the selected organization, if it is active. */
export function activeMembership(boot: Boot | undefined): Membership | undefined {
  return boot?.memberships.find((m) => m.id === boot.tenant_id && m.status === 'active');
}

export function useWorkspace() {
  const { data: boot } = useBoot();
  return useApi<Workspace>('/api/workspace', { enabled: Boolean(boot?.user && activeMembership(boot)) });
}

/** The selected organization; only on screens inside the staff layout, which waits for it. */
export function useWork(): Workspace {
  const { data } = useWorkspace();
  if (!data) throw new Error('useWork() is only for screens inside the staff layout, which loads the workspace first');
  return data;
}

/** The signed-in staff member (inside the staff layout). */
export function useStaffUser(): NonNullable<Boot['user']> {
  const { data } = useBoot();
  if (!data?.user) throw new Error('useStaffUser() is only for screens inside the staff layout');
  return data.user;
}

export function useStaffTickets() {
  const { data: boot } = useBoot();
  return useApi<{ tickets: TicketSummary[] }>('/api/tickets', { enabled: Boolean(boot?.user && activeMembership(boot)) });
}

export function useStaffAlerts() {
  const { data: boot } = useBoot();
  return useApi<StaffAlerts>('/api/automation/alerts', { enabled: Boolean(boot?.user && activeMembership(boot)) });
}

/** A member's name by id, or "ยังไม่มอบหมาย". */
export function useMemberName() {
  const { data: work } = useWorkspace();
  return useCallback((id: string | null | undefined) => work?.members.find((m) => m.id === id)?.name || 'ยังไม่มอบหมาย', [work]);
}

/** A team's name by id, or "ทีมที่ไม่มีแล้ว". */
export function useTeamName() {
  const { data: work } = useWorkspace();
  return useCallback((id: string | null | undefined) => work?.teams.find((t) => t.id === id)?.name || 'ทีมที่ไม่มีแล้ว', [work]);
}

/** Switch to another organization: everything shown belongs to the old one, so it is all dropped. */
export function useSwitchTenant() {
  const client = useQueryClient();
  const router = useRouter();
  return useCallback(
    async (tenantId: string, next = '/dashboard') => {
      await api('/api/session/tenant', { tenant_id: tenantId });
      resetUiState();
      client.clear();
      router.push(next);
    },
    [client, router],
  );
}

/** Call right after signing in (or setting up, or confirming a sign-up), before moving to the next screen: whatever
    was cached while signed out is dropped, so the staff layout asks again who is signed in. */
export function useStaffSignedIn() {
  const client = useQueryClient();
  return useCallback(() => {
    resetUiState();
    client.clear();
  }, [client]);
}

/** Sign out and go to sign-in; `stay` keeps the page (it then shows its signed-out state, e.g. /verify-email). */
export function useStaffLogout() {
  const client = useQueryClient();
  const router = useRouter();
  return useCallback(
    async (options: { stay?: boolean } = {}) => {
      await api('/api/logout', {});
      setStaffCredentials(null, null);
      resetUiState();
      client.clear();
      if (!options.stay) router.replace('/login');
    },
    [client, router],
  );
}
