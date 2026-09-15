'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { relative } from '@/lib/format';
import { visibilityLabels } from '../labels';
import type { Article } from '../types';
import { ArticlePreview } from './ArticlePreview';

/* One article in the grid; the whole card opens it. Markup: pages/knowledge/article-card. */

/** Enter or Space on a card acts like a click (the card is a role="button" <article>). */
export function cardKeyDown(event: KeyboardEvent<HTMLElement>) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    event.currentTarget.click();
  }
}

export function ArticleCard({ article, onOpen }: { article: Article; onOpen: (article: Article) => void }) {
  return (
    <ArticleCardFrame
      id={article.id}
      title={article.title}
      category={article.category}
      badge={
        article.visibility === 'public' ? (
          <span className="badge resolved" title="แสดงในหน้าลูกค้าด้วย">
            {visibilityLabels.public}
          </span>
        ) : null
      }
      body={article.body}
      foot={<>อัปเดต {relative(article.updated_at)}</>}
      onOpen={() => onOpen(article)}
    />
  );
}

/** The card's frame, shared with the global FAQ's cards (their badge is the audience, their foot adds the author). */
export function ArticleCardFrame({
  id,
  title,
  category,
  badge,
  body,
  previewLimit = 240,
  foot,
  onOpen,
}: {
  id: string;
  title: string;
  category: string;
  badge?: ReactNode;
  body: string;
  previewLimit?: number;
  foot: ReactNode;
  onOpen: () => void;
}) {
  return (
    <article className="card article-card" role="button" tabIndex={0} data-id={id} aria-label={`อ่านบทความ ${title}`} onClick={onOpen} onKeyDown={cardKeyDown}>
      <div className="article-card-top">
        <span className="badge article-category">{category}</span>
        {badge}
      </div>
      <h3>{title}</h3>
      <ArticlePreview body={body} limit={previewLimit} />
      <div className="article-card-foot muted">
        <Icon name="clock" />
        {foot}
      </div>
    </article>
  );
}
