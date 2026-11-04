import type { QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { ArticleActivity, ArticleImport, ArticleInput, ArticlesPage, ArticleUseKind } from './types';

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

/* คลังบทความแม่แบบ: what the Bookdose team has already written, and taking a copy of one. The copy is this
   organization's own article from that moment (backend knowledge/service.py use_template). */
export const TEMPLATES_PATH = '/api/article-templates';

export const useTemplate = (id: string, visibility: 'public' | 'internal') =>
  api<{ id: string }>(`${TEMPLATES_PATH}/${id}/use`, { visibility });

/* นำเข้าบทความ (backend/modules/knowledge/importer.py). The file goes up once, as base64 in the JSON body, and is
   not kept: what stays is the drafts, for a week. */
export const IMPORTS_PATH = '/api/article-imports';
export const importPath = (id: string) => `${IMPORTS_PATH}/${id}`;
/** As the server takes (importer.MAX_FILE_BYTES). */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_ACCEPT = '.pdf,.docx,.txt,.md';

function base64Of(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('อ่านไฟล์ในเครื่องไม่สำเร็จ ลองเลือกไฟล์ใหม่'));
    reader.readAsDataURL(file);
  });
}

export async function startImport(file: File) {
  return api<ArticleImport>(IMPORTS_PATH, { name: file.name, data: await base64Of(file) });
}

/** Save drafts as articles; an item carries the words changed in the editor, the rest keep the draft's. */
export const saveDrafts = (id: string, items: Array<{ draft_id: string } & Partial<ArticleInput>>) =>
  api<{ saved: Array<{ draft_id: string; article_id: string }>; finished: boolean }>(`${importPath(id)}/save`, { items });

export type DraftAction = 'skip' | 'keep' | 'use_rewrite' | 'use_source' | 'drop_rewrite';
export const setDraft = (id: string, draftId: string, action: DraftAction) =>
  api<ArticleImport>(`${importPath(id)}/drafts/${draftId}`, { action }, 'PATCH');
export const rewriteDraft = (id: string, draftId: string) => api<ArticleImport>(`${importPath(id)}/drafts/${draftId}/rewrite`, {});
export const skipImportAi = (id: string) => api<ArticleImport>(`${importPath(id)}/skip-ai`, {});
export const discardImport = (id: string) => api<{ deleted: string }>(importPath(id), undefined, 'DELETE');
