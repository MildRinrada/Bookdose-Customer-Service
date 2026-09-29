'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { api, ApiError, setCustomerCredentials } from './api/client';
import { useApi } from './query';
import { clearExpiry } from './session-expiry';
import { resetUiState } from './ui-state';
import type { CustomerAccount, CustomerOrg, SignedInCustomer } from './types';

/* The customer side's session: one account for every organization. The customer layout loads the account, the
   organizations the customer can contact and the overview (chats, cases, alerts) before a
   screen opens. */

export function useCustomerAccount() {
  return useQuery<CustomerAccount, ApiError>({
    queryKey: ['/api/customer/account'],
    queryFn: async () => {
      let account: CustomerAccount;
      try {
        account = await api<CustomerAccount>('/api/customer/account');
      } catch (error) {
        // A session that has just run out answers 401 {reason} once (api() keeps the reason): signed out.
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        account = { signed_in: false };
      }
      setCustomerCredentials(account.signed_in ? account.csrf : null);
      return account;
    },
  });
}

/** The signed-in customer (inside the customer layout). */
export function useCustomer(): SignedInCustomer {
  const { data } = useCustomerAccount();
  if (!data?.signed_in) throw new Error('useCustomer() is only for screens inside the customer layout');
  return data;
}

export function useCustomerOrgs() {
  const { data } = useCustomerAccount();
  return useApi<{ organizations: CustomerOrg[] }>('/api/customer/organizations', { enabled: Boolean(data?.signed_in) });
}

/** GET /api/customer/overview: the fields the frame reads. The customer feature describes it fully
    (features/customer/types.ts OverviewData) and reads it with useCustomerOverview<OverviewData>(). */
export type CustomerOverview = {
  conversations: Array<{ id: string; last_kind?: string | null; seen_at?: string | null; updated_at: string } & Record<string, unknown>>;
  cases: Array<{ id: string; status: string } & Record<string, unknown>>;
  alerts: Array<{ kind: string; action?: boolean } & Record<string, unknown>>;
  alert_count: number;
} & Record<string, unknown>;

/** The team replied after the customer last opened the chat. */
export function customerUnread(c: { last_kind?: string | null; seen_at?: string | null; updated_at: string }): boolean {
  return c.last_kind === 'reply' && (!c.seen_at || c.seen_at < c.updated_at);
}

export function useCustomerOverview<T extends CustomerOverview = CustomerOverview>() {
  const { data } = useCustomerAccount();
  return useApi<T>('/api/customer/overview', { enabled: Boolean(data?.signed_in) });
}

/** Call right after signing in, signing up, confirming the email or setting a new password, before moving to the
    next screen: whatever was cached while signed out is dropped, so the customer layout asks again. */
export function useCustomerSignedIn() {
  const client = useQueryClient();
  return useCallback(() => {
    clearExpiry('customer');
    resetUiState();
    client.clear();
  }, [client]);
}

export function useCustomerLogout() {
  const client = useQueryClient();
  const router = useRouter();
  return useCallback(async () => {
    await api('/api/customer/logout', {});
    setCustomerCredentials(null);
    clearExpiry('customer');
    resetUiState();
    client.clear();
    router.replace('/login');
  }, [client, router]);
}
