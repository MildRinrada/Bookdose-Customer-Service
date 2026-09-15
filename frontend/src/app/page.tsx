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
    const legacy = legacyPath(window.location.hash, window.location.search);
    if (legacy) {
      router.replace(legacy);
      return;
    }
    if (!boot.data || !customer.data) return;
    const search = window.location.search;
    if (boot.data.user) router.replace('/dashboard');
    else if (customer.data.signed_in) router.replace(`/customer/chats${search}`);
    else router.replace(`/login${search}`);
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
