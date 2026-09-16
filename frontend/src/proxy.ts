import { NextResponse, type NextRequest } from 'next/server';

/* Runs before every request.
   - /api/*: forwarded to the Python server by the rewrite in next.config.ts. Here it gets the headers the Python
     server needs to believe the browser's host and address (see backend/middleware/security.py).
   - Pages: a fresh nonce per response, so the Content-Security-Policy allows Next's own scripts and nothing else.
     No page may be framed ('none'), except /chat/<org>/embed: its frame-ancestors are the organization's allowed
     websites for the chat widget (GET /api/public/<org>/widget, remembered for a minute), or 'none' when the widget
     is off. next.config.ts leaves X-Frame-Options off that one path for the same reason. connect-src names this
     host's ws:/wss: as well, for the live updates socket (src/lib/realtime.ts); older browsers do not count a
     WebSocket to the same host as 'self'. */

const DEV = process.env.NODE_ENV === 'development';
const RAW_API_URL = process.env.BOOKDOSE_API_URL ?? 'http://127.0.0.1:8787';
const API_URL = (/^https?:\/\//.test(RAW_API_URL) ? RAW_API_URL : `http://${RAW_API_URL}`).replace(/\/$/, '');

const EMBED_PAGE = /^\/chat\/([a-z0-9]+(?:-[a-z0-9]+)*)\/embed\/?$/;
// What may go into the policy: scheme://host[:port] and nothing else (no spaces, quotes or semicolons).
const ORIGIN = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/;
// The Host header as it may go into the policy (a name or IPv4/IPv6 address and a port, nothing else).
const HOST = /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;
const ANCESTORS_TTL_MS = 60_000;
const ANCESTORS_FAILED_TTL_MS = 10_000;
const ancestorsCache = new Map<string, { value: string; until: number }>();

export async function proxy(request: NextRequest) {
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

/** The websites allowed to frame the organization's embedded chat, as a frame-ancestors source list. */
async function frameAncestors(slug: string, request: NextRequest): Promise<string> {
  const now = Date.now();
  const cached = ancestorsCache.get(slug);
  if (cached && cached.until > now) return cached.value;
  let value = "'none'";
  let ttl = ANCESTORS_TTL_MS;
  try {
    const headers: Record<string, string> = { accept: 'application/json', 'x-forwarded-host': request.headers.get('host') ?? request.nextUrl.host };
    const secret = process.env.BOOKDOSE_PROXY_SECRET;
    if (secret) headers['x-bookdose-proxy'] = secret;
    const response = await fetch(`${API_URL}/api/public/${slug}/widget`, { headers, cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      const widget = (await response.json()) as { enabled?: boolean; guest_chat?: boolean; origins?: unknown };
      const origins = Array.isArray(widget.origins) ? widget.origins.filter((o): o is string => typeof o === 'string' && ORIGIN.test(o)) : [];
      if (widget.enabled && widget.guest_chat !== false && origins.length) value = origins.join(' ');
    } else if (response.status >= 500 || response.status === 429) ttl = ANCESTORS_FAILED_TTL_MS;
  } catch {
    // The API did not answer: refuse framing for now and ask again soon.
    ttl = ANCESTORS_FAILED_TTL_MS;
  }
  if (ancestorsCache.size > 500) ancestorsCache.clear();
  ancestorsCache.set(slug, { value, until: now + ttl });
  return value;
}

async function page(request: NextRequest) {
  const embed = EMBED_PAGE.exec(request.nextUrl.pathname);
  const ancestors = embed ? await frameAncestors(embed[1], request) : "'none'";
  const nonce = btoa(crypto.randomUUID());
  const host = request.headers.get('host') ?? '';
  const sockets = HOST.test(host) ? ` ws://${host} wss://${host}` : '';
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${DEV ? " 'unsafe-eval'" : ''}`,
    // Development injects styles for hot reload; production only loads stylesheets from this app.
    `style-src 'self' ${DEV ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    `connect-src 'self'${DEV ? ' ws: wss:' : sockets}`,
    "object-src 'none'",
    `frame-ancestors ${ancestors}`,
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
  // widget.js is a plain script other websites load: no page policy on it.
  matcher: [{ source: '/((?!_next/static|_next/image|favicon.svg|icon.svg|widget.js).*)' }],
};
