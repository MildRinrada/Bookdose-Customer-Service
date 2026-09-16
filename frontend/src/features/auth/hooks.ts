'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { useToast } from '@/components/ui/Toast';
import { useCustomerSignedIn } from '@/lib/customer-session';
import { useApi } from '@/lib/query';
import { useStaffSignedIn } from '@/lib/session';
import type { Boot } from '@/lib/types';
import { withOrg } from './params';
import type { PublicOrgInfo } from './types';

/* What the signed-out pages share: the organization a customer signs up with, where each kind of account goes after
   signing in, and the email typed on one page that the next page fills in. */

/** The organization the page speaks for: the one of ?org=<code>, else the platform's own. A wrong or closed code
    falls back to the platform's own and is then not sent with the sign-up (`signupOrg` is ''). */
export function useSignupOrg(org: string, home: Boot['home'] | undefined) {
  const primary = useApi<PublicOrgInfo>(home ? `/api/public/${org || home.slug}` : null);
  const fallback = useApi<PublicOrgInfo>(home && org && primary.isError ? `/api/public/${home.slug}` : null);
  const failedOver = Boolean(org && primary.isError);
  const info = primary.data ?? (failedOver ? fallback.data : undefined) ?? null;
  // A disabled query stays "pending", so only the queries that actually run count.
  const loading = Boolean(home) && (primary.isPending || (failedOver && fallback.isPending));
  return { info, signupOrg: failedOver ? '' : org, loading };
}

/** Where a staff member goes after signing in: the screen they came from (?next=), else the overview. */
export function staffDestination(next: string): string {
  return next && !next.startsWith('/customer') ? next : '/dashboard';
}

/** Where a customer goes after signing in: the customer screen they came from (or the /join/<token> link that sent
    them here), else their chats; ?org=<code> travels along so the customer side connects that organization. */
export function customerDestination(next: string, org: string): string {
  return withOrg(next.startsWith('/customer/') || next.startsWith('/join/') ? next : '/customer/chats', org);
}

/** After signing in, setting up or confirming a staff sign-up: drop what was cached while signed out, then go on. */
export function useFinishStaffSignIn() {
  const signedIn = useStaffSignedIn();
  const router = useRouter();
  return useCallback(
    (destination: string) => {
      signedIn();
      router.replace(destination);
    },
    [signedIn, router],
  );
}

/** After a customer signs in, signs up, confirms the email or sets a new password. */
export function useFinishCustomerSignIn() {
  const signedIn = useCustomerSignedIn();
  const router = useRouter();
  const toast = useToast();
  return useCallback(
    (destination: string, message: string) => {
      signedIn();
      toast(message);
      router.replace(destination);
    },
    [signedIn, router, toast],
  );
}

// The email of an organization sign-up, filled in on the check-email / resend-email pages (kept for this tab only,
// like the old app's state).
let registrationEmail = '';
export const rememberedRegistrationEmail = () => registrationEmail;
export function rememberRegistrationEmail(email: string) {
  registrationEmail = email;
}
