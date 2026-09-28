'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { PageTheme } from '@/components/shell/TextSize';
import { DialogProvider } from '@/components/ui/Dialogs';
import { ReauthPrompt } from '@/components/ui/ReauthPrompt';
import { ToastProvider } from '@/components/ui/Toast';
import { createQueryClient } from '@/lib/query';

/* What every page has: the API cache, the toast and the two dialogs, the colour theme following the page, and the
   question for the password again before a dangerous act of the platform console. The staff and customer sessions
   are queries in that cache (src/lib/session.ts, src/lib/customer-session.ts), so a dialog's content can read them. */

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <PageTheme />
      <ToastProvider>
        <DialogProvider>
          <ReauthPrompt />
          {children}
        </DialogProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
