import { Markdown } from '@/features/rich/Markdown';

/* The first part of an article, still formatted. Cut at a line or a word so a list is not chopped mid-item; an
   unfinished code fence is closed by the renderer itself. Ported from articlePreview() in knowledge.js. */

/** The Markdown to show as a preview (the old articlePreview before it was rendered). */
export function articlePreviewText(body: string | null | undefined, limit = 240): string {
  const text = String(body || '').trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const stop = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf(' '));
  return (stop > 80 ? cut.slice(0, stop) : cut).trim() + ' …';
}

/** div.article-excerpt holding the formatted preview (the global FAQ cards use limit 200). */
export function ArticlePreview({ body, limit = 240, className = 'article-excerpt' }: { body: string | null | undefined; limit?: number; className?: string }) {
  return <Markdown className={className} text={articlePreviewText(body, limit)} />;
}
