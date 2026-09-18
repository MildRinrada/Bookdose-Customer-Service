import { param, type SearchParams } from '@/features/auth/params';
import { StaffPasswordScreen } from '@/features/auth/StaffPasswordScreen';

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const search = await searchParams;
  return <StaffPasswordScreen kind="reset" token={param(search, 'token')} />;
}
