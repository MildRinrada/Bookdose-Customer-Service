import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GuestResumeScreen } from '@/features/guest/GuestResumeScreen';
import { ORG_CODE } from '@/lib/routes';

export const metadata: Metadata = { title: 'เปิดแชทจากลิงก์' };

/** /chat/<org>/resume#t=<token>: a follow link from email or SMS (the token never leaves the browser's fragment). */
export default async function GuestResumePage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  if (!ORG_CODE.test(org)) notFound();
  return <GuestResumeScreen slug={org} />;
}
