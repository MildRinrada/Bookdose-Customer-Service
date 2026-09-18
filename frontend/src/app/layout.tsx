import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { EARLY_PREFERENCES_SCRIPT } from '@/components/shell/TextSize';
import { Providers } from './providers';

// The stylesheets of the app, in their cascade order: structure first, then pages, text size and the color theme.
import '@/styles/base.css';
import '@/styles/components.css';
import '@/styles/layout.css';
import '@/styles/pages/auth.css';
import '@/styles/pages/dashboard.css';
import '@/styles/pages/dashboard-extras.css';
import '@/styles/pages/tickets.css';
import '@/styles/pages/inbox.css';
import '@/styles/pages/contacts.css';
import '@/styles/pages/knowledge.css';
import '@/styles/pages/reports.css';
import '@/styles/pages/settings.css';
import '@/styles/pages/audit.css';
import '@/styles/pages/trash.css';
import '@/styles/pages/notifications.css';
import '@/styles/pages/platform.css';
import '@/styles/pages/platform-health.css';
import '@/styles/pages/customer.css';
import '@/styles/pages/dashboard-customer.css';
import '@/styles/pages/alerts-customer.css';
import '@/styles/pages/account-settings.css';
import '@/styles/pages/security.css';
import '@/styles/pages/org-links.css';
import '@/styles/pages/automation.css';
import '@/styles/pages/guest-chat.css';
import '@/styles/pages/inbox-calm.css';
import '@/styles/pages/ai-assistant.css';
import '@/styles/pages/celebrations.css';
import '@/styles/text-size.css';
import '@/styles/theme.css';
import '@/styles/refresh.css';

export const metadata: Metadata = {
  title: 'Bookdose · Customer Service',
  description: 'Bookdose Customer Service - พื้นที่ดูแลลูกค้าสำหรับทุกองค์กร',
  icons: { icon: { url: '/favicon.svg', type: 'image/svg+xml' } },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#26292d' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every page is rendered per request with the nonce src/proxy.ts put in the Content-Security-Policy.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    // The first script sets data-text-size and the collapsed sidebar before React hydrates.
    <html lang="th" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: EARLY_PREFERENCES_SCRIPT }} />
      </head>
      <body>
        <Providers>
          <div id="app">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
