import type { QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { ArticleActivity, ArticleInput, ArticlesPage, ArticleUseKind } from './types';

/* Endpoints of backend/modules/knowledge/routes.py. Read the list with useApi(ARTICLES_PATH). Writing needs the
   admin or manager role (the server answers others with its own Thai message); using, marking and pinning an
   article is every member's. */

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

export const revisionsPath = (id: string) => `${ARTICLES_PATH}/${id}/revisions`;

type ActivityAnswer = ArticleActivity & { id: string };

/** Puts the server's new numbers of one article into the cached list, so every card shows them at once. */
export function keepActivity(client: QueryClient, answer: ActivityAnswer) {
  client.setQueryData<ArticlesPage>([ARTICLES_PATH], (page) =>
    page ? { articles: page.articles.map((a) => (a.id === answer.id ? { ...a, ...answer } : a)) } : page,
  );
}

/** The member copied it, put it in a reply or sent its link; a failure is not the member's concern. */
export function recordUse(client: QueryClient, id: string, kind: ArticleUseKind) {
  void api<ActivityAnswer>(`${ARTICLES_PATH}/${id}/use`, { kind }).then(
    (answer) => keepActivity(client, answer),
    () => undefined,
  );
}

/** 1 = helpful, -1 = not helpful, 0 = take the mark back. */
export async function voteArticle(client: QueryClient, id: string, vote: -1 | 0 | 1) {
  keepActivity(client, await api<ActivityAnswer>(`${ARTICLES_PATH}/${id}/vote`, { vote }));
}

/** The member's pinned articles become exactly `ids`, in that order (shown at once, then saved). */
export async function savePins(client: QueryClient, ids: string[]) {
  const before = client.getQueryData<ArticlesPage>([ARTICLES_PATH]);
  client.setQueryData<ArticlesPage>([ARTICLES_PATH], (page) =>
    page ? { articles: page.articles.map((a) => ({ ...a, pin_order: ids.indexOf(a.id) + 1 })) } : page,
  );
  try {
    await api<{ pins: string[] }>(`${ARTICLES_PATH}/pins`, { ids });
  } catch (error) {
    client.setQueryData([ARTICLES_PATH], before);
    throw error;
  }
}
