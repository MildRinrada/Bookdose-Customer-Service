import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GuestFaqScreen } from '@/features/guest/GuestFaqScreen';
import { ORG_CODE } from '@/lib/routes';

export const metadata: Metadata = { title: 'คำถามที่พบบ่อย' };

/** /support/<org>/faq: the organization's published answers, without signing in. */
export default async function GuestFaqPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  if (!ORG_CODE.test(org)) notFound();
  return <GuestFaqScreen slug={org} />;
}
