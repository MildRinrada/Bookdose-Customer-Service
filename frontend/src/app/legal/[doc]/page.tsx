import { notFound } from 'next/navigation';
import { LegalPage } from '@/features/legal/LegalDocument';
import type { LegalKey } from '@/features/legal/types';

const KEYS: LegalKey[] = ['terms', 'platform-privacy', 'customer-privacy'];

/** /legal/terms, /legal/platform-privacy, /legal/customer-privacy: a published document on a page of its own. */
export default async function Page({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  if (!KEYS.includes(doc as LegalKey)) notFound();
  return <LegalPage doc={doc as LegalKey} />;
}
