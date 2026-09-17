'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useToast } from '@/components/ui/Toast';
import { api, setConversation, type ApiError } from '@/lib/api/client';
import { useCustomerOrgs, useCustomerOverview, type CustomerOverview } from '@/lib/customer-session';
import { useRealtimeInterval } from '@/lib/realtime-provider';
import type { CustomerOrg } from '@/lib/types';
import { useUiState } from '@/lib/ui-state';
import { OVERVIEW_PATH, sessionKey, sessionPath } from './api';
import type { OverviewData, PortalSession } from './types';

/** The open chat keeps itself up to date every 10 seconds (the old pollCustomerChat). */
export const CHAT_POLL_MS = 10000;

/** The customer's overview, typed (the customer layout loads it before any screen opens). */
export function useOverview(): OverviewData {
  const { data } = useCustomerOverview<OverviewData>();
  if (!data) throw new Error('useOverview() is only for screens inside the customer layout');
  return data;
}

/** The organizations the customer can contact, the platform's own first. */
export function useOrgs(): CustomerOrg[] {
  return useCustomerOrgs().data?.organizations ?? [];
}

/** Which organization's chats, cases and service levels to show: '' for every one. Shared by those screens,
    like the old state.customer.orgFilter. */
export function useOrgFilter() {
  return useUiState('customer:orgFilter', '');
}

/** The open chat: GET /api/public/<org>/session with X-Conversation-ID, polled every 10 s while the page is visible
    (every minute while live updates are connected).
    Reading it counts as reading the team's reply: the menu count and the bell drop at once. A refresh that fails says
    why once and keeps the chat on the screen; polling goes on, so the chat catches up by itself (a refresh that stopped
    for good left the thread frozen until the page was reloaded). A chat that is not the customer's (404) goes back to
    the list. */
export function useChatSession(slug: string | undefined, id: string | undefined) {
  const client = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const key = slug && id ? sessionKey(slug, id) : null;
  const poll = useRealtimeInterval(CHAT_POLL_MS);

  // The composer, the hand-off and the survey act on the chat named by X-Conversation-ID; clear it when leaving.
  useEffect(() => {
    setConversation(id ?? null);
    return () => setConversation(null);
  }, [id]);

  const query = useQuery<PortalSession, ApiError>({
    queryKey: [key],
    // Not useApi(): the chat is chosen by a header, so it is set right before every request (also a refresh
    // started by another screen's invalidation).
    queryFn: () => {
      setConversation(id);
      return api<PortalSession>(sessionPath(slug as string));
    },
    enabled: key !== null,
    refetchInterval: poll,
    refetchIntervalInBackground: false,
  });

  const { data, error, dataUpdatedAt, errorUpdatedAt } = query;
  // The answer whose failing refresh was already reported: one message for a run of failures, not one per poll.
  const reported = useRef(-1);

  useEffect(() => {
    if (!data || !id) return;
    client.setQueryData<CustomerOverview>([OVERVIEW_PATH], (overview) => {
      if (!overview) return overview;
      const alerts = overview.alerts.filter((a) => !(a.kind === 'reply' && a.conversation_id === id));
      return {
        ...overview,
        conversations: overview.conversations.map((c) => (c.id === id ? { ...c, seen_at: new Date().toISOString() } : c)),
        alerts,
        alert_count: alerts.filter((a) => a.action).length,
      };
    });
  }, [client, data, dataUpdatedAt, id]);

  useEffect(() => {
    if (!error || !key) return;
    if (data) {
      // A refresh failed: say why, once until the chat loads again. 401 is handled by the session.
      if (error.status !== 401 && reported.current !== dataUpdatedAt) toast(error.message, true);
      reported.current = dataUpdatedAt;
    } else if (error.status === 404) {
      toast(error.message, true);
      router.replace('/customer/chats');
    }
    // Only a new failure is reported.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorUpdatedAt]);

  return query;
}
