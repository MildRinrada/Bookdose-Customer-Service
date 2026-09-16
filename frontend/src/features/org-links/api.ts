import { api } from '@/lib/api/client';
import type { CustomerOrg } from '@/lib/types';
import type { JoinLink, JoinLinkBody, JoinPreview } from './types';

/* Endpoints of backend/modules/org_links/routes.py: the organization's join links (ตั้งค่าองค์กร, admin only), the
   link a customer opens at /join/<token> (also pasted on the account page). */

export const ORG_LINKS_PATH = '/api/org-links';

/** The preview of a link is public (nobody has to be signed in to see whose organization it is). */
export const joinLinkPath = (token: string) => `/api/customer/join-links/${encodeURIComponent(token)}`;

export const createJoinLink = (body: JoinLinkBody) => api<JoinLink>(ORG_LINKS_PATH, body);

export const revokeJoinLink = (id: string) => api<{ ok: true }>(`${ORG_LINKS_PATH}/${id}`, undefined, 'DELETE');

/** Join the organization of the link (signed in); refuses a revoked, expired or used-up link. */
export const joinByLink = (token: string) => api<{ organization: CustomerOrg }>(joinLinkPath(token), {});

export const previewJoinLink = (token: string) => api<JoinPreview>(joinLinkPath(token));
