import { Suspense } from 'react';
import { PageLoading } from '@/components/ui/display';
import { ContactsScreen } from '@/features/contacts/ContactsScreen';

// The screen may take a customer to show from the address (useSearchParams), so it waits inside Suspense.
export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <ContactsScreen />
    </Suspense>
  );
}
