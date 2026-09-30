import { AutomationScreen } from '@/features/automation/AutomationScreen';

// Admins and team leads only: the staff layout sends other members back to the overview (lib/routes.ts roles).
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const { tab } = await searchParams;
  return <AutomationScreen tab={typeof tab === 'string' ? tab : undefined} />;
}
