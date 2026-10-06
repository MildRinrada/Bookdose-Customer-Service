/* Answers of backend/modules/legal, field names as the server sends them. */

export type LegalKey = 'terms' | 'platform-privacy' | 'customer-privacy';

/** A published document as a page or a window shows it (GET /api/legal/<key>). Markdown. */
export type LegalDocument = {
  key: LegalKey;
  version: string;
  title: string;
  body: string;
  published_at: string;
  /** Who published it; the console's own reads carry it, the public one does not. */
  published_by?: string;
};

export type LegalVersion = { version: string; title: string; published_at: string; published_by: string; size: number };

/** One document as the console sees it (GET /api/platform/legal). */
export type LegalEntry = {
  key: LegalKey;
  name: string;
  draft: { key: LegalKey; title: string; body: string; updated_at: string | null; updated_by: string };
  versions: LegalVersion[];
  /** The draft no longer reads as the published version does. */
  changed: boolean;
  /** How many acceptances this document has, over every version. */
  accepted: number;
};

export type LegalOverview = { documents: LegalEntry[] };
