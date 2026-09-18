'use client';

import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { Avatar, EmptyState } from '@/components/ui/display';
import { AiCitations } from '@/features/ai/components/AiCitations';
import { ChannelDelivery } from '@/features/channels/components/ChannelDelivery';
import { MarkdownBlocks } from '@/features/rich/Markdown';
import { looksLikeMarkdown } from '@/features/rich/markdown-core';
import { MessageFiles } from '@/features/rich/media';
import { scrollThreadToEnd, useThreadPin } from '@/features/rich/thread';
import { clockTime, date, dayLabel } from '@/lib/format';
import { useReadAt, useRealtime, useTyping } from '@/lib/realtime-provider';
import type { Message } from '../types';

/* A conversation's messages (the old messagesHTML): only the time on each message and a divider at each new day,
   internal notes, AI and survey tags, formatted team replies, attachments, AI sources and, for the team, where a
   reply's delivery stands. Markup: pages/inbox/message, thread-day. Used by the inbox, the case screen and the
   customer's chat (publicView). With live updates (lib/realtime-provider) the thread also shows the other side typing
   and "อ่านแล้ว" under the reader's own latest message once the other side has read it. */

type ThreadMessage = Pick<Message, 'id' | 'author_name' | 'kind' | 'body' | 'created_at' | 'attachments'> &
  Partial<Pick<Message, 'delivery' | 'channel_delivery' | 'source' | 'citations' | 'survey'>>;

type MessagesProps = {
  messages: ThreadMessage[];
  /** The customer is reading: no delivery lines, attachments through the organization's portal. */
  publicView?: boolean;
  /** The organization's slug (required with publicView: the customer's attachments are read through it). */
  publicSlug?: string | null;
};

/** The reader's latest message, when nothing from the other side came after it: its read mark. */
type Receipt = { id: string; read: boolean };

/** The messages themselves, without the scrolling .thread around them. */
export function Messages({ messages, publicView = false, publicSlug, receipt }: MessagesProps & { receipt?: Receipt | null }) {
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
            <MessageItem m={m} publicView={publicView} publicSlug={publicSlug} receipt={receipt?.id === m.id ? receipt : null} />
          </Fragment>
        );
      })}
    </>
  );
}

function MessageItem({ m, publicView, publicSlug, receipt }: { m: ThreadMessage; publicView: boolean; publicSlug?: string | null; receipt: Receipt | null }) {
  // What the team writes may carry formatting from the composer tools; what a customer types is shown as typed.
  const rich = m.kind !== 'customer' && looksLikeMarkdown(m.body);
  return (
    <article className={`message ${m.kind}`} data-message-id={m.id}>
      <Avatar name={m.author_name} index={m.kind === 'customer' ? 2 : 0} />
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
        </div>
        <div className={`bubble${rich ? ' rich' : ''}`}>
          {rich ? <MarkdownBlocks text={m.body} /> : m.body}
          <MessageFiles files={m.attachments} publicSlug={publicView ? publicSlug : undefined} />
        </div>
        <AiCitations citations={m.citations} />
        {m.kind === 'reply' && !publicView && (
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
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The other side: the customer for the team, the team for the customer (or guest).
  const other = publicView ? 'staff' : 'customer';
  const own = publicView ? 'customer' : 'reply';
  const { connected } = useRealtime();
  const typing = useTyping(threadId, other);
  const liveReadAt = useReadAt(threadId, other);
  const lastPublic = [...messages].reverse().find((m) => m.kind !== 'note');
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
      <Messages messages={messages} publicView={publicView} publicSlug={publicSlug} receipt={receipt} />
      <div className="typing-status" role="status">
        {typing !== null && <TypingBubble name={typing || (other === 'staff' ? 'ทีมงาน' : 'ลูกค้า')} side={other} />}
      </div>
      {after}
    </div>
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
