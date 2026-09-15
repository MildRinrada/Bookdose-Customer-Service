import { CaseScreen } from '@/features/customer/CaseScreen';
import { CasesScreen } from '@/features/customer/CasesScreen';
import { openedItem } from '@/features/customer/params';

export default async function Page({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  const opened = openedItem(org, id);
  return opened ? <CaseScreen slug={opened.slug} id={opened.id} /> : <CasesScreen />;
}
