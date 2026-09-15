import { param, type SearchParams } from '@/features/auth/params';
import { VerificationScreen } from '@/features/auth/VerificationScreen';

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const search = await searchParams;
  return <VerificationScreen page="verify-email" token={param(search, 'token')} />;
}
