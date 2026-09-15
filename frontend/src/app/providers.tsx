'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { DialogProvider } from '@/components/ui/Dialogs';
import { ToastProvider } from '@/components/ui/Toast';
import { createQueryClient } from '@/lib/query';

/* What every page has: the API cache, the toast and the two dialogs. The staff and customer sessions are queries in
   that cache (src/lib/session.ts, src/lib/customer-session.ts), so a dialog's content can read them too. */

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <DialogProvider>{children}</DialogProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
