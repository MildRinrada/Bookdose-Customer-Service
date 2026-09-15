/* Shapes of backend/modules/knowledge answers (field names as the server sends them). */

export type ArticleVisibility = 'public' | 'internal';

/** A row of GET /api/articles (knowledge_articles, newest update first). */
export type Article = {
  id: string;
  title: string;
  category: string;
  body: string;
  visibility: ArticleVisibility | string;
  author: string;
  updated_at: string;
};

export type ArticlesPage = { articles: Article[] };

/** What the article form sends (POST /api/articles, PATCH /api/articles/<id>). */
export type ArticleInput = { title: string; category: string; body: string; visibility: string };

export type ArticleSort = 'updated' | 'title' | 'category';
