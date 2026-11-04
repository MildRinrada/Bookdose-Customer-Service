import type { AiJobProgress } from '@/features/ai/types';

/* Shapes of backend/modules/knowledge answers (field names as the server sends them). */

export type ArticleVisibility = 'public' | 'internal';

/** How the team used an article (knowledge_uses, knowledge_marks; pin_order is the member's own) and what customers
    said of it (helpful / unhelpful: knowledge/feedback.py). */
export type ArticleActivity = {
  uses: number;
  used_at: string | null;
  helpful: number;
  unhelpful: number;
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

/* นำเข้าบทความ (backend/modules/knowledge/importer.py): a file read into drafts the หัวหน้าทีม checks before any is
   saved. */

/** One draft of an import. Its body is the file's own words until the AI's rewriting is chosen (source_body then
    keeps the file's). */
export type ImportDraft = {
  id: string;
  title: string;
  category: string;
  visibility: ArticleVisibility;
  body: string;
  source_body: string;
  /** Where it is in the file: หน้า 3 (PDF) or the headings above it. */
  source: string;
  /** The existing article that seems to answer the same thing. */
  duplicate: { id: string; title: string } | null;
  /** The AI thought it no article at all (a table of contents, a cover page). */
  suggest_skip: boolean;
  /** Characters the file lost (shown as �), still to be put right. */
  unknown: number;
  state: 'open' | 'saved' | 'skipped';
  article_id: string | null;
  rewrite: { job_id: string; status: 'pending' | 'done' | 'failed'; body: string; error: string } | null;
};

/** GET /api/article-imports/<id> */
export type ArticleImport = {
  id: string;
  file_name: string;
  kind: 'pdf' | 'docx' | 'txt' | 'md';
  created_at: string;
  expires_at: string;
  ai: {
    state: 'off' | 'grouping' | 'done' | 'failed';
    note: string;
    progress: AiJobProgress | null;
    /** The organization's AI can rewrite a draft (AI ช่วยเจ้าหน้าที่ on and connected). */
    available: boolean;
  };
  notes: { images: number; unknown: number; pages: number; sections: number; fixed: number };
  drafts: ImportDraft[];
};

/** GET /api/article-imports: the imports still waiting to be checked. */
export type OpenImport = { id: string; file_name: string; created_at: string; open: number };
