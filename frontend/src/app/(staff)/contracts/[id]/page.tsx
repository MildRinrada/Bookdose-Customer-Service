import { ContractDetailScreen } from '@/features/contracts/ContractDetailScreen';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; invoice?: string; view?: string }>;
}) {
  const { id } = await params;
  const { tab = '', invoice = '', view = '' } = await searchParams;
  return <ContractDetailScreen id={id} tab={tab} invoice={invoice} view={view} />;
}
