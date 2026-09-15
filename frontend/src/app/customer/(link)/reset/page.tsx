import { CustomerLinkScreen } from '@/features/auth/CustomerLinkScreen';
import { orgParam, param, type SearchParams } from '@/features/auth/params';

export default async function CustomerResetPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const search = await searchParams;
  return <CustomerLinkScreen kind="reset" token={param(search, 'token')} org={orgParam(search)} />;
}
