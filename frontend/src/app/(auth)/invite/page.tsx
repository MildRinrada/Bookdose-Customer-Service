import { param, type SearchParams } from '@/features/auth/params';
import { InvitationScreen } from '@/features/auth/InvitationScreen';

export default async function InvitePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const search = await searchParams;
  return <InvitationScreen token={param(search, 'token')} />;
}
