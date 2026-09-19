import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { param, type SearchParams } from '@/features/auth/params';
import { GuestChatScreen } from '@/features/guest/GuestChatScreen';
import { ORG_CODE } from '@/lib/routes';

export const metadata: Metadata = { title: 'แชทกับทีมงาน' };

const ID = /^[a-f0-9]{32}$/;

/** /support/<org>/embed (and the older /chat/<org>/embed): the same chat inside the organization's website (public/widget.js). The only page another
    site may frame: src/proxy.ts sets its frame-ancestors to the organization's allowed websites. */
export default async function GuestEmbedPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<SearchParams> }) {
  const [{ org }, search] = await Promise.all([params, searchParams]);
  if (!ORG_CODE.test(org)) notFound();
  const opened = param(search, 'c');
  return <GuestChatScreen slug={org} initialId={ID.test(opened) ? opened : ''} embed />;
}
