import { ArticleScreen } from '@/features/customer/FaqScreen';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ArticleScreen id={id} />;
}
