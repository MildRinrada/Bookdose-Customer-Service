import { AuthScreen } from '@/features/auth/AuthScreen';
import { orgParam, param, safeNext, type SearchParams } from '@/features/auth/params';

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const search = await searchParams;
  return (
    <AuthScreen
      page="login"
      tab={param(search, 'tab') === 'signup' ? 'signup' : 'login'}
      org={orgParam(search)}
      next={safeNext(param(search, 'next'))}
    />
  );
}
