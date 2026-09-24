'use client';

import { QueryCache, QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, ApiError } from './api/client';

/* Reading from the API. A query's key is its API path (with the query string), so what a screen shows and what an
   action refreshes are named the same way:
     const { data } = useApi<{ tickets: Ticket[] }>('/api/tickets');
     const refresh = useInvalidate();  …  await api('/api/tickets', body); await refresh('/api/tickets');
   Like the app before Next.js, every screen asks again when it opens; nothing is refetched on window focus. */

export function createQueryClient() {
  const client: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 2000,
        refetchOnWindowFocus: false,
        // A 4xx answer (not found, no permission, signed out) will not change by asking again. "Too many requests"
        // (switching chats quickly) will: ask again once the server says it may, keeping what the screen shows.
        retry: (count, error) =>
          error instanceof ApiError && error.status === 429 ? count < 3 : !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
        retryDelay: (count, error) =>
          error instanceof ApiError && error.status === 429 ? Math.min(Math.max(error.retryAfter ?? 5, 1), 60) * 1000 : Math.min(1000 * 2 ** count, 30000),
      },
    },
    queryCache: new QueryCache({
      // Signed out elsewhere (or the session ran out): ask again who is signed in; the layouts then go to sign-in.
      onError: (error, query) => {
        const key = query.queryKey[0];
        if (error instanceof ApiError && error.status === 401 && key !== '/api/bootstrap' && key !== '/api/customer/account') {
          void client.invalidateQueries({ queryKey: ['/api/bootstrap'] });
          void client.invalidateQueries({ queryKey: ['/api/customer/account'] });
        }
      },
    }),
  });
  return client;
}

export type ApiQueryOptions = {
  /** Ask again every n milliseconds while the screen is open (e.g. a live conversation); or decide from the last
      answer (e.g. ask again only while a job is still working). */
  refetchInterval?: number | false | ((data: unknown) => number | false);
  enabled?: boolean;
  /** Keep showing the previous answer while a new path loads (e.g. paging through a list). */
  keepPrevious?: boolean;
};

/** GET `path` (null: not yet). */
export function useApi<T>(path: string | null, options: ApiQueryOptions = {}) {
  return useQuery<T, ApiError>({
    queryKey: [path],
    queryFn: () => api<T>(path as string),
    enabled: path !== null && options.enabled !== false,
    refetchInterval:
      typeof options.refetchInterval === 'function'
        ? ((interval) => (query: { state: { data: unknown } }) => interval(query.state.data))(options.refetchInterval)
        : options.refetchInterval,
    refetchIntervalInBackground: false,
    placeholderData: options.keepPrevious ? (previous) => previous : undefined,
  });
}

/** Refresh every query whose path starts with one of the given prefixes (e.g. '/api/tickets'). */
export function useInvalidate() {
  const client = useQueryClient();
  return useCallback(
    (...prefixes: string[]) =>
      client.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && prefixes.some((prefix) => key.startsWith(prefix));
        },
      }),
    [client],
  );
}
