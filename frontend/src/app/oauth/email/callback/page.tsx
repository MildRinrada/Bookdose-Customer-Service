import type { Metadata } from 'next';
import { OAuthCallbackScreen } from '@/features/auth/OAuthCallbackScreen';
import { param, type SearchParams } from '@/features/auth/params';

// The address carries a single-use code: never pass it on to another site.
export const metadata: Metadata = { title: 'เชื่อมบัญชีอีเมล · Bookdose', referrer: 'no-referrer' };

export default async function EmailOAuthCallbackPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const search = await searchParams;
  return (
    <OAuthCallbackScreen
      state={param(search, 'state') || null}
      code={param(search, 'code') || null}
      denied={search.error !== undefined}
    />
  );
}
