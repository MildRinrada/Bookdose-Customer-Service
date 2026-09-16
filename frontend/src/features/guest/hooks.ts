'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useToast } from '@/components/ui/Toast';
import { api, setConversation, setGuestCredentials, type ApiError } from '@/lib/api/client';
import { CHAT_POLL_MS } from '@/features/customer/hooks';
import { useRealtimeInterval } from '@/lib/realtime-provider';
import type { PortalSession } from '@/features/customer/types';
import { guestPath, guestSessionKey, guestSessionPath } from './api';
import type { GuestOverview } from './types';

/* Reading the guest chat. GET …/guest answers for whatever cookie this browser holds (none → guest: null) and hands
   over the csrf the changing requests need; the open chat is read like the signed-in customer's (X-Conversation-ID). */

/** This browser's visitor, conversations and follow options, polled every `poll` ms (the list's unread marks and,
    in the website widget, the unread badge). While live updates are connected, events refresh it and polling is a
    slow safety net. */
export function useGuestOverview(slug: string, poll: number | false = 30000) {
  const key = guestPath(slug);
  const interval = useRealtimeInterval(poll);
  return useQuery<GuestOverview, ApiError>({
    queryKey: [key],
    queryFn: async () => {
      const data = await api<GuestOverview>(key);
      setGuestCredentials(data.guest?.csrf ?? null);
      return data;
    },
    refetchInterval: interval,
    refetchIntervalInBackground: false,
  });
}

/** The open guest chat, polled every 10 s (every minute while live updates are connected). Reading it reads the team's replies, so the list's mark drops at once.
    A chat that is no longer this visitor's (404, or the cookie is gone: 401) calls `onGone`. */
export function useGuestSession(slug: string, id: string | null, onGone: (message: string) => void) {
  const client = useQueryClient();
  const toast = useToast();
  const key = id ? guestSessionKey(slug, id) : null;
  const poll = useRealtimeInterval(CHAT_POLL_MS);

  useEffect(() => {
    setConversation(id);
    return () => setConversation(null);
  }, [id]);

  const query = useQuery<PortalSession, ApiError>({
    queryKey: [key],
    queryFn: () => {
      setConversation(id);
      return api<PortalSession>(guestSessionPath(slug));
    },
    enabled: key !== null,
    refetchInterval: (q) => (q.state.error && q.state.data ? false : poll),
    refetchIntervalInBackground: false,
  });

  const { data, dataUpdatedAt, error, errorUpdatedAt } = query;

  useEffect(() => {
    if (!data || !id) return;
    client.setQueryData<GuestOverview>([guestPath(slug)], (overview) =>
      overview ? { ...overview, conversations: overview.conversations.map((c) => (c.id === id ? { ...c, unread: 0 } : c)) } : overview,
    );
  }, [client, data, dataUpdatedAt, id, slug]);

  useEffect(() => {
    if (!error || !key) return;
    if (error.status === 404 || error.status === 401) onGone(error.message);
    else if (data) toast(error.message, true);
    // Only a new failure is reported.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorUpdatedAt]);

  return query;
}
