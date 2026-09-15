'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';
import { CustomerShell } from '@/components/shell/CustomerShell';
import { ErrorState, InitialLoading } from '@/components/ui/display';
import { useToast } from '@/components/ui/Toast';
import { joinOrganization, ORGS_PATH, OVERVIEW_PATH } from '@/features/customer/api';
import { useCustomerAccount, useCustomerOrgs, useCustomerOverview } from '@/lib/customer-session';
import { useInvalidate } from '@/lib/query';
import { ORG_CODE } from '@/lib/routes';
import { useBoot } from '@/lib/session';

/* Every screen of a signed-in customer. Signed out, the customer goes to sign-in and comes back here afterwards
   (?next=). The screens that work without an account (confirming the email, a new password) are in
   src/app/customer/(link)/. */

export default function CustomerLayout({ children }: { children: ReactNode }) {
  const account = useCustomerAccount();
  const boot = useBoot();
  const orgs = useCustomerOrgs();
  const overview = useCustomerOverview();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const refresh = useInvalidate();
  // Only a fresh answer counts: right after signing in, the cache may still hold the signed-out one.
  const signedOut = Boolean(account.data && !account.data.signed_in && !account.isFetching);
  const ready = Boolean(account.data?.signed_in && boot.data && orgs.data && overview.data);

  useEffect(() => {
    if (signedOut) router.replace(`/login?next=${encodeURIComponent(pathname + window.location.search)}`);
  }, [signedOut, pathname, router]);

  /* Signed in from an organization's link (?org=<code>): that organization joins the list (once), and the link
     leaves the address (the old joinLinkedOrg). On /customer/chats/new the same parameter picks the organization of
     the new chat, so it stays there. */
  const joined = useRef('');
  const known = orgs.data?.organizations;
  useEffect(() => {
    if (!ready || !known) return;
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('org') ?? '';
    if (!slug || joined.current === slug) return;
    joined.current = slug;
    if (pathname !== '/customer/chats/new') {
      params.delete('org');
      const rest = params.toString();
      router.replace(rest ? `${pathname}?${rest}` : pathname);
    }
    if (!ORG_CODE.test(slug) || known.some((o) => o.slug === slug)) return;
    joinOrganization(slug)
      .then(async ({ organization }) => {
        await refresh(ORGS_PATH, OVERVIEW_PATH);
        toast(`เพิ่ม ${organization.name} ในองค์กรที่ติดต่อได้แล้ว`);
      })
      .catch(() => {
        /* A wrong or closed code: nothing to add. */
      });
  }, [ready, known, pathname, router, refresh, toast]);

  // Every screen shows the overview as it is when it opens (the old router asked for it on each screen).
  const firstPath = useRef(pathname);
  const { refetch: refetchOverview } = overview;
  useEffect(() => {
    if (firstPath.current === pathname) return;
    firstPath.current = pathname;
    void refetchOverview();
  }, [pathname, refetchOverview]);

  const error = account.error ?? boot.error ?? orgs.error ?? overview.error;
  if (error)
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void account.refetch();
          void orgs.refetch();
          void overview.refetch();
        }}
      />
    );
  if (!ready) return <InitialLoading text="กำลังเปิดบัญชีของคุณ…" />;
  return <CustomerShell>{children}</CustomerShell>;
}
