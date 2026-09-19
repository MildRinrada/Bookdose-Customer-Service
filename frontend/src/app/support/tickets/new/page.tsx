import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { param, type SearchParams } from '@/features/auth/params';
import { SupportFindScreen } from '@/features/guest/SupportStartScreen';
import { ORG_CODE } from '@/lib/routes';

export const metadata: Metadata = { title: 'ติดต่อทีมงาน' };

/** /support/tickets/new: without the organization's link, its code is typed in (no list of organizations is shown).
    ?org=<code> goes straight to that organization's page. */
export default async function SupportFindPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const org = param(await searchParams, 'org');
  if (ORG_CODE.test(org)) redirect(`/support/${org}/tickets/new`);
  return <SupportFindScreen />;
}
