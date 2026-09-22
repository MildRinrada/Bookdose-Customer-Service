/* Shapes of backend/modules/knowledge answers (field names as the server sends them). */

export type ArticleVisibility = 'public' | 'internal';

/** How the team used an article (knowledge_uses, knowledge_marks); my_vote and pin_order are the member's own. */
export type ArticleActivity = {
  uses: number;
  used_at: string | null;
  helpful: number;
  unhelpful: number;
  my_vote: -1 | 0 | 1;
  /** 1 = first of the member's pins; 0 = not pinned. */
  pin_order: number;
};

/** A row of GET /api/articles (knowledge_articles, newest update first). */
export type Article = {
  id: string;
  title: string;
  category: string;
  body: string;
  visibility: ArticleVisibility | string;
  author: string;
  updated_at: string;
} & Partial<ArticleActivity> & { revisions?: number };

export type ArticlesPage = { articles: Article[] };

/** What the article form sends (POST /api/articles, PATCH /api/articles/<id>). */
export type ArticleInput = { title: string; category: string; body: string; visibility: string };

export type ArticleSort = 'updated' | 'used' | 'title' | 'category';

export type ArticleUseKind = 'copy' | 'insert' | 'link';

/** A version an article had before a save (GET /api/articles/<id>/revisions, newest first). */
export type ArticleRevision = {
  id: string;
  title: string;
  category: string;
  body: string;
  visibility: string;
  author: string;
  saved_at: string;
  replaced_by: string;
  replaced_at: string;
};

/** A ready-made answer in คลังบทความแม่แบบ, as an organization sees it (GET /api/article-templates). */
export type ArticleTemplate = { id: string; title: string; category: string; body: string; taken: boolean };
