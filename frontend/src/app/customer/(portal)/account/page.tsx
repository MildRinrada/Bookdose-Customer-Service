import { param, type SearchParams } from '@/features/auth/params';
import { AccountScreen } from '@/features/customer/AccountScreen';

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <AccountScreen tab={param(await searchParams, 'tab')} />;
}
