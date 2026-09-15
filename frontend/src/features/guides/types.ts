/* Shapes of the Bookdose guides (backend/modules/platform: global articles written for staff). */

/** A row of GET /api/guides. */
export type Guide = { id: string; title: string; category: string; body: string; updated_at: string };

/** GET /api/guides */
export type GuidesPage = { articles: Guide[] };
