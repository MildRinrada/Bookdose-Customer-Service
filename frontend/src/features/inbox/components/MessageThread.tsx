'use client';

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Icon } from '@/components/Icon';
import { Avatar, EmptyState } from '@/components/ui/display';
import { useToast } from '@/components/ui/Toast';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { AiCitations } from '@/features/ai/components/AiCitations';
import { ChannelDelivery } from '@/features/channels/components/ChannelDelivery';
import { MarkdownBlocks } from '@/features/rich/Markdown';
import { looksLikeMarkdown } from '@/features/rich/markdown-core';
import { MessageFiles } from '@/features/rich/media';
import { scrollThreadToEnd, useThreadPin } from '@/features/rich/thread';
import { clockTime, date, dayLabel } from '@/lib/format';
import { useReadAt, useRealtime, useTyping } from '@/lib/realtime-provider';
import type { Message, Reaction } from '../types';
import { MessageTranslation, thaiSide } from './MessageTranslation';

/** What the thread may do with a message of this conversation; absent on the customer's view and wherever the
    conversation cannot be corrected (only a web chat can: a reply a provider delivered is already read). */
export type ManageMessage = {
  canEdit: (m: ThreadMessage) => boolean;
  canDelete: (m: ThreadMessage) => boolean;
  onEdit: (m: ThreadMessage) => void;
  onDelete: (m: ThreadMessage) => void;
};

/* A conversation's messages (the old messagesHTML): only the time on each message and a divider at each new day,
   internal notes, AI and survey tags, formatted team replies, attachments, AI sources and, for the team, where a
   reply's delivery stands. Markup: pages/inbox/message, thread-day. Used by the inbox, the case screen and the
   customer's chat (publicView). With live updates (lib/realtime-provider) the thread also shows the other side typing
   and "อ่านแล้ว" under the reader's own latest message once the other side has read it. On the customer's web chat,
   resting the pointer on a team reply (or tapping it on a phone) offers a row of emoji: the one chosen sits under the
   reply for both sides, an answer that is not a message and so reopens nothing (conversations/reactions.py). */

type ThreadMessage = Pick<Message, 'id' | 'author_name' | 'author_id' | 'kind' | 'body' | 'created_at' | 'attachments'> &
  Partial<Pick<Message, 'delivery' | 'channel_delivery' | 'source' | 'citations' | 'survey' | 'edited_at' | 'deleted_at' | 'deleted_by' | 'translation' | 'reaction' | 'photo'>>;

/** The customer reacts to a team reply (null takes it back); given on the customer's web chat only. */
export type ReactToMessage = (m: ThreadMessage, reaction: Reaction | null) => Promise<unknown>;

/** The emoji a customer may answer a reply with (backend conversations/reactions.py REACTIONS), in the row's order. */
const REACTIONS: Record<Reaction, { emoji: string; label: string }> = {
  like: { emoji: '👍', label: 'ถูกใจ' },
  heart: { emoji: '❤️', label: 'รักเลย' },
  laugh: { emoji: '😂', label: 'ขำ' },
  wow: { emoji: '😮', label: 'ว้าว' },
  sad: { emoji: '😢', label: 'เศร้า' },
  thanks: { emoji: '🙏', label: 'ขอบคุณ' },
};
const REACTION_KEYS = Object.keys(REACTIONS) as Reaction[];

type MessagesProps = {
  messages: ThreadMessage[];
  /** The customer is reading: no delivery lines, attachments through the organization's portal. */
  publicView?: boolean;
  /** The organization's slug (required with publicView: the customer's attachments are read through it). */
  publicSlug?: string | null;
  /** The customer's web chat: they may react to the team's replies. */
  onReact?: ReactToMessage;
  /** A signed-in customer's own picture (a data URL from their account), beside their own messages. */
  ownPhoto?: string | null;
};

/** The reader's latest message, when nothing from the other side came after it: its read mark. */
type Receipt = { id: string; read: boolean };

/** The messages themselves, without the scrolling .thread around them. */
export function Messages({
  messages,
  publicView = false,
  publicSlug,
  receipt,
  manage,
  onReact,
  ownPhoto,
}: MessagesProps & { receipt?: Receipt | null; manage?: ManageMessage }) {
  if (!messages.length) return <EmptyState title="ยังไม่มีข้อความ" description="เริ่มบันทึกรายละเอียดการดูแลในเคสนี้" icon="chat" />;
  return (
    <>
      {messages.map((m, i) => {
        const when = new Date(m.created_at);
        const newDay = i === 0 || new Date(messages[i - 1].created_at).toDateString() !== when.toDateString();
        return (
          <Fragment key={m.id}>
            {newDay && (
              <div className="thread-day">
                <span>{dayLabel(when)}</span>
              </div>
            )}
            <MessageItem
              m={m}
              publicView={publicView}
              publicSlug={publicSlug}
              receipt={receipt?.id === m.id ? receipt : null}
              manage={manage}
              onReact={m.kind === 'reply' && !m.survey && !m.deleted_at ? onReact : undefined}
              ownPhoto={ownPhoto}
            />
          </Fragment>
        );
      })}
    </>
  );
}

/** The picture beside a message. On the customer's chat: the team member's photo by the key their reply carries
    (backend portal/photos.py), and a signed-in customer's own beside theirs. On the team's screens: a colleague's.
    The initials whenever there is no photo, or it stops loading (turned off since the page last asked). */
function MessageAvatar({ m, publicSlug, ownPhoto }: { m: ThreadMessage; publicSlug?: string | null; ownPhoto?: string | null }) {
  const [broken, setBroken] = useState<string | null>(null);
  const src = m.kind === 'customer' ? ownPhoto : publicSlug && m.photo ? `/api/public/${publicSlug}/team/${m.photo}/photo` : null;
  if (!src || src === broken) return <UserAvatar id={m.author_id} name={m.author_name} index={m.kind === 'customer' ? 2 : 0} />;
  // A picture served by this app (or the customer's own data URL); next/image adds nothing for it.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="avatar profile-avatar" src={src} alt={`รูปโปรไฟล์ของ ${m.author_name}`} loading="lazy" onError={() => setBroken(src)} />;
}

function MessageItem({
  m,
  publicView,
  publicSlug,
  receipt,
  manage,
  onReact,
  ownPhoto,
}: {
  m: ThreadMessage;
  publicView: boolean;
  publicSlug?: string | null;
  receipt: Receipt | null;
  manage?: ManageMessage;
  onReact?: ReactToMessage;
  ownPhoto?: string | null;
}) {
  // A translated message (ai/translate.py) reads in Thai on the team's screens, the other side under it.
  const translation = publicView ? null : m.translation;
  const body = thaiSide(translation) ?? m.body;
  // Both sides may format from their composer tools; a customer's links and images stay plain text (MarkdownBlocks).
  const rich = looksLikeMarkdown(body);
  const gone = Boolean(m.deleted_at);
  const bubble = (
    <div className={`bubble${rich ? ' rich' : ''}`}>
      {rich ? <MarkdownBlocks text={body} plain={m.kind === 'customer'} /> : body}
      <MessageFiles files={m.attachments} publicSlug={publicView ? publicSlug : undefined} />
    </div>
  );
  if (gone)
    return (
      <article className={`message ${m.kind} removed`} data-message-id={m.id}>
        <MessageAvatar m={m} publicSlug={publicView ? publicSlug : null} ownPhoto={ownPhoto} />
        <div className="grow">
          <div className="message-header">
            <strong>{m.author_name}</strong>
            <time dateTime={m.created_at} title={date(m.created_at, true)}>
              {clockTime(m.created_at)}
            </time>
          </div>
          {/* The words are gone and the customer no longer sees this at all; the team keeps the marker, because a
              thread that quietly loses a message is worse than one that says it lost it. */}
          <p className="message-removed">
            <Icon name="trash" />
            ข้อความนี้ถูกลบแล้ว{m.deleted_by ? ` โดย ${m.deleted_by}` : ''} · ลูกค้าไม่เห็นข้อความนี้แล้ว
          </p>
        </div>
      </article>
    );
  return (
    <article className={`message ${m.kind}`} data-message-id={m.id}>
      <MessageAvatar m={m} publicSlug={publicView ? publicSlug : null} ownPhoto={ownPhoto} />
      <div className="grow">
        <div className="message-header">
          <strong>{m.author_name}</strong>
          {m.kind === 'note' && (
            <span className="message-tag note-tag">
              <Icon name="lock" />
              บันทึกภายใน
            </span>
          )}
          {m.kind !== 'note' && m.source === 'ai' && (
            <span className="message-tag">
              <Icon name="sparkle" />
              AI Chatbot
            </span>
          )}
          {m.survey && (
            <span className="message-tag survey-tag">
              <Icon name="star" />
              แบบประเมินความพึงพอใจ
            </span>
          )}
          <time dateTime={m.created_at} title={date(m.created_at, true)}>
            {clockTime(m.created_at)}
          </time>
          {m.edited_at && (
            <span className="message-edited" title={`แก้ไขเมื่อ ${date(m.edited_at, true)}`}>
              แก้ไขแล้ว
            </span>
          )}
          {manage && <MessageMenu m={m} manage={manage} />}
        </div>
        {publicView && onReact ? (
          <Reactable m={m} onReact={onReact}>
            {bubble}
          </Reactable>
        ) : (
          bubble
        )}
        {!publicView && m.reaction && (
          <span className="reaction-chip" title={`ลูกค้ารีแอค ${REACTIONS[m.reaction].emoji} ${REACTIONS[m.reaction].label} แทนการพิมพ์ เคสจึงไม่ถูกเปิดกลับมา`}>
            <span aria-hidden="true">{REACTIONS[m.reaction].emoji}</span>
            <span className="sr-only">ลูกค้ารีแอค {REACTIONS[m.reaction].label}</span>
          </span>
        )}
        <AiCitations citations={m.citations} />
        {translation && <MessageTranslation translation={translation} body={m.body} />}
        {/* A reply held while it is translated has not gone anywhere yet: the line above says so. */}
        {m.kind === 'reply' && !publicView && !(translation?.direction === 'out' && translation.status === 'pending') && (
          <ChannelDelivery message={{ id: m.id, delivery: m.delivery ?? '', channel_delivery: m.channel_delivery ?? null }} />
        )}
        {/* The line is there (empty) before the other side reads, so the mark appearing does not move the thread. */}
        {receipt && (
          <span className="read-receipt" data-read={receipt.read ? 'yes' : 'no'} aria-hidden={receipt.read ? undefined : 'true'}>
            {receipt.read && <Icon name="check" />}
            {receipt.read ? 'อ่านแล้ว' : ''}
          </span>
        )}
      </div>
    </article>
  );
}

/** The scrolling thread (div.thread[data-thread]): opens at the newest message and stays there while new ones
    arrive, unless the reader scrolled up. `notesOnly` shows the team's internal notes alone (ThreadFilter). */
export function MessageThread({
  messages,
  threadId,
  id,
  publicView = false,
  publicSlug,
  notesOnly = false,
  after,
  afterKey = '',
  readAt: knownReadAt = null,
  manage,
  onReact,
  ownPhoto,
}: MessagesProps & {
  /** data-thread: the conversation's id. */
  threadId: string;
  /** An element id, e.g. "customer-thread". */
  id?: string;
  notesOnly?: boolean;
  /** Shown after the newest message and scrolled with the messages (the customer's satisfaction survey). */
  after?: ReactNode;
  /** Changes when `after` changes, so a pinned thread stays at the end. */
  afterKey?: string;
  /** When the other side last read the conversation, as the page last loaded it (read events may be newer). */
  readAt?: string | null;
  /** What the team may do with a message here; absent on the customer's view. */
  manage?: ManageMessage;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The other side: the customer for the team, the team for the customer (or guest).
  const other = publicView ? 'staff' : 'customer';
  const own = publicView ? 'customer' : 'reply';
  const { connected } = useRealtime();
  const typing = useTyping(threadId, other);
  const liveReadAt = useReadAt(threadId, other);
  // A reply held while it is translated has not reached the customer: no read mark on it.
  const lastPublic = [...messages].reverse().find((m) => m.kind !== 'note' && !(m.translation?.direction === 'out' && m.translation.status === 'pending'));
  const readTimes = [liveReadAt, knownReadAt].filter((at): at is string => Boolean(at)).map((at) => Date.parse(at));
  const read = Boolean(lastPublic && readTimes.some((at) => at >= Date.parse(lastPublic.created_at)));
  const receipt: Receipt | null = lastPublic?.kind === own && (connected || read) ? { id: lastPublic.id, read } : null;
  useThreadPin(ref, threadId, `${messages.length}|${afterKey}|${typing ?? ''}|${receipt?.read ?? ''}`);
  // Switching between all messages and notes only starts reading from the newest again.
  useEffect(() => {
    if (ref.current) scrollThreadToEnd(ref.current);
  }, [notesOnly]);
  return (
    <div ref={ref} className={`thread${notesOnly ? ' notes-only' : ''}`} id={id} data-thread={threadId}>
      <Messages messages={messages} publicView={publicView} publicSlug={publicSlug} receipt={receipt} manage={manage} onReact={onReact} ownPhoto={ownPhoto} />
      <div className="typing-status" role="status">
        {typing !== null && <TypingBubble name={typing || (other === 'staff' ? 'ทีมงาน' : 'ลูกค้า')} side={other} />}
      </div>
      {after}
    </div>
  );
}

/* The mouse rests this long on a reply before its row of emoji shows (passing over the thread does not flash it), and
   the row stays this long after the mouse slips off, so a hand that overshoots finds it still there. */
const REST_MS = 350;
const LINGER_MS = 700;
// The row still lingering on another reply, put away at once when the mouse rests on this one.
let lingering: (() => void) | null = null;

/** A team reply the customer may react to: resting the pointer on it for a moment (a tap on a phone, Tab from the
    keyboard) shows the row of emoji above it; the one chosen sits under the reply and takes itself back when pressed.
    Shown at once, put back if the server refuses. Markup: pages/reactions.css. */
function Reactable({ m, onReact, children }: { m: ThreadMessage; onReact: ReactToMessage; children: ReactNode }) {
  const toast = useToast();
  const root = useRef<HTMLDivElement>(null);
  const saved = m.reaction ?? null;
  const [shown, setShown] = useState<Reaction | null>(saved);
  const [seen, setSeen] = useState<Reaction | null>(saved);
  const [pop, setPop] = useState(false);
  const [open, setOpen] = useState(false);
  const [resting, setResting] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  if (seen !== saved) {
    setSeen(saved);
    setShown(saved);
  }
  const putAway = useCallback(() => setResting(false), []);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (lingering === putAway) lingering = null;
    },
    [putAway],
  );
  const enter = (event: ReactPointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    window.clearTimeout(timer.current);
    if (resting) return;
    timer.current = window.setTimeout(() => {
      if (lingering !== putAway) lingering?.();
      lingering = putAway;
      setResting(true);
    }, REST_MS);
  };
  const leave = (event: ReactPointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    window.clearTimeout(timer.current);
    if (resting) timer.current = window.setTimeout(putAway, LINGER_MS);
  };
  // A phone has no pointer to rest: a tap opens the row, a tap anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  const choose = async (reaction: Reaction) => {
    const before = shown;
    const next = shown === reaction ? null : reaction;
    setShown(next);
    setPop(Boolean(next));
    setOpen(false);
    if (root.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    try {
      await onReact(m, next);
    } catch (error) {
      setShown(before);
      toast(error instanceof Error ? error.message : String(error), true);
    }
  };
  // One stop for Tab; the arrow keys move along the row (a toolbar).
  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(at + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    event.preventDefault();
  };
  return (
    <>
      <div
        ref={root}
        className={`reactable${open ? ' open' : ''}${resting ? ' resting' : ''}`}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onClick={(event) => {
          if (window.matchMedia('(hover: none)').matches && !(event.target as HTMLElement).closest('a, button')) setOpen((o) => !o);
        }}
      >
        {children}
        <div className="reaction-picker" role="toolbar" aria-label={`รีแอคข้อความของ ${m.author_name}`} onKeyDown={onKey}>
          {REACTION_KEYS.map((reaction, i) => (
            <button
              key={reaction}
              type="button"
              className={shown === reaction ? 'on' : undefined}
              tabIndex={i === 0 ? 0 : -1}
              aria-pressed={shown === reaction}
              aria-label={REACTIONS[reaction].label}
              title={REACTIONS[reaction].label}
              onClick={() => void choose(reaction)}
            >
              <span aria-hidden="true">{REACTIONS[reaction].emoji}</span>
            </button>
          ))}
        </div>
      </div>
      {shown && (
        <button
          type="button"
          className={`reaction-chip${pop ? ' pop' : ''}`}
          aria-label={`คุณรีแอค ${REACTIONS[shown].label} กดเพื่อยกเลิก`}
          title="กดเพื่อยกเลิก"
          onClick={() => void choose(shown)}
          onAnimationEnd={() => setPop(false)}
        >
          <span aria-hidden="true">{REACTIONS[shown].emoji}</span>
        </button>
      )}
    </>
  );
}

/** The other side is typing: their picture and name, and a bubble of moving dots (styles/pages/inbox.css). */
function TypingBubble({ name, side }: { name: string; side: 'staff' | 'customer' }) {
  return (
    <div className={`message typing ${side === 'customer' ? 'customer' : 'reply'}`}>
      <Avatar name={name} index={side === 'customer' ? 2 : 0} />
      <div className="grow">
        <div className="message-header">
          <strong>{name}</strong>
          <span className="typing-label">กำลังพิมพ์…</span>
        </div>
        <div className="bubble typing-bubble" aria-hidden="true">
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
        </div>
      </div>
    </div>
  );
}

/** A small switch: every message, or only the team's internal notes (the back-room discussion on its own). */
export function ThreadFilter({
  messages,
  notesOnly,
  onChange,
}: {
  messages: Array<Pick<Message, 'kind'>>;
  notesOnly: boolean;
  onChange: (notesOnly: boolean) => void;
}) {
  return (
    <button type="button" className="notes-switch" aria-pressed={notesOnly} onClick={() => onChange(!notesOnly)}>
      <span className="notes-switch-track" aria-hidden="true" />
      เฉพาะบันทึกภายใน ({messages.filter((m) => m.kind === 'note').length})
    </button>
  );
}

/* The ⋯ beside a message the team may still correct. A message sent to the wrong chat is the reason this exists, so
   it is on each message rather than in a screen of its own, and it opens on click, closes on Escape, on a click
   somewhere else and once something is chosen. */
function MessageMenu({ m, manage }: { m: ThreadMessage; manage: ManageMessage }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const editable = manage.canEdit(m);
  const removable = manage.canDelete(m);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('click', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('click', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  if (!editable && !removable) return null;
  return (
    <div className="message-menu" ref={root}>
      <button
        type="button"
        className="icon-btn sm"
        aria-expanded={open}
        aria-label={`จัดการข้อความของ ${m.author_name}`}
        title="จัดการข้อความ"
        onClick={() => setOpen(!open)}
      >
        <Icon name="kebab" />
      </button>
      <div className="message-menu-panel" hidden={!open}>
        {editable && (
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              manage.onEdit(m);
            }}
          >
            <Icon name="edit" />
            แก้ไขข้อความ
          </button>
        )}
        {removable && (
          <button
            type="button"
            className="menu-item danger"
            onClick={() => {
              setOpen(false);
              manage.onDelete(m);
            }}
          >
            <Icon name="trash" />
            ลบข้อความ
          </button>
        )}
      </div>
    </div>
  );
}
