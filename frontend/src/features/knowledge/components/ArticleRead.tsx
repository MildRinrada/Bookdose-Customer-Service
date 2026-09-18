'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/ui/Toast';
import { useRunAction } from '@/components/ui/actions';
import { Markdown } from '@/features/rich/Markdown';
import { date, relative } from '@/lib/format';
import { useApi } from '@/lib/query';
import { useBoot, useWork } from '@/lib/session';
import { ARTICLES_PATH, recordUse, voteArticle } from '../api';
import { helpfulRate, reviewReason, visibilityLabels } from '../labels';
import type { Article, ArticlesPage } from '../types';

/* An article opened from the knowledge base, in the modal. Markup: pages/knowledge/article-read.
   "แทรกในช่องร่างข้อความ" shows only when a composer is there to take it (onInsert). Opened from a search, the
   words that matched are marked in the text (the CSS Highlight API: nothing in the page is rewritten) and the first
   is scrolled to. The member tells whether it helped; copying or inserting it counts as a use. */

let highlightStyled = false;

/** The look of the marked words, once: a constructed style sheet (pages/knowledge.css cannot hold ::highlight yet,
    and a constructed sheet is not an inline style the page's CSP refuses). */
function styleHighlight() {
  if (highlightStyled || typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in document)) return;
  highlightStyled = true;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('::highlight(kb-hit){background-color:#ffe58a;color:inherit}');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch {
    // An older browser: the article simply shows without marks.
  }
}

/** Marks every `words` in `root`'s text as ::highlight(kb-hit) and scrolls to the first; answers the clean-up. */
function highlightWords(root: HTMLElement, words: string[]) {
  const registry = (globalThis.CSS as { highlights?: Map<string, unknown> } | undefined)?.highlights;
  const HighlightType = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  const unique = [...new Set(words.filter(Boolean).map((w) => w.toLowerCase()))];
  if (!registry || !HighlightType || !unique.length) return () => undefined;
  styleHighlight();
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.nodeValue ?? '').toLowerCase();
    for (const word of unique) {
      for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + word.length)) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + word.length);
        ranges.push(range);
      }
    }
  }
  if (!ranges.length) return () => undefined;
  registry.set('kb-hit', new HighlightType(...ranges));
  const first = ranges.sort((a, b) => a.compareBoundaryPoints(Range.START_TO_START, b))[0];
  if (first.getBoundingClientRect().top > window.innerHeight * 0.6) first.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return () => {
    registry.delete('kb-hit');
  };
}

export function ArticleRead({
  article: given,
  highlight = [],
  onEdit,
  onDelete,
  onInsert,
  onPin,
  onHistory,
}: {
  article: Article;
  /** Words a search matched, to mark in the text. */
  highlight?: string[];
  onEdit: (article: Article) => void;
  onDelete: (article: Article) => void;
  onInsert?: (article: Article) => void;
  onPin?: (article: Article) => void;
  onHistory?: (article: Article) => void;
}) {
  const toast = useToast();
  const run = useRunAction();
  const boot = useBoot();
  const work = useWork();
  const client = useQueryClient();
  // The list's latest numbers (a mark or a pin changes them while the article is open).
  const article = useApi<ArticlesPage>(ARTICLES_PATH).data?.articles.find((a) => a.id === given.id) ?? given;
  const readOnly = Boolean(work.read_only);
  const canEdit = work.role !== 'agent' && !readOnly;
  const tenantId = boot.data?.tenant_id ?? work.tenant.id;
  const review = reviewReason(article);
  const rate = helpfulRate(article);
  const content = useRef<HTMLDivElement>(null);
  const words = highlight.join('\n');

  useEffect(() => {
    if (!content.current || !words) return;
    return highlightWords(content.current, words.split('\n'));
  }, [words, article.body]);

  const vote = (value: -1 | 1) =>
    run(async () => {
      const next = article.my_vote === value ? 0 : value;
      await voteArticle(client, article.id, next);
      if (next === 1) toast('ขอบคุณ! ทีมจะเห็นว่าบทความนี้ช่วยได้');
      if (next === -1) toast('รับทราบ ผู้ดูแลจะเห็นว่าบทความนี้ควรปรับปรุง');
    });

  return (
    <>
      <div className="article-meta">
        <span className="badge">
          <Icon name="book" /> {article.category}
        </span>
        <span className="badge">{visibilityLabels[article.visibility] || visibilityLabels.internal}</span>
        <span className="muted">
          <Icon name="clock" /> อัปเดต {date(article.updated_at, true)}
        </span>
        {onPin && !readOnly && (
          <button
            type="button"
            className={`btn sm pin-toggle${article.pin_order ? ' on' : ''}`}
            aria-pressed={Boolean(article.pin_order)}
            onClick={() => onPin(article)}
          >
            <Icon name="pin" />
            {article.pin_order ? 'ปักหมุดแล้ว' : 'ปักหมุด'}
          </button>
        )}
      </div>
      {review && (
        <p className="article-review-note">
          <Icon name="clock" />
          <span>
            <strong>ควรตรวจทาน:</strong> {review} · ตรวจสอบว่าเนื้อหายังตรงกับวิธีทำงานปัจจุบันก่อนส่งให้ลูกค้า
          </span>
        </p>
      )}
      <div ref={content}>
        <Markdown className="article-content" text={article.body} />
      </div>
      <div className="article-feedback">
        <div className="article-feedback-stats">
          <span>
            <Icon name="send" />
            {article.uses ? (
              <>
                ใช้ตอบลูกค้าแล้ว <b>{article.uses}</b> ครั้ง{article.used_at && ` · ล่าสุด ${relative(article.used_at)}`}
              </>
            ) : (
              'ยังไม่มีใครนำไปใช้ตอบ'
            )}
          </span>
          {rate !== null && (
            <span>
              <Icon name="thumbUp" />
              ช่วยได้ <b>{rate}%</b> จาก {(article.helpful ?? 0) + (article.unhelpful ?? 0)} คน
            </span>
          )}
        </div>
        {!readOnly && (
          <div className="article-vote" role="group" aria-label="บทความนี้ช่วยตอบลูกค้าได้ไหม">
            <span>ช่วยตอบลูกค้าได้ไหม?</span>
            <button type="button" className={`vote-btn up${article.my_vote === 1 ? ' on' : ''}`} aria-pressed={article.my_vote === 1} onClick={() => vote(1)}>
              <Icon name="thumbUp" />
              ช่วยได้ {article.helpful ? <b>{article.helpful}</b> : null}
            </button>
            <button type="button" className={`vote-btn down${article.my_vote === -1 ? ' on' : ''}`} aria-pressed={article.my_vote === -1} onClick={() => vote(-1)}>
              <Icon name="thumbDown" />
              ไม่ช่วย {article.unhelpful ? <b>{article.unhelpful}</b> : null}
            </button>
          </div>
        )}
      </div>
      <div className="form-actions wrap">
        <button
          type="button"
          className="btn"
          onClick={() =>
            run(async () => {
              await navigator.clipboard.writeText(article.body);
              if (!readOnly) recordUse(client, article.id, 'copy');
              toast('คัดลอกเนื้อหาแล้ว');
            })
          }
        >
          <Icon name="copy" />
          คัดลอกเนื้อหา
        </button>
        <button
          type="button"
          className="btn"
          onClick={() =>
            run(async () => {
              // Opening the link switches to this organization first when the reader belongs to it.
              await navigator.clipboard.writeText(`${window.location.origin}/knowledge/${article.id}?tenant=${tenantId}`);
              toast('คัดลอกลิงก์สำหรับผู้มีสิทธิ์เข้าองค์กรแล้ว');
            })
          }
        >
          คัดลอกลิงก์
        </button>
        {onHistory && (
          <button type="button" className="btn" onClick={() => onHistory(article)}>
            <Icon name="history" />
            ประวัติการแก้ไข{article.revisions ? ` (${article.revisions})` : ''}
          </button>
        )}
        {onInsert && (
          <button
            type="button"
            className="btn primary"
            onClick={() =>
              run(async () => {
                await onInsert(article);
                if (!readOnly) recordUse(client, article.id, 'insert');
              })
            }
          >
            แทรกในช่องร่างข้อความ
          </button>
        )}
        {canEdit && (
          <>
            <button type="button" className="btn" onClick={() => onEdit(article)}>
              <Icon name="edit" />
              แก้ไขบทความ
            </button>
            <button type="button" className="btn danger" onClick={() => onDelete(article)}>
              <Icon name="close" />
              ลบบทความ
            </button>
          </>
        )}
      </div>
    </>
  );
}
