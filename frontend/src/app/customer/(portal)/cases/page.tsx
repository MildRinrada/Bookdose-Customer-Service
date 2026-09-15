import { param, type SearchParams } from '@/features/auth/params';
import { CasesScreen } from '@/features/customer/CasesScreen';

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <CasesScreen show={param(await searchParams, 'show')} />;
}
