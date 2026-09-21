'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react';
import { Icon } from '@/components/Icon';
import { SearchInput } from '@/components/ui/filters';
import { Highlighted, searchArticles } from '@/features/knowledge';
import { Markdown } from '@/features/rich/Markdown';
import { date, plainText } from '@/lib/format';

/* Published answers beside a chat, readable without leaving it (the visitor's chat and the signed-in customer's).

   A row is still a link to the article's own page, so nothing that worked before stops working. On top of that:
   resting on a row (or focusing it) opens a card with the answer itself, and a row can be dragged onto the
   conversation to open it there, above the box they are writing in. Neither leaves the chat, which is the point:
   somebody waiting for the team should not have to lose the thread to read an answer.

   Touch has neither hover nor drag, so the row's own link is what a phone uses; the card's buttons are what a
   keyboard uses. The card is fixed to the screen and placed through the CSSOM (the policy allows no style
   attributes - backend/middleware/security.py). Markup: styles/pages/chat-answers.css. */

/** An answer as both chats' APIs send it (GET /api/public/<org>, GET /api/customer/faq). */
export type PeekArticle = { id: string; title: string; category?: string; body: string; updated_at?: string };

/** What a dragged row carries: the article's id. The list that started the drag is the one that holds the article,
    so the id is all that has to travel (and nothing readable is dropped into another website by accident). */
export const ARTICLE_TYPE = 'application/x-bookdose-article';

const OPEN_MS = 320;
const CLOSE_MS = 180;

type Peek = { article: PeekArticle; anchor: HTMLElement };

/** show(article, row) after a short rest, hide() after a short grace (moving onto the card itself keeps it). */
function usePeek() {
  const [peek, setPeek] = useState<Peek | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback((article: PeekArticle, anchor: HTMLElement, now = false) => {
    clearTimeout(timer.current);
    if (now) setPeek({ article, anchor });
    else timer.current = setTimeout(() => setPeek({ article, anchor }), OPEN_MS);
  }, []);
  const hide = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPeek(null), CLOSE_MS);
  }, []);
  const keep = useCallback(() => clearTimeout(timer.current), []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { peek, show, hide, keep };
}

/** How many are offered before anything is typed: enough to be useful, not so many that the column becomes a page. */
const SHOWN = 6;

/** The answers the organization has published: searched here, a link each, draggable onto the conversation, read on
    resting. Searching the whole set here is the point - the full FAQ page is for when somebody wants to browse. */
export function AnswerList({
  articles,
  hrefOf,
  allHref,
  heading = 'ลองหาคำตอบระหว่างรอ',
  onRead,
}: {
  articles: PeekArticle[];
  hrefOf: (article: PeekArticle) => string;
  /** The organization's whole FAQ, when this list is only the first few. */
  allHref?: string;
  heading?: string;
  /** Read it here in the conversation, without leaving the chat. */
  onRead: (article: PeekArticle) => void;
}) {
  const { peek, show, hide, keep } = usePeek();
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  // The words of the answer count as well as its title: people search with what they want to know, not its heading.
  const found = term
    ? articles.filter((a) => [a.title, a.body, a.category].some((value) => String(value || '').toLowerCase().includes(term)))
    : articles.slice(0, SHOWN);
  if (!articles.length) return null;
  return (
    <section className="guest-aside-card guest-aside-faq">
      <h3>{heading}</h3>
      <SearchInput
        id="qa-search"
        label="ค้นหาคำตอบ"
        placeholder="ค้นหาคำตอบ เช่น ลืมรหัสผ่าน"
        value={search}
        onChange={(value) => {
          hide();
          setSearch(value);
        }}
      />
      <p className="tiny muted qa-hint">
        {term ? `พบ ${found.length} บทความ · ` : ''}ชี้เมาส์เพื่ออ่านย่อ หรือลากมาวางในบทสนทนาเพื่ออ่านที่นี่
      </p>
      {term && !found.length && <p className="tiny muted qa-none">ไม่พบคำตอบที่ตรงกับที่ค้นหา ลองคำอื่น หรือถามทีมงานในแชทได้เลย</p>}
      <ul className="qa-list">
        {found.map((article) => (
          <li key={article.id}>
            <Link
              className="qa-item"
              href={hrefOf(article)}
              draggable
              title={`${article.title} · ลากมาวางในบทสนทนาเพื่ออ่านที่นี่`}
              onDragStart={(event) => {
                event.dataTransfer.setData(ARTICLE_TYPE, article.id);
                event.dataTransfer.setData('text/plain', article.title);
                event.dataTransfer.effectAllowed = 'copy';
                hide();
              }}
              onMouseEnter={(event) => show(article, event.currentTarget)}
              onMouseLeave={hide}
              onFocus={(event) => show(article, event.currentTarget, true)}
              onBlur={hide}
            >
              <Icon name="book" />
              <span>{article.title}</span>
              <Icon name="grip" className="qa-grip" />
            </Link>
          </li>
        ))}
      </ul>
      {allHref && (
        <Link className="guest-aside-all" href={allHref}>
          ดูคำถามที่พบบ่อยทั้งหมด <Icon name="arrow" />
        </Link>
      )}
      <ArticlePeekCard peek={peek} href={peek ? hrefOf(peek.article) : ''} onKeep={keep} onHide={hide} onRead={onRead} />
    </section>
  );
}

/** The answer itself beside the row it belongs to, for as long as the pointer rests there. */
function ArticlePeekCard({
  peek,
  href,
  onKeep,
  onHide,
  onRead,
}: {
  peek: Peek | null;
  href: string;
  onKeep: () => void;
  onHide: () => void;
  onRead: (article: PeekArticle) => void;
}) {
  const card = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = card.current;
    if (!el || !peek) return;
    const place = () => {
      const at = peek.anchor.getBoundingClientRect();
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      // Beside the column, on the side the conversation is: the pointer reaches the card without crossing anything.
      const beside = at.left - width - 10;
      el.style.setProperty('left', `${Math.round(beside >= 12 ? beside : Math.max(12, Math.min(at.left, window.innerWidth - width - 12)))}px`);
      el.style.setProperty('top', `${Math.round(Math.min(Math.max(12, at.top - 10), Math.max(12, window.innerHeight - height - 12)))}px`);
    };
    place();
    window.addEventListener('scroll', onHide, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', onHide, true);
      window.removeEventListener('resize', place);
    };
  }, [peek, onHide]);

  if (!peek) return null;
  const { article } = peek;
  return (
    <div ref={card} className="qa-peek" role="dialog" aria-label={`ตัวอย่างบทความ ${article.title}`} onMouseEnter={onKeep} onMouseLeave={onHide}>
      <div className="qa-peek-head">
        <strong>{article.title}</strong>
        <span className="tiny muted">
          {article.category}
          {article.updated_at ? `${article.category ? ' · ' : ''}อัปเดต ${date(article.updated_at)}` : ''}
        </span>
      </div>
      <Markdown className="qa-peek-body article-content" text={article.body} />
      <div className="qa-peek-foot">
        <button
          type="button"
          className="btn sm primary"
          onClick={() => {
            onHide();
            onRead(article);
          }}
        >
          <Icon name="chat" />
          อ่านในแชท
        </button>
        <Link className="btn sm" href={href}>
          เปิดหน้าเต็ม
        </Link>
      </div>
    </div>
  );
}

/* Before anything is sent: what is being typed is searched against the same answers, and the ones that match are
   offered to read. Somebody whose question is already answered gets it now instead of waiting for a person. */

/** Enough typed for a search to mean something; below this every keystroke would throw up a different guess. */
const ENOUGH = 8;
const SETTLE_MS = 450;
const OFFERED = 3;

export function AnswerSuggestions({
  articles,
  hrefOf,
  text,
}: {
  articles: PeekArticle[];
  hrefOf: (article: PeekArticle) => string;
  /** What has been typed so far (the subject and the message together). */
  text: string;
}) {
  // Searched once the typing settles, not on every letter.
  const [asked, setAsked] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setAsked(text), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const [openId, setOpenId] = useState('');

  const query = asked.trim();
  const hits = articles.length && query.length >= ENOUGH ? (searchArticles(articles, query) ?? []).slice(0, OFFERED) : [];
  if (!hits.length) return null;
  return (
    <div className="qa-suggest" role="status" aria-live="polite">
      <p className="qa-suggest-head">
        <Icon name="sparkle" />
        <span>
          <strong>อาจมีคำตอบอยู่แล้ว</strong> · กดอ่านได้เลยโดยไม่ต้องรอทีมงาน
        </span>
      </p>
      <ul>
        {hits.map(({ article, words, passage }) => {
          const shown = openId === article.id;
          return (
            <li key={article.id}>
              <button
                type="button"
                className="qa-suggest-row"
                aria-expanded={shown}
                onClick={() => setOpenId(shown ? '' : article.id)}
              >
                <Icon name="book" />
                <span className="grow">
                  <strong>
                    <Highlighted text={article.title} words={words} />
                  </strong>
                  <span className="tiny muted">{passage || plainText(article.body).slice(0, 120)}</span>
                </span>
                <Icon name="down" className="qa-suggest-caret" />
              </button>
              {shown && (
                <div className="qa-suggest-body">
                  <Markdown className="article-content" text={article.body} />
                  <p className="qa-suggest-foot">
                    {/* A new window: what has been typed into the form must still be there afterwards. */}
                    <Link className="btn sm subtle" href={hrefOf(article)} target="_blank" rel="noopener">
                      เปิดหน้าเต็ม
                    </Link>
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="tiny muted qa-suggest-else">ถ้ายังไม่ตรงกับเรื่องของคุณ ส่งถึงทีมงานได้เลย</p>
    </div>
  );
}

/** The answer opened inside the conversation: the messages step aside, the box to write in stays where it is. */
export function ArticleReadPanel({
  article,
  href,
  onClose,
  onAsk,
}: {
  article: PeekArticle;
  href: string;
  onClose: () => void;
  /** Start writing about this answer (the link goes into the draft); left out where there is no box to write in. */
  onAsk?: (article: PeekArticle) => void;
}) {
  const panel = useRef<HTMLElement>(null);
  // Opening it moves the reading to the top of the answer, whichever answer was open before.
  useEffect(() => {
    panel.current?.querySelector('.qa-panel-body')?.scrollTo({ top: 0 });
  }, [article.id]);
  return (
    <section className="qa-panel" aria-label={`บทความ ${article.title}`} ref={panel}>
      <div className="qa-panel-head">
        <span className="qa-panel-icon">
          <Icon name="book" />
        </span>
        <div className="grow">
          <strong>{article.title}</strong>
          <span className="tiny muted">
            {article.category}
            {article.updated_at ? `${article.category ? ' · ' : ''}อัปเดต ${date(article.updated_at)}` : ''}
          </span>
        </div>
        <button type="button" className="icon-btn" aria-label="ปิดบทความ กลับไปที่ข้อความ" title="กลับไปที่ข้อความ" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="qa-panel-body">
        <Markdown className="article-content" text={article.body} />
      </div>
      <div className="qa-panel-foot">
        <button type="button" className="btn sm" onClick={onClose}>
          <Icon name="back" />
          กลับไปที่ข้อความ
        </button>
        {onAsk && (
          <button type="button" className="btn sm primary" onClick={() => onAsk(article)}>
            <Icon name="chat" />
            ถามทีมงานเรื่องนี้
          </button>
        )}
        <Link className="btn sm subtle" href={href}>
          เปิดหน้าเต็ม
        </Link>
      </div>
    </section>
  );
}

/** The conversation as a place to drop an answer on. Files dropped on the box to write in are somebody else's job
    (the composer's own handlers), and they never carry this type. */
export function useArticleDrop(find: (id: string) => PeekArticle | undefined, onRead: (article: PeekArticle) => void) {
  const [over, setOver] = useState(false);
  const ours = (event: DragEvent) => [...(event.dataTransfer?.types ?? [])].includes(ARTICLE_TYPE);
  return {
    over,
    handlers: {
      onDragOver: (event: DragEvent<HTMLDivElement>) => {
        if (!ours(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setOver(true);
      },
      onDragLeave: (event: DragEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (event: DragEvent<HTMLDivElement>) => {
        if (!ours(event)) return;
        event.preventDefault();
        setOver(false);
        const article = find(event.dataTransfer.getData(ARTICLE_TYPE));
        if (article) onRead(article);
      },
    },
  };
}

/** What goes into the draft when somebody asks the team about an answer they have just read. */
export function askLine(article: PeekArticle, href: string) {
  const url = href.startsWith('http') ? href : `${window.location.origin}${href}`;
  return `เกี่ยวกับบทความ [${article.title}](${url})\n`;
}

/** The hint shown over the conversation while an answer is being dragged onto it. */
export function DropHint() {
  return (
    <div className="qa-drop" aria-hidden="true">
      <Icon name="book" />
      วางที่นี่เพื่ออ่านบทความในแชท
    </div>
  );
}
