import { CustomerLinkScreen } from '@/features/auth/CustomerLinkScreen';
import { orgParam, param, type SearchParams } from '@/features/auth/params';

export default async function CustomerVerifyPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const search = await searchParams;
  return <CustomerLinkScreen kind="verify" token={param(search, 'token')} org={orgParam(search)} />;
}
