import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GuestChatScreen } from '@/features/guest/GuestChatScreen';
import { ORG_CODE } from '@/lib/routes';

export const metadata: Metadata = { title: 'แชทกับทีมงาน' };

const ID = /^[a-f0-9]{32}$/;

/** /support/<org>/tickets/<id>: one of this browser's chats with an organization, without signing in. */
export default async function GuestTicketPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  if (!ORG_CODE.test(org) || !ID.test(id)) notFound();
  return <GuestChatScreen slug={org} initialId={id} />;
}
