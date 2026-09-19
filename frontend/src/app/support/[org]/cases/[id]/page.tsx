import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GuestCaseScreen } from '@/features/guest/GuestCaseScreen';
import { ORG_CODE } from '@/lib/routes';

export const metadata: Metadata = { title: 'ติดตามเคส' };

const ID = /^[a-f0-9]{32}$/;

/** /support/<org>/cases/<id>: a visitor follows the case opened from their chat, without signing in. */
export default async function GuestCasePage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  if (!ORG_CODE.test(org) || !ID.test(id)) notFound();
  return <GuestCaseScreen slug={org} id={id} />;
}
