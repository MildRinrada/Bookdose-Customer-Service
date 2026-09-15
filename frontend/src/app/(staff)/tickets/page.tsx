import { Suspense } from 'react';
import { PageLoading } from '@/components/ui/display';
import { TicketsScreen } from '@/features/tickets/TicketsScreen';

// The screen reads its filters from the address (useSearchParams), so it waits inside Suspense.
export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <TicketsScreen />
    </Suspense>
  );
}
