import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PdpaLetter } from '@/features/pdpa/PdpaLetter';

/* /platform/pdpa/letter/<id>: the letter to the person a PDPA request was about, opened in a tab of its own from the
   tool's history. Outside the console's frame ((staff)/layout) so that what the browser prints, or saves as PDF, is
   the letter alone; the API still answers platform admins only. */

export const metadata: Metadata = {
  title: 'หนังสือแจ้งผลถึงเจ้าของข้อมูล - Bookdose',
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9]{32}$/.test(id)) notFound();
  return <PdpaLetter id={id} />;
}
