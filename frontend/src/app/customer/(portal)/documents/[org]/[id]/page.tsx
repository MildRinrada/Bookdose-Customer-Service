import { param, type SearchParams } from '@/features/auth/params';
import { DocumentScreen } from '@/features/customer/DocumentScreen';
import { DocumentsScreen } from '@/features/customer/DocumentsScreen';
import { openedItem } from '@/features/customer/params';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { org, id } = await params;
  const opened = openedItem(org, id);
  return opened ? <DocumentScreen slug={opened.slug} id={opened.id} tab={param(await searchParams, 'tab')} /> : <DocumentsScreen />;
}
