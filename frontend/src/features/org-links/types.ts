/* Shapes of backend/modules/org_links answers (snake_case as sent): the organization's links and QR codes, and what a
   join link shows before signing in. */

/** One invite link of an organization. `qr` is an SVG data: URL drawn by the server, `gone` says why the link no
    longer works ('' while it does). */
export type JoinLink = {
  id: string;
  label: string;
  url: string;
  qr: string;
  created_at: string;
  expires_at: string | null;
  max_uses: number | null;
  uses: number;
  revoked_at: string | null;
  gone: string;
};

/** GET /api/org-links: the organization's permanent link with its QR, and its invite links (newest first). */
export type OrgLinksView = { org_slug: string; org_url: string; org_qr: string; links: JoinLink[] };

/** What a new invite link is made with (nothing set = never expires, anyone may use it). */
export type JoinLinkBody = { label: string; days: number; max_uses: number };

/** GET /api/customer/join-links/<token>: whose link it is, and whether it still works. */
export type JoinPreview = { org_slug: string; org_name: string; valid: boolean; reason: string };
