/* Honeypots of the web app (docs/security/monitoring-and-traps.md).
   - Decoy page paths: addresses scanners and bots try (leaked config files, other CMSs' admin pages). No page of this
     app lives there and no person using the app ever opens one. src/proxy.ts answers them exactly like any unknown
     address (the app's 404 page) and, after the answer, reports the hit to the API (POST /api/trap).
   - Shared-file links: /files/<token> looks like a shared document (a honeytoken the Superadmin planted). The page
     says the file has moved; src/proxy.ts reports the visit the same way, and the API decides whether the token is
     one of its honeytokens.
   None of these may ever shadow a real route of this app. */

/** Exact decoy paths, lower case, without a trailing slash. */
export const DECOY_PAGE_PATHS: readonly string[] = [
  '/.env',
  '/.env.local',
  '/.git/config',
  '/wp-login.php',
  '/wp-admin',
  '/xmlrpc.php',
  '/phpmyadmin',
  '/pma',
  '/admin.php',
  '/administrator',
  '/server-status',
  '/actuator/env',
  '/config.json',
  '/backup.zip',
  '/backup.sql',
  '/db.sql',
  '/.ds_store',
  '/id_rsa',
];

/** Decoy prefixes: the path itself and everything below it. */
export const DECOY_PAGE_PREFIXES: readonly string[] = ['/vendor/phpunit'];

const EXACT = new Set(DECOY_PAGE_PATHS);

/** The path as the decoy list is written: percent-decoded, lower case, no trailing slash, no repeated slashes. */
function normalise(pathname: string): string {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // A broken escape stays as it was.
  }
  path = path.toLowerCase().replace(/\/{2,}/g, '/');
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/** True for a decoy page path (never for /api/*: the API has its own decoys). */
export function isDecoyPagePath(pathname: string): boolean {
  if (pathname.startsWith('/api/')) return false;
  const path = normalise(pathname);
  return EXACT.has(path) || DECOY_PAGE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** /files/<token>: one path segment (src/app/files/[token]/page.tsx). */
export const FILE_LINK_PATH = /^\/files\/([^/]{1,200})\/?$/;

/** The internal report endpoint of the API; browsers never reach it (src/proxy.ts). */
export const TRAP_API_PATH = '/api/trap';
