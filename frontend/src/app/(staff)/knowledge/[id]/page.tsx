import { KnowledgeScreen } from '@/features/knowledge/KnowledgeScreen';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tenant?: string | string[] }>;
}) {
  const [{ id }, { tenant }] = await Promise.all([params, searchParams]);
  return <KnowledgeScreen id={id} tenant={typeof tenant === 'string' ? tenant : undefined} />;
}
