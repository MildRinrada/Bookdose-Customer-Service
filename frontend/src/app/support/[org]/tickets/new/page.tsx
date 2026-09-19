import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SupportStartScreen } from '@/features/guest/SupportStartScreen';
import { ORG_CODE } from '@/lib/routes';

export const metadata: Metadata = { title: 'เริ่มแชทกับทีมงาน' };

/** /support/<org>/tickets/new: the organization's own link to start a chat without signing in (its website, widget,
    QR or an email point here). */
export default async function SupportStartPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  if (!ORG_CODE.test(org)) notFound();
  return <SupportStartScreen slug={org} />;
}
