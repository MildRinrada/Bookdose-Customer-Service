/* ค้นหาด่วน (backend/modules/search): what GET /api/search?q= answers. Field names are the server's. */

export type SearchCase = { id: string; number: number; subject: string; status: string; updated_at: string; contact_name: string };
export type SearchCustomer = { id: string; name: string; email: string; phone: string; company: string };
export type SearchArticle = { id: string; title: string; category: string; visibility: 'internal' | 'public' };

/** At most five of each; nothing for an empty query. */
export type SearchResults = { query: string; cases: SearchCase[]; customers: SearchCustomer[]; articles: SearchArticle[] };

export const searchPath = (query: string) => `/api/search?q=${encodeURIComponent(query)}`;
