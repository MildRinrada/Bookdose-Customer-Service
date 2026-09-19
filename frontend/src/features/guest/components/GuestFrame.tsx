'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { Brand } from '@/components/shell/chrome';
import { TextSizeMenu } from '@/components/shell/TextSize';
import { useCustomerAccount } from '@/lib/customer-session';
import { guestPages } from '../api';

/* The slim page around a visitor's pages of one organization without signing in (/support/<org>/…: its chats, FAQ and a case):
   the brand, the organization, links between the chat and the FAQ, sign-in, and the text size. Markup: guest-page,
   guest-head. */

/** A signed-in customer can go to their own chats instead (the organization joins their list via ?org=). */
export function SignedInLink({ slug }: { slug: string }) {
  const account = useCustomerAccount();
  if (account.data?.signed_in)
    return (
      <Link className="btn" href={`/customer/chats?org=${encodeURIComponent(slug)}`}>
        <Icon name="chat" />
        ไปที่แชทของฉัน
      </Link>
    );
  return (
    <Link className="btn subtle" href={`/login?org=${encodeURIComponent(slug)}`}>
      เข้าสู่ระบบ
    </Link>
  );
}

/** The header's links to the organization's chat and FAQ; the page being shown is marked. */
export function GuestNav({ slug, current }: { slug: string; current: 'chat' | 'faq' | 'case' }) {
  return (
    <nav className="guest-nav" aria-label="หน้าของผู้เยี่ยมชม">
      <Link className={`btn subtle${current === 'chat' ? ' active' : ''}`} href={guestPages.chat(slug)} aria-label="แชทกับทีมงาน" aria-current={current === 'chat' ? 'page' : undefined}>
        <Icon name="chat" />
        <span>แชทกับทีมงาน</span>
      </Link>
      <Link className={`btn subtle${current === 'faq' ? ' active' : ''}`} href={guestPages.faq(slug)} aria-label="คำถามที่พบบ่อย" aria-current={current === 'faq' ? 'page' : undefined}>
        <Icon name="book" />
        <span>คำถามที่พบบ่อย</span>
      </Link>
    </nav>
  );
}

export function GuestFrame({ slug, orgName, current, children }: { slug: string; orgName: string; current: 'faq' | 'case'; children: ReactNode }) {
  return (
    <main className="guest-page guest-page-wide">
      <header className="guest-head">
        <Brand />
        {orgName && <span className="customer-link-org guest-head-org">{orgName}</span>}
        <div className="guest-head-actions">
          <GuestNav slug={slug} current={current} />
          <SignedInLink slug={slug} />
          <TextSizeMenu />
        </div>
      </header>
      {children}
    </main>
  );
}
