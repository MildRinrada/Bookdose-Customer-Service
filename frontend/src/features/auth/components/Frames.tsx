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

/** A customer's one-task page from an email link (pages/customer/customer-link-page.html). */
export function CustomerLinkPage({ organization, loginHref, children }: { organization: string; loginHref: string; children: ReactNode }) {
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
          กลับไปหน้าเข้าสู่ระบบ
        </Link>
      </p>
    </main>
  );
}
