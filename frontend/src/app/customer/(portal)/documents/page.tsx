import { param, type SearchParams } from '@/features/auth/params';
import { DocumentsScreen } from '@/features/customer/DocumentsScreen';

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <DocumentsScreen show={param(await searchParams, 'show')} />;
}
