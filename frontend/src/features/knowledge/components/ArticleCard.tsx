'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/ui/Toast';
import { relative } from '@/lib/format';
import { useWork } from '@/lib/session';
import { recordUse } from '../api';
import { helpfulRate, reviewReason, visibilityLabels } from '../labels';
import { highlightParts, type SearchHit } from '../search';
import type { Article } from '../types';
import { ArticlePreview } from './ArticlePreview';

/* One article in the grid; the whole card opens it. Its corner pins it to the member's own shelf; resting on it
   shows copy buttons (the text, or the link a customer opens without signing in). Found by a search, it shows the
   sentence that answers best with the matched words marked. Markup: pages/knowledge/article-card. */

/** Enter or Space on a card acts like a click (the card is a role="button" <article>). */
export function cardKeyDown(event: KeyboardEvent<HTMLElement>) {
  if (event.target !== event.currentTarget) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    event.currentTarget.click();
  }
}

/** Text with the matched words in <mark>. */
export function Highlighted({ text, words }: { text: string; words: string[] }) {
  return (
    <>
      {highlightParts(text, words).map((part, i) => (part.hit ? <mark key={i}>{part.text}</mark> : part.text))}
    </>
  );
}

/** The link a customer opens without signing in (the organization's public FAQ page). */
export function customerLink(slug: string, id: string) {
  return `${window.location.origin}/support/${slug}/faq/${id}`;
}

export function ArticleCard({
  article,
  hit,
  readOnly = false,
  onOpen,
  onPin,
}: {
  article: Article;
  hit?: SearchHit;
  readOnly?: boolean;
  onOpen: (article: Article) => void;
  onPin?: (article: Article) => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const slug = useWork().tenant.slug;
  const [copied, setCopied] = useState<'text' | 'link' | null>(null);
  const pinned = Boolean(article.pin_order);
  const review = reviewReason(article);
  const rate = helpfulRate(article);
  const words = hit?.words ?? [];

  const copy = (what: 'text' | 'link') => async (event: MouseEvent) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(what === 'text' ? article.body : customerLink(slug, article.id));
      setCopied(what);
      window.setTimeout(() => setCopied((c) => (c === what ? null : c)), 1600);
      if (!readOnly) recordUse(client, article.id, what === 'text' ? 'copy' : 'link');
    } catch {
      toast('เบราว์เซอร์ไม่อนุญาตให้คัดลอก ลองเปิดบทความแล้วเลือกข้อความเองแทน', true);
    }
  };

  return (
    <ArticleCardFrame
      id={article.id}
      title={article.title}
      titleNode={<Highlighted text={article.title} words={words} />}
      category={article.category}
      className={`${pinned ? 'pinned' : ''}${review ? ' needs-review' : ''}`}
      badge={
        <>
          {article.visibility === 'public' && (
            <span className="badge resolved" title="แสดงในหน้าลูกค้าด้วย">
              {visibilityLabels.public}
            </span>
          )}
          {review && (
            <span className="badge review-badge" title={`ควรตรวจทาน: ${review}`}>
              <Icon name="clock" />
              ควรตรวจทาน
            </span>
          )}
        </>
      }
      corner={
        onPin && !readOnly ? (
          <button
            type="button"
            className={`icon-btn pin-btn${pinned ? ' on' : ''}`}
            aria-pressed={pinned}
            aria-label={pinned ? `เลิกปักหมุด ${article.title}` : `ปักหมุด ${article.title}`}
            title={pinned ? 'เลิกปักหมุด' : 'ปักหมุดไว้บนสุด (เห็นเฉพาะคุณ)'}
            onClick={(event) => {
              event.stopPropagation();
              onPin(article);
            }}
          >
            <Icon name="pin" />
          </button>
        ) : null
      }
      body={article.body}
      excerpt={
        hit?.passage ? (
          <div className="article-answer">
            <span className="article-answer-label">
              <Icon name="sparkle" />
              ส่วนที่น่าจะตอบได้
            </span>
            <p>
              <Highlighted text={hit.passage} words={words} />
            </p>
          </div>
        ) : undefined
      }
      stats={
        <>
          <span className="article-stat" title="จำนวนครั้งที่ทีมคัดลอก แทรกในคำตอบ หรือส่งลิงก์ให้ลูกค้า">
            <Icon name="send" />
            {article.uses ? `ใช้ตอบ ${article.uses} ครั้ง` : 'ยังไม่ถูกใช้'}
          </span>
          {rate !== null && (
            <span className={`article-stat rate${rate < 50 ? ' low' : ''}`} title={`ช่วยได้ ${article.helpful} · ไม่ช่วย ${article.unhelpful}`}>
              <Icon name="thumbUp" />
              ช่วยได้ {rate}%
            </span>
          )}
        </>
      }
      actions={
        <>
          <button type="button" className={`card-copy${copied === 'text' ? ' done' : ''}`} onClick={(e) => void copy('text')(e)}>
            <Icon name={copied === 'text' ? 'check' : 'copy'} />
            {copied === 'text' ? 'คัดลอกแล้ว' : 'คัดลอกเนื้อหา'}
          </button>
          {article.visibility === 'public' && (
            <button
              type="button"
              className={`card-copy${copied === 'link' ? ' done' : ''}`}
              title="ลิงก์ที่ลูกค้าเปิดอ่านได้โดยไม่ต้องเข้าสู่ระบบ"
              onClick={(e) => void copy('link')(e)}
            >
              <Icon name={copied === 'link' ? 'check' : 'link'} />
              {copied === 'link' ? 'คัดลอกแล้ว' : 'ลิงก์ลูกค้า'}
            </button>
          )}
        </>
      }
      foot={<>อัปเดต {relative(article.updated_at)}</>}
      onOpen={() => onOpen(article)}
    />
  );
}

/** The card's frame, shared with the global FAQ's cards (their badge is the audience, their foot adds the author). */
export function ArticleCardFrame({
  id,
  title,
  titleNode,
  category,
  badge,
  corner,
  body,
  excerpt,
  previewLimit = 240,
  stats,
  actions,
  foot,
  className = '',
  onOpen,
}: {
  id: string;
  title: string;
  titleNode?: ReactNode;
  category: string;
  badge?: ReactNode;
  corner?: ReactNode;
  body: string;
  /** Shown instead of the start of the article (a search's best sentence). */
  excerpt?: ReactNode;
  previewLimit?: number;
  stats?: ReactNode;
  actions?: ReactNode;
  foot: ReactNode;
  className?: string;
  onOpen: () => void;
}) {
  return (
    <article
      className={`card article-card ${className}`.trim()}
      role="button"
      tabIndex={0}
      data-id={id}
      aria-label={`อ่านบทความ ${title}`}
      onClick={onOpen}
      onKeyDown={cardKeyDown}
    >
      <div className="article-card-top">
        <span className="badge article-category">{category}</span>
        {badge}
        {corner}
      </div>
      <h3>{titleNode ?? title}</h3>
      {excerpt ?? <ArticlePreview body={body} limit={previewLimit} />}
      <div className="article-card-foot muted">
        <span className="article-updated">
          <Icon name="clock" />
          {foot}
        </span>
        {stats}
      </div>
      {actions && <div className="article-card-actions">{actions}</div>}
    </article>
  );
}
