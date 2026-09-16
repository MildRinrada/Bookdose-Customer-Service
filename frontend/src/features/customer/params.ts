import { ORG_CODE } from '@/lib/routes';

/* The route files (server) check an opened chat or case address the way the old router did:
   an organization code and a 32-character id, otherwise the list opens. */

const ID = /^[a-f0-9]{32}$/;

export function openedItem(org: string, id: string): { slug: string; id: string } | null {
  return ORG_CODE.test(org) && ID.test(id) ? { slug: org, id } : null;
}
