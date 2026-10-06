import { PdpaScreen } from '@/features/pdpa/PdpaScreen';

// ?q=<email>: opened from a found account (บัญชีผู้ใช้), the search runs at once.
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { q } = await searchParams;
  return <PdpaScreen initialQuery={typeof q === 'string' ? q : undefined} />;
}
