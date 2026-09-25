import { SecurityScreen } from '@/features/security/SecurityScreen';

// ?tab=checkup | events | access | traps | vulns | settings opens that part of the page (the overview without it).
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const { tab } = await searchParams;
  return <SecurityScreen tab={typeof tab === 'string' ? tab : undefined} />;
}
