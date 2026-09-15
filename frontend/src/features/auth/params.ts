import { ORG_CODE } from '@/lib/routes';

/* Reading the query of the signed-out pages. Shared by the route files (server) and the screens (client). */

export type SearchParams = Record<string, string | string[] | undefined>;

/** One value of a query parameter ('' when absent). */
export function param(search: SearchParams, key: string): string {
  const value = search[key];
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** ?org=<code>: the organization a customer signs up with; anything that is not a code is ignored. */
export function orgParam(search: SearchParams): string {
  const named = param(search, 'org');
  return ORG_CODE.test(named) ? named : '';
}

/** ?next= only ever points inside this app (a path, never another site). */
export function safeNext(next: string): string {
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '';
}

/** `path` with ?org=<code> added (kept on links between the signed-out pages, like the old #hash links). */
export function withOrg(path: string, org: string): string {
  if (!org) return path;
  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  if (!params.has('org')) params.set('org', org);
  return `${base}?${params.toString()}`;
}
