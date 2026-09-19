import type { NextConfig } from 'next';

/* The Python server (app.py) owns every /api/* URL. The browser only ever talks to this app, so the session cookies,
   the CSRF tokens and X-Tenant-ID stay same-origin; src/proxy.ts adds what the Python server needs to trust the
   forwarded host and address. */
const RAW_API_URL = process.env.BOOKDOSE_API_URL ?? 'http://127.0.0.1:8787';
// Render hands a private service over as host:port, without the scheme.
const API_URL = (/^https?:\/\//.test(RAW_API_URL) ? RAW_API_URL : `http://${RAW_API_URL}`).replace(/\/$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  output: 'standalone',
  // The guest pages moved from /chat/<org>… to /support/…; links already sent by email or SMS, shared chat links and
  // bookmarks still arrive at the old addresses. The widget's frame keeps its old address as a page of its own
  // (app/chat/[org]/embed): a redirect could not be framed.
  async redirects() {
    const ID = '(?<id>[a-f0-9]{32})';
    return [
      { source: '/chat/:org', has: [{ type: 'query', key: 'c', value: ID }], destination: '/support/:org/tickets/:id', permanent: true },
      { source: '/chat/:org', destination: '/support/:org/tickets', permanent: true },
      { source: '/chat/:org/resume', destination: '/support/:org/resume', permanent: true },
      { source: '/chat/:org/faq', destination: '/support/:org/faq', permanent: true },
      { source: '/chat/:org/faq/:id', destination: '/support/:org/faq/:id', permanent: true },
      { source: '/chat/:org/cases/:id', destination: '/support/:org/cases/:id', permanent: true },
    ];
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
      {
        // Every path except /support/<org>/embed (and the older /chat/<org>/embed), the chat widget's iframe: its CSP
        // frame-ancestors (src/proxy.ts) names the organization's websites, and X-Frame-Options has no way to say that.
        source: '/:path((?!(?:support|chat)/[^/]+/embed/?$).*)',
        headers: [{ key: 'X-Frame-Options', value: 'DENY' }],
      },
    ];
  },
};

export default nextConfig;
