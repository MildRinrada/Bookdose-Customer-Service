'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { StaffShell } from '@/components/shell/StaffShell';
import { ErrorState, InitialLoading } from '@/components/ui/display';
import { useBoot } from '@/lib/session';
import { expiryReason, signInAddress } from '@/lib/session-expiry';

/* Every staff screen (the organization's and the platform console's). Signed out, the person goes to sign-in and
   comes back here afterwards (?next=); when the session ran out, the sign-in page also says why (?expired=). */

export default function StaffLayout({ children }: { children: ReactNode }) {
  const boot = useBoot();
  const router = useRouter();
  const pathname = usePathname();
  // Only a fresh answer counts: right after signing in, the cache may still hold the signed-out one.
  const signedOut = Boolean(boot.data && !boot.data.user && !boot.isFetching);

  const expired = boot.data?.session_expired;
  useEffect(() => {
    if (signedOut) router.replace(signInAddress(pathname + window.location.search, expiryReason('staff') ?? expired ?? null));
  }, [signedOut, pathname, router, expired]);

  if (boot.error) return <ErrorState title="เปิดพื้นที่ทำงานไม่สำเร็จ" error={boot.error} onRetry={() => void boot.refetch()} />;
  if (!boot.data?.user) return <InitialLoading />;
  return <StaffShell>{children}</StaffShell>;
}
