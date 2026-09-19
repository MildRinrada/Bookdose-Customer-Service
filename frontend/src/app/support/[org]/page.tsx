import { notFound, redirect } from 'next/navigation';
import { ORG_CODE } from '@/lib/routes';

/** /support/<org>: the organization's chats. */
export default async function GuestOrgPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  if (!ORG_CODE.test(org)) notFound();
  redirect(`/support/${org}/tickets`);
}
