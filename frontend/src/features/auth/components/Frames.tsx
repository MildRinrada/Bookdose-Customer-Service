'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { Brand } from '@/components/shell/chrome';
import { TextSizeControls } from '@/components/shell/TextSize';

/* The two plain frames of the signed-out pages. The text-size controls sit where the old app put them. */

/** A one-card page (verification, registration closed): <main class="single-page">, brand, then the content. */
export function SinglePage({ children }: { children: ReactNode }) {
  return (
    <main className="single-page">
      <TextSizeControls />
      <Brand />
      {children}
    </main>
  );
}

/** A customer's one-task page from an email link or a QR (pages/customer/customer-link-page.html). The foot goes to
    the sign-in page, unless the caller knows the reader is already signed in (backHref/backLabel). */
export function CustomerLinkPage({
  organization,
  loginHref,
  backLabel = 'กลับไปหน้าเข้าสู่ระบบ',
  children,
}: {
  organization: string;
  loginHref: string;
  backLabel?: string;
  children: ReactNode;
}) {
  return (
    <main className="customer-link-page">
      <header className="customer-link-head">
        <TextSizeControls />
        <Brand />
        <span className="customer-link-org">{organization}</span>
      </header>
      <section className="card customer-center">{children}</section>
      <p className="customer-link-foot">
        <Link href={loginHref}>
          <Icon name="back" />
          {backLabel}
        </Link>
      </p>
    </main>
  );
}
