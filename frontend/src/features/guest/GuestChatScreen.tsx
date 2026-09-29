'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Icon } from '@/components/Icon';
import { TextSizeMenu } from '@/components/shell/TextSize';
import { EmptyState, ErrorState, InitialLoading, PageLoading } from '@/components/ui/display';
import { useToast } from '@/components/ui/Toast';
import { AiPortalStatus } from '@/features/ai/components/AiPortalStatus';
import type { PublicOrgInfo } from '@/features/auth/types';
import { KnownIssuesBar } from '@/features/incidents/KnownIssues';
import { AnswerList, ArticleReadPanel, DropHint, TypingAnswers, askLine, useArticleDrop, type PeekArticle } from '@/features/customer/components/ArticlePeek';
import { reactToMessage } from '@/features/customer/api';
import { CustomerSurvey } from '@/features/customer/components/ChatView';
import { ThanksCard } from '@/features/customer/components/ThanksCard';
import { WaitQueue } from '@/features/customer/components/WaitQueue';
import { ContinueOnLinePanel, MovedToLine } from '@/features/customer/components/ContinueOnLine';
import { CallbackPanel } from '@/features/customer/components/CallbackRequest';
import { chatState, chatView } from '@/features/customer/labels';
import type { PortalSession } from '@/features/customer/types';
import { Composer, MessageThread } from '@/features/inbox';
import { setEmbedded, setGuestCredentials } from '@/lib/api/client';
import { useCustomerAccount } from '@/lib/customer-session';
import { relative } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { RealtimeProvider } from '@/lib/realtime-provider';
import { continueGuestOnLine, guestBase, guestPages, guestPath, guestPortalSlug, guestSessionPath, widgetPath } from './api';
import { FollowCard } from './components/FollowCard';
import { GuestNav, SignedInLink } from './components/GuestFrame';
import { GuestClaimBanners } from './components/GuestClaimBanners';
import { GuestMenu } from './components/GuestMenu';
import { OrgBanner, PoweredBy } from './components/OrgBanner';
import { GuestStartForm, linksMessage } from './components/GuestStartForm';
import { useGuestOverview, useGuestSession } from './hooks';
import { byNewest, isWidgetTheme, unreadCount } from './labels';
import type { GuestConversation, GuestOverview, WidgetInfo } from './types';

/* /support/<org>/tickets[/<id>] and /support/<org>/embed: chatting with an organization without an account
   (docs/features/support-page-and-guest-chat.md).
   The same pieces as the signed-in customer's chat — the thread with the survey inside it, the AI status with
   "คุยกับเจ้าหน้าที่", the composer — talking to the guest routes. The page has its own slim header; the embedded
   copy (inside a website's iframe, see public/widget.js) has none, sends X-Embed and tells the page around it how
   many replies are unread, only when that page is one of the organization's allowed websites. */

type Props = { slug: string; initialId?: string; embed?: boolean };

// Whether "ติดตามแชทนี้" is folded, per organization and remembered by this browser ('' = not chosen yet).
function readFold(slug: string): '' | 'open' | 'closed' {
  try {
    const value = localStorage.getItem(`bookdose.guest-follow.${slug}`);
    return value === 'open' || value === 'closed' ? value : '';
  } catch {
    return '';
  }
}
function writeFold(slug: string, value: 'open' | 'closed') {
  try {
    localStorage.setItem(`bookdose.guest-follow.${slug}`, value);
  } catch {
    /* Still works for this page. */
  }
}

/** True while there is room for the third column beside the conversation (the same width the stylesheet folds at). */
function useWideScreen() {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1101px)');
    const read = () => setWide(query.matches);
    read();
    query.addEventListener('change', read);
    return () => query.removeEventListener('change', read);
  }, []);
  return wide;
}

export function GuestChatScreen(props: Props) {
  // Before the first request: every call from the iframe says so.
  useState(() => setEmbedded(Boolean(props.embed)));
  useEffect(() => () => setEmbedded(false), []);
  // Live updates once this browser is a guest of the organization (the cookie exists): new replies, the widget's
  // unread badge, typing and read marks. Reads the same cached overview as the page, without polling it itself.
  const guest = useGuestOverview(props.slug, false).data?.guest;
  return (
    <RealtimeProvider kind="guest" org={props.slug} enabled={Boolean(guest)} identity={guest?.csrf ?? ''}>
      <GuestChatPage {...props} />
    </RealtimeProvider>
  );
}

function GuestChatPage({ slug, initialId = '', embed = false }: Props) {
  const overview = useGuestOverview(slug);
  const info = useApi<PublicOrgInfo>(`/api/public/${slug}`);
  const widget = useApi<WidgetInfo>(embed ? widgetPath(slug) : null);

  const orgName = overview.data?.organization.name || info.data?.organization.name || '';
  useEffect(() => {
    if (orgName) document.title = `แชทกับ ${orgName}`;
  }, [orgName]);

  const theme = embed && isWidgetTheme(widget.data?.theme) ? widget.data.theme : 'charcoal';
  // The chat itself fills the window (a conversation, not a page of prose); the start page keeps its reading width.
  const frameClass = `guest-page${embed ? ' guest-embed' : ' guest-page-chat'}`;

  let body;
  if (overview.error?.status === 403 || info.error?.status === 404) {
    const closed = overview.error?.status === 403;
    body = (
      <section className="card guest-closed">
        <EmptyState
          icon={closed ? 'lock' : 'globe'}
          title={closed ? 'ต้องเข้าสู่ระบบก่อนเริ่มแชท' : 'ไม่พบองค์กรนี้'}
          description={closed ? overview.error?.message : info.error?.message}
        >
          {closed && (
            <Link className="btn primary" href={`/login?org=${encodeURIComponent(slug)}`} target={embed ? '_blank' : undefined}>
              เข้าสู่ระบบหรือสมัครสมาชิก
            </Link>
          )}
        </EmptyState>
      </section>
    );
  } else if (overview.error) body = <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;
  else if (!overview.data) body = embed ? <PageLoading /> : <InitialLoading text="กำลังเปิดแชท…" />;
  else body = <GuestChat slug={slug} data={overview.data} info={info.data} initialId={initialId} embed={embed} widget={widget.data} />;

  return (
    <main className={frameClass} data-theme={embed ? theme : undefined}>
      {!embed && (
        <OrgBanner slug={slug} name={orgName}>
          <GuestNav slug={slug} current="chat" />
          <SignedInLink slug={slug} />
          <TextSizeMenu />
        </OrgBanner>
      )}
      {!embed && <SignedInClaims slug={slug} />}
      {body}
      {!embed && (
        <p className="guest-foot tiny muted">
          <Icon name="lock" /> ข้อความส่งถึงทีมงานของ {orgName || 'องค์กร'} โดยตรง · อย่าส่งรหัสผ่านหรือข้อมูลสำคัญในแชท · <PoweredBy />
        </p>
      )}
    </main>
  );
}

function SignedInClaims({ slug }: { slug: string }) {
  const account = useCustomerAccount();
  return account.data?.signed_in ? <GuestClaimBanners org={slug} /> : null;
}

type ChatProps = {
  slug: string;
  data: GuestOverview;
  info: PublicOrgInfo | undefined;
  initialId: string;
  embed: boolean;
  widget: WidgetInfo | undefined;
};

function GuestChat({ slug, data, info, initialId, embed, widget }: ChatProps) {
  const toast = useToast();
  const refresh = useInvalidate();
  const client = useQueryClient();
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(initialId || null);
  const [composing, setComposing] = useState(false);
  const [showList, setShowList] = useState(false);
  const [fold, setFold] = useState<'' | 'open' | 'closed'>(() => readFold(slug));
  // Inside the widget the chat is read only while its panel is open (reading marks the team's replies as read). The
  // embed address opened on its own, or framed without widget.js (no hello within 3 seconds), is simply open.
  const [panelOpen, setPanelOpen] = useState(() => !embed || typeof window === 'undefined' || window.parent === window);

  const list = useMemo(() => [...data.conversations].sort(byNewest), [data.conversations]);
  const current = composing || !data.guest ? null : (openId ?? list[0]?.id ?? null);
  const hasList = list.length > 1;
  const portal = guestPortalSlug(slug);
  const wide = useWideScreen();

  // An answer read inside the conversation: dropped on it, or asked for from the card that opens on resting.
  const articles = useMemo(() => (info?.articles as PeekArticle[] | undefined) ?? [], [info]);
  // An answer belongs to the chat it was opened in, so opening another chat shows the messages again by itself.
  const [open, setOpen] = useState<{ chat: string; article: PeekArticle } | null>(null);
  const reading = open && open.chat === current ? open.article : null;
  const read = (article: PeekArticle) => setOpen(current ? { chat: current, article } : null);
  const insertRef = useRef<((text: string) => void) | null>(null);
  const drop = useArticleDrop((id) => articles.find((a) => a.id === id), read);

  const gone = useCallback(
    (message: string) => {
      toast(message, true);
      setOpenId(null);
      void refresh(guestPath(slug));
    },
    [toast, refresh, slug],
  );
  const session = useGuestSession(slug, panelOpen ? current : null, gone);

  // The open chat is in the address, so a reload (or a link) opens it again: /support/<org>/tickets/<id> on the page,
  // ?c=<id> inside the website's frame (whose address stays /support/<org>/embed).
  useEffect(() => {
    const url = new URL(window.location.href);
    if (embed) {
      if (current) url.searchParams.set('c', current);
      else url.searchParams.delete('c');
    } else {
      url.pathname = guestPages.chat(slug, current ?? undefined);
      url.searchParams.delete('c');
    }
    if (url.href !== window.location.href) window.history.replaceState(null, '', url);
  }, [current, embed, slug]);

  // --- The website around the iframe (public/widget.js) ---
  const parentOrigin = useRef<string | null>(null);
  const unread = list.reduce((total, c) => total + unreadCount(c), 0);
  const post = useCallback((message: Record<string, unknown>) => {
    if (parentOrigin.current && window.parent !== window) window.parent.postMessage({ type: 'bd-chat', ...message }, parentOrigin.current);
  }, []);
  const widgetRef = useRef(widget);
  const stateRef = useRef({ unread, open: panelOpen, title: widget?.title || data.organization.name });
  useEffect(() => {
    widgetRef.current = widget;
    stateRef.current = { unread, open: panelOpen, title: widget?.title || data.organization.name };
  });
  useEffect(() => {
    if (!embed) return;
    const onMessage = (event: MessageEvent) => {
      const message = event.data as { type?: string; hello?: boolean; open?: boolean } | null;
      if (event.source !== window.parent || !message || message.type !== 'bd-chat') return;
      const allowed = widgetRef.current?.enabled ? widgetRef.current.origins : [];
      if (!allowed.includes(event.origin)) return;
      parentOrigin.current = event.origin;
      if (typeof message.open === 'boolean') setPanelOpen(message.open);
      if (message.hello) {
        const w = widgetRef.current!;
        const s = stateRef.current;
        post({ ready: true, unread: s.unread, open: s.open, position: w.position, theme: w.theme, title: s.title });
      }
    };
    const onKey = (event: KeyboardEvent) => {
      // Escape closes an open dialog first (the browser's own); only then the widget's panel.
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('dialog[open]')) post({ close: true });
    };
    window.addEventListener('message', onMessage);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('message', onMessage);
      document.removeEventListener('keydown', onKey);
    };
  }, [embed, post]);
  useEffect(() => {
    if (embed) post({ unread, open: panelOpen });
  }, [embed, post, unread, panelOpen]);
  useEffect(() => {
    if (!embed) return;
    const timer = setTimeout(() => {
      if (!parentOrigin.current) setPanelOpen(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, [embed]);

  const forgotten = () => {
    setGuestCredentials(null);
    setOpenId(null);
    setComposing(false);
    setShowList(false);
    // Nothing of the forgotten visitor stays on the screen while the server's fresh answer (no guest) arrives.
    client.removeQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith(guestBase(slug) + '/') });
    client.setQueryData<GuestOverview>([guestPath(slug)], (old) => (old ? { ...old, guest: null, conversations: [] } : old));
    void refresh(guestPath(slug));
  };

  // "ติดตามแชทนี้" lives in the column beside the conversation where there is room for it, open unless the visitor
  // folded it. Without that column it goes back into the thread, and there it stays folded until asked for: the card
  // is taller than the thread itself, and a chat whose messages are pushed out of sight by a settings card is worse
  // than a missed nudge. Its head line says how they can follow this chat either way.
  const aside = wide && !embed;
  const followOpen = aside ? fold !== 'closed' : fold === 'open';
  const setFollowOpen = (open: boolean) => {
    const value = open ? 'open' : 'closed';
    setFold(value);
    writeFold(slug, value);
  };
  const showFollow = () => {
    setFollowOpen(true);
    requestAnimationFrame(() => document.getElementById('guest-follow')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };
  // On the page a new chat is started on the start page (/support/<org>/tickets/new); inside a website's frame there
  // is no room for it, so the form opens in the panel.
  const newChat = () => {
    if (!embed) return router.push(guestPages.start(slug));
    setComposing(true);
    setShowList(false);
  };
  const nothingYet = !embed && (!data.guest || list.length === 0);
  useEffect(() => {
    if (nothingYet) router.replace(guestPages.start(slug));
  }, [nothingYet, router, slug]);

  let detail;
  if (nothingYet) {
    detail = <PageLoading />;
  } else if (!current) {
    detail = (
      <>
        <div className="card-header conv-header new-chat-header guest-conv-header">
          {list.length > 0 && data.guest && (
            <button type="button" className="icon-btn guest-back" aria-label="กลับไปที่แชทเดิม" onClick={() => setComposing(false)}>
              <Icon name="back" />
            </button>
          )}
          <div className="conv-title">
            <h2>{list.length ? 'เริ่มแชทเรื่องใหม่' : `แชทกับ ${data.organization.name}`}</h2>
            <p className="conv-meta">ส่งข้อความถึงทีมงานได้เลยโดยไม่ต้องสมัครสมาชิก</p>
          </div>
        </div>
        <GuestStartForm
          key={data.guest ? 'known' : 'new'}
          slug={slug}
          overview={data}
          info={info}
          onStarted={async (id, links) => {
            await refresh(guestPath(slug));
            setOpenId(id);
            setComposing(false);
            setShowList(false);
            toast(links.length ? linksMessage(data.organization.name, links) : `ส่งข้อความถึงทีมงาน ${data.organization.name} แล้ว ติดตามคำตอบได้ในแชทนี้`, links.some((l) => !l.sent));
          }}
        />
      </>
    );
  } else if (!panelOpen) {
    detail = <PageLoading />;
  } else if (session.data) {
    detail = (
      <GuestChatView
        slug={slug}
        portal={portal}
        data={session.data}
        overview={data}
        hasList={hasList}
        followOpen={followOpen}
        aside={aside}
        embed={embed}
        reading={reading}
        insertRef={insertRef}
        articles={articles}
        onRead={read}
        onCloseReading={() => setOpen(null)}
        onAsk={(article) => {
          insertRef.current?.(askLine(article, guestPages.article(slug, article.id)));
          setOpen(null);
        }}
        onFollowToggle={setFollowOpen}
        onShowFollow={showFollow}
        onShowList={() => setShowList(true)}
        onNewChat={newChat}
        onForgotten={forgotten}
      />
    );
  } else if (session.error && session.error.status !== 404 && session.error.status !== 401) {
    detail = <ErrorState error={session.error} onRetry={() => void session.refetch()} />;
  } else detail = <PageLoading />;

  const asideShown = aside && Boolean(session.data);

  return (
    <section
      className={`card guest-chat customer-chats${hasList ? ' has-list' : ''}${showList ? ' show-list' : ''}${asideShown ? ' has-aside' : ''}`}
    >
      {hasList && (
        <nav className="guest-list" aria-label="แชทของคุณกับทีมงาน">
          <div className="guest-list-head">
            <strong>แชทของคุณ</strong>
            <button type="button" className="btn sm" onClick={newChat}>
              <Icon name="plus" />
              เรื่องใหม่
            </button>
          </div>
          {list.map((c) => (
            <GuestChatItem
              key={c.id}
              chat={c}
              selected={c.id === current}
              // The open chat reads its fresher session; the others the case status the list carries (same words).
              state={c.id === current && session.data ? chatView(session.data) : chatState({ ticket_status: c.ticket_status ?? null, status: c.status })}
              onOpen={() => {
                setOpenId(c.id);
                setComposing(false);
                setShowList(false);
              }}
            />
          ))}
        </nav>
      )}
      <div className={`guest-detail${reading ? ' reading' : ''}${drop.over ? ' qa-over' : ''}`} data-thread-scope="" {...drop.handlers}>
        {detail}
        {drop.over && <DropHint />}
      </div>
      {asideShown && (
        <aside className="guest-aside" aria-label="เครื่องมือและคำตอบที่อาจช่วยได้">
          <GuestAside
            slug={slug}
            overview={data}
            articles={articles}
            ticket={session.data?.ticket ?? null}
            followOpen={followOpen}
            onRead={read}
            onFollowToggle={setFollowOpen}
            onForgotten={forgotten}
          />
        </aside>
      )}
    </section>
  );
}

/** Beside the conversation: where the case stands, the ways to follow this chat, and the answers the organization
    has published — something to read while the team is writing back. */
function GuestAside({
  slug,
  overview,
  articles,
  ticket,
  followOpen,
  onRead,
  onFollowToggle,
  onForgotten,
}: {
  slug: string;
  overview: GuestOverview;
  articles: PeekArticle[];
  ticket: { id: string; number: number | string } | null;
  followOpen: boolean;
  onRead: (article: PeekArticle) => void;
  onFollowToggle: (open: boolean) => void;
  onForgotten: () => void;
}) {
  return (
    <>
      {ticket && (
        <section className="guest-aside-card">
          <h3>เคส BD-{ticket.number}</h3>
          <p className="tiny muted">ทีมงานเปิดเคสให้เรื่องนี้แล้ว ดูขั้นตอนที่ทำไปแล้วและกำหนดเวลาได้</p>
          <Link className="btn sm" href={guestPages.case(slug, ticket.id)}>
            <Icon name="ticket" />
            ดูความคืบหน้า
          </Link>
        </section>
      )}
      <AnswerList articles={articles} hrefOf={(a) => guestPages.article(slug, a.id)} allHref={guestPages.faq(slug)} onRead={onRead} />
      <FollowCard slug={slug} overview={overview} expanded={followOpen} onToggle={onFollowToggle} onForgotten={onForgotten} />
    </>
  );
}

function GuestChatItem({
  chat: c,
  selected,
  state,
  onOpen,
}: {
  chat: GuestConversation;
  selected: boolean;
  state: { label: string; tone: string };
  onOpen: () => void;
}) {
  const unread = unreadCount(c) > 0;
  return (
    <button
      type="button"
      className={`inbox-item customer-chat-item${selected ? ' selected' : ''}${unread ? ' needs-reply' : ''}`}
      aria-current={selected ? 'true' : undefined}
      onClick={onOpen}
    >
      <span className="inbox-top">
        <span className={`customer-state tone-${state.tone}`}>{state.label}</span>
        {unread && (
          <span className="unread-dot" title="มีคำตอบใหม่">
            <span className="sr-only">มีคำตอบใหม่</span>
          </span>
        )}
        <time className="inbox-time" dateTime={c.updated_at}>
          {relative(c.updated_at)}
        </time>
      </span>
      <h3>{c.subject}</h3>
      {c.survey_pending && <span className="tiny muted">รอคะแนนความพึงพอใจจากคุณ</span>}
    </button>
  );
}

function GuestChatView({
  slug,
  portal,
  data,
  overview,
  hasList,
  followOpen,
  aside,
  embed,
  reading,
  insertRef,
  articles,
  onRead,
  onCloseReading,
  onAsk,
  onFollowToggle,
  onShowFollow,
  onShowList,
  onNewChat,
  onForgotten,
}: {
  slug: string;
  portal: string;
  data: PortalSession;
  overview: GuestOverview;
  hasList: boolean;
  followOpen: boolean;
  /** The column beside the conversation is there: it holds the case, the follow card and the published answers. */
  aside: boolean;
  embed: boolean;
  /** An answer being read in place of the messages (dropped on the conversation, or opened from its card). */
  reading: PeekArticle | null;
  insertRef: RefObject<((text: string) => void) | null>;
  /** The organization's published answers, offered above the box as they match what is typed; onRead opens one. */
  articles: PeekArticle[];
  onRead: (article: PeekArticle) => void;
  onCloseReading: () => void;
  onAsk: (article: PeekArticle) => void;
  onFollowToggle: (open: boolean) => void;
  onShowFollow: () => void;
  onShowList: () => void;
  onNewChat: () => void;
  onForgotten: () => void;
}) {
  const view = chatView(data);
  const id = data.conversation.id;
  const survey = data.survey && (data.survey.pending || data.survey.rating) ? data.survey : null;
  const orgName = overview.organization.name;
  const guest = overview.guest;
  const [lineOpen, setLineOpen] = useState(false);
  const [callbackOpen, setCallbackOpen] = useState(false);
  const refresh = useInvalidate();
  const canMove = Boolean(data.line && !data.line.moved);
  return (
    <>
      <div className="card-header conv-header guest-conv-header">
        {hasList && (
          <button type="button" className="icon-btn guest-back guest-list-back" aria-label="ดูแชททั้งหมด" onClick={onShowList}>
            <Icon name="back" />
          </button>
        )}
        <div className="conv-title">
          <h2 title={data.conversation.subject}>{data.conversation.subject}</h2>
          <p className="conv-meta">
            <span className="customer-org-badge">คุยกับ {orgName}</span>
            <span className={`customer-state tone-${view.tone}`} id="customer-state-label" data-tone={view.tone}>
              {view.label}
            </span>
            {data.ticket && !aside && (
              // Where the case stands, its progress and deadlines (inside a website's frame: a new window).
              <Link
                className="conv-case-link"
                href={guestPages.case(slug, data.ticket.id)}
                target={embed ? '_blank' : undefined}
                rel={embed ? 'noopener' : undefined}
                title={`ดูสถานะและความคืบหน้าของเคส BD-${data.ticket.number}`}
              >
                เคส BD-{data.ticket.number} · ดูความคืบหน้า
              </Link>
            )}
            <span className="customer-state-hint guest-state-hint">{view.hint}</span>
          </p>
        </div>
        <GuestMenu
          items={[
            { key: 'follow', label: 'ติดตามแชทนี้', icon: 'bell', onSelect: onShowFollow },
            ...(data.callback && !data.line?.moved
              ? [{ key: 'callback', label: data.callback.waiting ? 'ดูคำขอให้ติดต่อกลับ' : 'ขอให้ติดต่อกลับ', icon: 'phone', onSelect: () => setCallbackOpen(true) }]
              : []),
            ...(canMove ? [{ key: 'line', label: 'คุยต่อใน LINE', icon: 'chat', onSelect: () => setLineOpen(true) }] : []),
            { key: 'new', label: 'เริ่มแชทเรื่องใหม่', icon: 'plus', onSelect: onNewChat },
            ...(embed ? [{ key: 'window', label: 'เปิดในหน้าต่างใหม่', icon: 'link', onSelect: () => window.open(guestPages.chat(slug, id), '_blank', 'noopener') }] : []),
          ]}
        />
      </div>
      {callbackOpen && data.callback && (
        <CallbackPanel
          base={`/api/public/${slug}/guest`}
          conversationId={id}
          state={data.callback}
          onDone={() => refresh(guestSessionPath(slug))}
          onClose={() => setCallbackOpen(false)}
        />
      )}
      {lineOpen && canMove && data.line && (
        <ContinueOnLinePanel
          line={data.line}
          request={() => continueGuestOnLine(slug, id)}
          refresh={() => refresh(guestSessionPath(slug))}
          onClose={() => setLineOpen(false)}
        />
      )}
      <KnownIssuesBar slug={portal} />
      <div className="notice customer-ai-status" id="customer-ai-status">
        <AiPortalStatus ai={data.ai} slug={portal} conversationId={id} />
      </div>
      {/* The survey and the follow card are part of the conversation: they follow the newest message. */}
      <MessageThread
        messages={data.messages}
        threadId={id}
        id="customer-thread"
        publicView
        publicSlug={portal}
        readAt={data.staff_read_at}
        onReact={(m, reaction) => reactToMessage(portal, id, m.id, reaction).then(() => refresh(guestSessionPath(slug)))}
        afterKey={`${JSON.stringify(data.survey)}|${followOpen}|${aside}|${JSON.stringify(guest)}|${JSON.stringify(data.queue)}|${JSON.stringify(data.thanks)}`}
        after={
          <>
            <WaitQueue queue={data.queue} />
            {data.thanks && <ThanksCard card={data.thanks} slug={portal} conversationId={id} />}
            {survey && (
              <div id="customer-survey">
                <CustomerSurvey survey={survey} slug={portal} conversationId={id} org={orgName} />
              </div>
            )}
            {/* Without the column beside the conversation, the card belongs at the end of the thread. */}
            {!aside && (
              <FollowCard
                slug={slug}
                overview={overview}
                expanded={followOpen}
                onToggle={onFollowToggle}
                onForgotten={onForgotten}
                newWindow={embed}
              />
            )}
          </>
        }
      />
      {reading && (
        <ArticleReadPanel article={reading} href={guestPages.article(slug, reading.id)} onClose={onCloseReading} onAsk={onAsk} />
      )}
      {/* Carried to LINE: the conversation goes on there, and the web keeps it to read. */}
      {data.line?.moved ? (
        <MovedToLine line={data.line} />
      ) : (
        <Composer
          key={id}
          conversationId={id}
          publicView
          publicSlug={portal}
          insertRef={insertRef}
          // While an answer is open it has the room: the offers step aside until it is closed.
          suggest={reading ? undefined : (text) => <TypingAnswers articles={articles} text={text} onRead={onRead} />}
        />
      )}
    </>
  );
}
