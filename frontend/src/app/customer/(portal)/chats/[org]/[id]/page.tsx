import { ChatsScreen } from '@/features/customer/ChatsScreen';
import { openedItem } from '@/features/customer/params';

export default async function Page({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  const opened = openedItem(org, id);
  return opened ? <ChatsScreen slug={opened.slug} id={opened.id} /> : <ChatsScreen />;
}
