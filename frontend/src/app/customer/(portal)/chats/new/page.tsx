import { orgParam, param, type SearchParams } from '@/features/auth/params';
import { ChatsScreen } from '@/features/customer/ChatsScreen';

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // ?follows=<chat id>: the new chat carries on from that one (ต่อจากเรื่องเดิม).
  const params = await searchParams;
  return <ChatsScreen newChat preselect={orgParam(params)} follows={param(params, 'follows')} />;
}
