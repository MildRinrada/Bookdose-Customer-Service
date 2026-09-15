import { param, type SearchParams } from '@/features/auth/params';
import { BillingScreen } from '@/features/customer/BillingScreen';
import { InvoiceScreen } from '@/features/customer/InvoiceScreen';
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
  return opened ? <InvoiceScreen slug={opened.slug} id={opened.id} view={param(await searchParams, 'view')} /> : <BillingScreen />;
}
