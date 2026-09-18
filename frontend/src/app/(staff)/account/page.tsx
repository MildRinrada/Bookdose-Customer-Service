import { param, type SearchParams } from '@/features/auth/params';
import { StaffAccountScreen } from '@/features/staff-account/StaffAccountScreen';

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <StaffAccountScreen tab={param(await searchParams, 'tab')} />;
}
