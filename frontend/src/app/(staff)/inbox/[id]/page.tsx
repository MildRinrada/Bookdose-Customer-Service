import { InboxScreen } from '@/features/inbox/InboxScreen';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InboxScreen id={id} />;
}
