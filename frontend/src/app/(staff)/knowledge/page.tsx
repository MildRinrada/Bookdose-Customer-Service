import { KnowledgeScreen } from '@/features/knowledge/KnowledgeScreen';

export default async function Page({ searchParams }: { searchParams: Promise<{ tenant?: string | string[] }> }) {
  const { tenant } = await searchParams;
  return <KnowledgeScreen tenant={typeof tenant === 'string' ? tenant : undefined} />;
}
