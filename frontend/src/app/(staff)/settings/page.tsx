import { SettingsScreen } from '@/features/settings/SettingsScreen';

// Organization admins only: the staff layout sends other members back to the overview (lib/routes.ts roles).
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const { tab } = await searchParams;
  return <SettingsScreen tab={typeof tab === 'string' ? tab : undefined} />;
}
