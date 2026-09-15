import { NextResponse, type NextRequest } from 'next/server';

/* Runs before every request.
   - /api/*: forwarded to the Python server by the rewrite in next.config.ts. Here it gets the headers the Python
     server needs to believe the browser's host and address (see backend/middleware/security.py).
   - Pages: a fresh nonce per response, so the Content-Security-Policy allows Next's own scripts and nothing else. */

const DEV = process.env.NODE_ENV === 'development';

export function proxy(request: NextRequest) {
  return request.nextUrl.pathname.startsWith('/api/') ? toApi(request) : page(request);
}

function toApi(request: NextRequest) {
  const headers = new Headers(request.headers);
  // Only this app may speak for the browser; whatever the browser itself sent under these names is dropped.
  headers.delete('x-bookdose-proxy');
  headers.delete('x-bookdose-client-ip');
  const secret = process.env.BOOKDOSE_PROXY_SECRET;
  if (secret) headers.set('x-bookdose-proxy', secret);
  if (process.env.BOOKDOSE_TRUST_FORWARDED_FOR === '1') {
    // The load balancer in front appends the address it saw, so the last entry is the only one it vouches for.
    const address = request.headers.get('x-forwarded-for')?.split(',').pop()?.trim();
    if (address) headers.set('x-bookdose-client-ip', address);
  }
  return NextResponse.next({ request: { headers } });
}

function page(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${DEV ? " 'unsafe-eval'" : ''}`,
    // Development injects styles for hot reload; production only loads stylesheets from this app.
    `style-src 'self' ${DEV ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    `connect-src 'self'${DEV ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', policy);
  response.headers.set('cache-control', 'no-store');
  return response;
}

export const config = {
  matcher: [{ source: '/((?!_next/static|_next/image|favicon.svg|icon.svg).*)' }],
};
