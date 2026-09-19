import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GuestChatScreen } from '@/features/guest/GuestChatScreen';
import { ORG_CODE } from '@/lib/routes';

export const metadata: Metadata = { title: 'แชทกับทีมงาน' };

/** /support/<org>/tickets: this browser's chats with an organization without signing in (the newest opens), or the
    start form when there are none yet. */
export default async function GuestTicketsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  if (!ORG_CODE.test(org)) notFound();
  return <GuestChatScreen slug={org} />;
}
