import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { FILE_LINK_PATH, isDecoyPagePath, TRAP_API_PATH } from '@/lib/traps';

/* Runs before every request.
   - /api/*: forwarded to the Python server by the rewrite in next.config.ts. Here it gets the headers the Python
     server needs to believe the browser's host and address (see backend/middleware/security.py).
   - Pages: a fresh nonce per response, so the Content-Security-Policy allows Next's own scripts and nothing else.
     No page may be framed ('none'), except /support/<org>/embed (and the older /chat/<org>/embed): its frame-ancestors are the organization's allowed
     websites for the chat widget (GET /api/public/<org>/widget, remembered for a minute), or 'none' when the widget
     is off. next.config.ts leaves X-Frame-Options off that one path for the same reason. connect-src names this
     host's ws:/wss: as well, for the live updates socket (src/lib/realtime.ts); older browsers do not count a
     WebSocket to the same host as 'self'.
   - Traps (docs/security/monitoring-and-traps.md, src/lib/traps.ts): a decoy page path and a /files/<token> link are answered
     exactly as they would be anyway (the 404 page / the "file moved" page, same headers); the visit is reported to
     the API in the background (POST /api/trap) with the same trusted address API requests carry, never an address
     the browser claims. */

const DEV = process.env.NODE_ENV === 'development';
const RAW_API_URL = process.env.BOOKDOSE_API_URL ?? 'http://127.0.0.1:8787';
const API_URL = (/^https?:\/\//.test(RAW_API_URL) ? RAW_API_URL : `http://${RAW_API_URL}`).replace(/\/$/, '');

// Cloudflare Turnstile: its script (which 'strict-dynamic' would allow anyway, for browsers that do not know it) and
// the frame it draws the challenge in. Named nowhere else: no other outside script or frame may load.
const TURNSTILE = 'https://challenges.cloudflare.com';
const EMBED_PAGE = /^\/(?:support|chat)\/([a-z0-9]+(?:-[a-z0-9]+)*)\/embed\/?$/;
// What may go into the policy: scheme://host[:port] and nothing else (no spaces, quotes or semicolons).
const ORIGIN = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/;
// The Host header as it may go into the policy (a name or IPv4/IPv6 address and a port, nothing else).
const HOST = /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;
const ANCESTORS_TTL_MS = 60_000;
const ANCESTORS_FAILED_TTL_MS = 10_000;
const ancestorsCache = new Map<string, { value: string; until: number }>();

// A help-centre address and the code in it. /support/tickets/new belongs to nobody, so it is left alone.
const SUPPORT_PAGE = /^\/(?:support|chat)\/([a-z0-9]+(?:-[a-z0-9]+)*)(\/.*)?$/;
const NOT_A_CODE = new Set(['tickets']);
const CODE_TTL_MS = 300_000;
const CODE_FAILED_TTL_MS = 10_000;
const codeCache = new Map<string, { value: string; until: number }>();

// Marks the web app's own trap report; a browser's request never carries it past this proxy.
const TRAP_HEADER = 'x-bookdose-trap';

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  if (request.nextUrl.pathname.startsWith('/api/')) return toApi(request);
  const moved = await movedCode(request);
  if (moved) return moved;
  const response = await page(request);
  if (trapVisit(request)) event.waitUntil(reportTrap(request));
  return response;
}

/** Set what lets the Python server believe this app about the browser: the proxy secret (when configured) and the
    address the load balancer in front vouches for. Whatever the browser sent under these names is dropped. */
function vouch(headers: Headers, request: NextRequest) {
  headers.delete('x-bookdose-proxy');
  headers.delete('x-bookdose-client-ip');
  headers.delete(TRAP_HEADER);
  const secret = process.env.BOOKDOSE_PROXY_SECRET;
  if (secret) headers.set('x-bookdose-proxy', secret);
  if (process.env.BOOKDOSE_TRUST_FORWARDED_FOR === '1') {
    // The load balancer in front appends the address it saw, so the last entry is the only one it vouches for.
    const address = request.headers.get('x-forwarded-for')?.split(',').pop()?.trim();
    if (address) headers.set('x-bookdose-client-ip', address);
  }
}

function toApi(request: NextRequest) {
  const headers = new Headers(request.headers);
  // Only this app may speak for the browser.
  vouch(headers, request);
  return NextResponse.next({ request: { headers } });
}

/** A page request that touches a trap: a decoy path, or a document request for a shared-file link. */
function trapVisit(request: NextRequest): boolean {
  const path = request.nextUrl.pathname;
  if (isDecoyPagePath(path)) return true;
  // Opening the link counts once; the RSC data request of a client-side navigation or prefetch does not count again.
  return (
    FILE_LINK_PATH.test(path) &&
    !request.nextUrl.searchParams.has('_rsc') &&
    !request.headers.has('rsc') &&
    !request.headers.has('next-router-prefetch')
  );
}

/** POST /api/trap {path, method, user_agent} straight to the Python server, after the answer has gone. Failures are
    swallowed: the visitor's answer never depends on it. */
async function reportTrap(request: NextRequest) {
  const headers = new Headers({
    accept: 'application/json',
    'content-type': 'application/json',
    'x-forwarded-host': request.headers.get('host') ?? request.nextUrl.host,
  });
  vouch(headers, request);
  headers.set(TRAP_HEADER, '1');
  const body = JSON.stringify({
    path: request.nextUrl.pathname.slice(0, 500),
    method: request.method.slice(0, 16),
    user_agent: (request.headers.get('user-agent') ?? '').slice(0, 300),
  });
  try {
    await fetch(`${API_URL}${TRAP_API_PATH}`, { method: 'POST', headers, body, cache: 'no-store', signal: AbortSignal.timeout(5000) });
  } catch {
    // The API did not answer; the hit is lost, the visitor sees nothing different.
  }
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

/** The code this organization goes by now. A code that was corrected keeps leading to the organization, so a link
    made with the old one still works; this is what lets the address bar catch up with it instead of showing a code
    the organization no longer uses. Returns the code unchanged when nothing says otherwise. */
async function canonicalCode(slug: string, request: NextRequest): Promise<string> {
  const now = Date.now();
  const cached = codeCache.get(slug);
  if (cached && cached.until > now) return cached.value;
  let value = slug;
  let ttl = CODE_TTL_MS;
  try {
    const headers: Record<string, string> = { accept: 'application/json', 'x-forwarded-host': request.headers.get('host') ?? request.nextUrl.host };
    const secret = process.env.BOOKDOSE_PROXY_SECRET;
    if (secret) headers['x-bookdose-proxy'] = secret;
    const response = await fetch(`${API_URL}/api/public/${slug}/code`, { headers, cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      const answer = (await response.json()) as { slug?: unknown };
      if (typeof answer.slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(answer.slug)) value = answer.slug;
    } else if (response.status >= 500 || response.status === 429) ttl = CODE_FAILED_TTL_MS;
  } catch {
    // The API did not answer: leave the address alone and ask again soon.
    ttl = CODE_FAILED_TTL_MS;
  }
  if (codeCache.size > 500) codeCache.clear();
  codeCache.set(slug, { value, until: now + ttl });
  return value;
}

/** A help-centre link made with a code that has since been corrected: send the browser to the current address, so
    what is copied out of the address bar from here on is the code the organization actually uses. The fragment of
    the original address (a follow link's #t=…) rides along, which is what browsers do when the new address has
    none of its own. */
async function movedCode(request: NextRequest): Promise<NextResponse | null> {
  const match = SUPPORT_PAGE.exec(request.nextUrl.pathname);
  if (!match || NOT_A_CODE.has(match[1])) return null;
  const current = await canonicalCode(match[1], request);
  if (current === match[1]) return null;
  const moved = request.nextUrl.clone();
  moved.pathname = request.nextUrl.pathname.replace(`/${match[1]}`, `/${current}`);
  return NextResponse.redirect(moved, 308);
}

async function page(request: NextRequest) {
  const embed = EMBED_PAGE.exec(request.nextUrl.pathname);
  const ancestors = embed ? await frameAncestors(embed[1], request) : "'none'";
  const nonce = btoa(crypto.randomUUID());
  const host = request.headers.get('host') ?? '';
  const sockets = HOST.test(host) ? ` ws://${host} wss://${host}` : '';
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${TURNSTILE}${DEV ? " 'unsafe-eval'" : ''}`,
    // Development injects styles for hot reload; production only loads stylesheets from this app.
    `style-src 'self' ${DEV ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    `connect-src 'self'${DEV ? ' ws: wss:' : sockets}`,
    "object-src 'none'",
    // The bot check on the public support form draws its challenge in a frame of Cloudflare's (ui/Turnstile.tsx).
    `frame-src 'self' ${TURNSTILE}`,
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
  matcher: [{ source: '/((?!_next/static|_next/image|favicon.svg|icon.svg|logo.png|notify-icon.png|widget.js).*)' }],
};
