import { ImportScreen } from '@/features/knowledge/ImportScreen';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ImportScreen id={id} />;
}
