/* What other features use from the knowledge base (the global FAQ shares the preview, card frame and editor pieces). */

export { KnowledgeScreen } from './KnowledgeScreen';
export { ArticlePreview, articlePreviewText } from './components/ArticlePreview';
export { ArticleCard, ArticleCardFrame, cardKeyDown, customerLink, Highlighted } from './components/ArticleCard';
export { ArticleRead } from './components/ArticleRead';
export { useArticleActions } from './components/useArticleActions';
export { ARTICLE_TOOLS, ArticleBodyField, ArticleCategoryField, ArticleEditorFields, ArticleForm, type ArticleDraft } from './components/ArticleEditor';
export { ARTICLE_PREFIXES, ARTICLES_PATH, deleteArticle, recordUse, saveArticle } from './api';
export { articleSorts, helpfulRate, reviewReason, visibilityLabels, wordCountText } from './labels';
export { searchArticles, type SearchHit } from './search';
export type { Article, ArticleInput, ArticleSort, ArticlesPage, ArticleVisibility } from './types';
