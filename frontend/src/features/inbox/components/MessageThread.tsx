'use client';

import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { Avatar, EmptyState } from '@/components/ui/display';
import { FilterPill } from '@/components/ui/filters';
import { AiCitations } from '@/features/ai/components/AiCitations';
import { ChannelDelivery } from '@/features/channels/components/ChannelDelivery';
import { MarkdownBlocks } from '@/features/rich/Markdown';
import { looksLikeMarkdown } from '@/features/rich/markdown-core';
import { MessageFiles } from '@/features/rich/media';
import { useThreadPin } from '@/features/rich/thread';
import { clockTime, date, dayLabel } from '@/lib/format';
import type { Message } from '../types';

/* A conversation's messages (the old messagesHTML): only the time on each message and a divider at each new day,
   internal notes, AI and survey tags, formatted team replies, attachments, AI sources and, for the team, where a
   reply's delivery stands. Markup: pages/inbox/message, thread-day. Used by the inbox, the case screen and the
   customer's chat (publicView). */

type ThreadMessage = Pick<Message, 'id' | 'author_name' | 'kind' | 'body' | 'created_at' | 'attachments'> &
  Partial<Pick<Message, 'delivery' | 'channel_delivery' | 'source' | 'citations' | 'survey'>>;

type MessagesProps = {
  messages: ThreadMessage[];
  /** The customer is reading: no delivery lines, attachments through the organization's portal. */
  publicView?: boolean;
  /** The organization's slug (required with publicView: the customer's attachments are read through it). */
  publicSlug?: string | null;
};

/** The messages themselves, without the scrolling .thread around them. */
export function Messages({ messages, publicView = false, publicSlug }: MessagesProps) {
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
            <MessageItem m={m} publicView={publicView} publicSlug={publicSlug} />
          </Fragment>
        );
      })}
    </>
  );
}

function MessageItem({ m, publicView, publicSlug }: { m: ThreadMessage; publicView: boolean; publicSlug?: string | null }) {
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
}) {
  const ref = useRef<HTMLDivElement>(null);
  useThreadPin(ref, `${messages.length}|${afterKey}`);
  // Switching between all messages and notes only starts reading from the newest again.
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [notesOnly]);
  return (
    <div ref={ref} className={`thread${notesOnly ? ' notes-only' : ''}`} id={id} data-thread={threadId}>
      <Messages messages={messages} publicView={publicView} publicSlug={publicSlug} />
      {after}
    </div>
  );
}

/** "ทุกข้อความ" or only the team's internal notes, for reading the back-room discussion on its own (the old
    threadFilterHTML, with its div.thread-filter). */
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
    <div className="thread-filter" role="group" aria-label="แสดงข้อความ">
      <FilterPill label="ทุกข้อความ" value="all" pressed={!notesOnly} onClick={() => onChange(false)} />
      <FilterPill
        label="เฉพาะบันทึกภายใน"
        value="notes"
        pressed={notesOnly}
        count={messages.filter((m) => m.kind === 'note').length}
        onClick={() => onChange(true)}
      />
    </div>
  );
}
