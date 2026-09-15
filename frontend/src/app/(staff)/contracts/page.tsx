import { ContractsScreen } from '@/features/contracts/ContractsScreen';

// Admins and team leads only: the staff layout sends other members back to the overview (lib/routes.ts roles).
export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string; tab?: string }> }) {
  const { status = '', tab = '' } = await searchParams;
  return <ContractsScreen status={status} tab={tab} />;
}
