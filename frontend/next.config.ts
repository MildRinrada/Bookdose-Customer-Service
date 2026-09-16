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
        // Every path except /chat/<org>/embed, the chat widget's iframe: its CSP frame-ancestors (src/proxy.ts) names
        // the organization's websites, and X-Frame-Options has no way to say that.
        source: '/:path((?!chat/[^/]+/embed/?$).*)',
        headers: [{ key: 'X-Frame-Options', value: 'DENY' }],
      },
    ];
  },
};

export default nextConfig;
