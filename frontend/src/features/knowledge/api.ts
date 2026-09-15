import { api } from '@/lib/api/client';
import type { ArticleInput } from './types';

/* Endpoints of backend/modules/knowledge/routes.py. Read the list with useApi(ARTICLES_PATH). Writing needs the
   admin or manager role (the server answers others with its own Thai message). */

export const ARTICLES_PATH = '/api/articles';

/** What to refresh after an article changes: the list, the audit trail, and the recycle bin after a delete. */
export const ARTICLE_PREFIXES = ['/api/articles', '/api/audit', '/api/trash'];

/** Create (no id) or update an article; answers its id. */
export function saveArticle(id: string | null | undefined, input: ArticleInput) {
  return api<{ id: string }>(id ? `${ARTICLES_PATH}/${id}` : ARTICLES_PATH, input, id ? 'PATCH' : 'POST');
}

/** Moves the article to the recycle bin. */
export function deleteArticle(id: string) {
  return api<{ deleted: string }>(`${ARTICLES_PATH}/${id}`, undefined, 'DELETE');
}
