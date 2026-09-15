import { param, type SearchParams } from '@/features/auth/params';
import { BillingScreen } from '@/features/customer/BillingScreen';

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <BillingScreen show={param(await searchParams, 'show')} />;
}
