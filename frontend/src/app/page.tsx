'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ErrorState, InitialLoading } from '@/components/ui/display';
import { useCustomerAccount } from '@/lib/customer-session';
import { legacyPath } from '@/lib/routes';
import { useBoot } from '@/lib/session';

/* The main address. Old links (#tickets/…, #chats/<org>/…, #verify-email?token=…, sent in emails before the move to
   Next.js) go to their new path. Otherwise: staff to their overview, a signed-in customer to their chats, everyone
   else to sign-in. ?org=<code> travels along: it names the organization a customer signs up with or connects to. */

export default function Home() {
  const router = useRouter();
  const boot = useBoot();
  const customer = useCustomerAccount();

  useEffect(() => {
    const search = window.location.search;
    const legacy = legacyPath(window.location.hash, search);
    // A platform admin looks after the server: their home is the console, not an organization's overview.
    const next = legacy
      ? legacy
      : !boot.data || !customer.data
        ? null
        : boot.data.user
          ? boot.data.user.platform_admin
            ? '/platform/system'
            : '/dashboard'
          : customer.data.signed_in
            ? `/customer/chats${search}`
            : `/login${search}`;
    if (!next) return;
    const go = () => router.replace(next);
    // Chrome may open this address while it is still being typed (prerendering it): it moves on once it is shown.
    if ((document as Document & { prerendering?: boolean }).prerendering) {
      document.addEventListener('prerenderingchange', go, { once: true });
      return () => document.removeEventListener('prerenderingchange', go);
    }
    go();
  }, [boot.data, customer.data, router]);

  const error = boot.error ?? customer.error;
  if (error)
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void boot.refetch();
          void customer.refetch();
        }}
      />
    );
  return <InitialLoading />;
}
