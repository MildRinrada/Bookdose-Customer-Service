import { orgParam, type SearchParams } from '@/features/auth/params';
import { ChatsScreen } from '@/features/customer/ChatsScreen';

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <ChatsScreen newChat preselect={orgParam(await searchParams)} />;
}
