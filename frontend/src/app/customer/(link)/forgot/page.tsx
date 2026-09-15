import { CustomerLinkScreen } from '@/features/auth/CustomerLinkScreen';
import { orgParam, type SearchParams } from '@/features/auth/params';

export default async function CustomerForgotPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const search = await searchParams;
  return <CustomerLinkScreen kind="forgot" org={orgParam(search)} />;
}
