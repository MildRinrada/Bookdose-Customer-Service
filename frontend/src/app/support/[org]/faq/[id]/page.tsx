import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GuestArticleScreen } from '@/features/guest/GuestFaqScreen';
import { ORG_CODE } from '@/lib/routes';

export const metadata: Metadata = { title: 'คำถามที่พบบ่อย' };

const ID = /^[a-f0-9]{32}$/;

/** /support/<org>/faq/<id>: one published answer (the link a team sends in a chat), without signing in. */
export default async function GuestArticlePage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  if (!ORG_CODE.test(org) || !ID.test(id)) notFound();
  return <GuestArticleScreen slug={org} id={id} />;
}
