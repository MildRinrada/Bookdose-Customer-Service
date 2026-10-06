'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { EmptyState } from '@/components/ui/display';
import { useDialogs } from '@/components/ui/Dialogs';
import { clockTime, date, plainText } from '@/lib/format';
import type { Message } from '../types';

/* ข้อความที่ปักหมุด (backend conversations/pins.py): what either side wants to keep to hand in this chat - the address
   the team asked for, the order number, what was agreed.

   A button in the column beside the conversation, there whether anything is pinned or not, which opens them in a
   window: the messages themselves keep their room, and somebody who has never pinned anything can still find out
   that they can. A row says who wrote it and the first of what it says; choosing one closes the window, brings the
   message into view in the thread and lights it for a moment; the ✕ takes the pin back.

   The list is built from the messages the reader was given, so a pinned internal note is in the team's and simply not
   in the customer's. Markup: pages/inbox (pinned-*). */

type Pinned = Pick<Message, 'id' | 'author_name' | 'body' | 'created_at'> & Partial<Pick<Message, 'pinned' | 'deleted_at' | 'kind'>>;

/** As many as one chat may pin (backend conversations/pins.py MOST, which refuses the one over). Said in the window
    so nobody finds out by being refused. */
export const PINS_MOST = 3;

/** Bring a pinned message into view in the thread on this page and light it for a moment. */
function reveal(id: string) {
  const message = document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
  if (!message) return;
  message.scrollIntoView({ block: 'center', behavior: 'smooth' });
  message.classList.add('found');
  setTimeout(() => message.classList.remove('found'), 1600);
}

/** What the window shows: the pinned messages, or where to pin from when there are none yet. It keeps its own list,
    so a pin taken back here goes at once - the window was built when it opened, not redrawn by the page behind it. */
function PinnedPanel({ pinned, onUnpin, onGo }: { pinned: Pinned[]; onUnpin?: (m: Pinned) => void; onGo: (id: string) => void }) {
  const [left, setLeft] = useState(pinned);
  if (!left.length)
    return (
      <EmptyState
        title="ไม่มีข้อความที่ปักหมุดไว้"
        description="ข้อความที่ปักหมุดจากแชทนี้จะปรากฏที่นี่ · ชี้เมาส์ที่ข้อความในแชท แล้วกดปุ่มจุดสามจุดแนวตั้ง เลือก “ปักหมุดข้อความ”"
        icon="pin"
      />
    );
  return (
    <div className="pinned-panel">
      <p className="tiny muted pinned-allowance">
        ปักหมุดได้ครั้งละ {PINS_MOST} ข้อความ · ตอนนี้ {left.length}
      </p>
      <ul className="pinned-list">
        {left.map((m) => (
          <li key={m.id}>
            <button type="button" className="pinned-item" onClick={() => onGo(m.id)} title="ไปที่ข้อความนี้ในบทสนทนา">
              <span className="pinned-who">
                {m.author_name}
                <time dateTime={m.created_at} title={date(m.created_at, true)}>
                  {clockTime(m.created_at)}
                </time>
              </span>
              <span className="pinned-words">{plainText(m.body) || 'ไฟล์แนบ'}</span>
            </button>
            {onUnpin && (
              <button
                type="button"
                className="icon-btn sm pinned-off"
                aria-label={`เลิกปักหมุดข้อความของ ${m.author_name}`}
                title="เลิกปักหมุด"
                onClick={() => {
                  setLeft((was) => was.filter((other) => other.id !== m.id));
                  onUnpin(m);
                }}
              >
                <Icon name="close" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PinnedButton({
  messages,
  onUnpin,
}: {
  messages: Pinned[];
  /** Taking a pin back, where the reader may (both sides may, in a web chat). */
  onUnpin?: (m: Pinned) => void;
}) {
  const { openModal, closeModal } = useDialogs();
  const pinned = messages.filter((m) => m.pinned && !m.deleted_at);
  return (
    <button
      type="button"
      className="btn pinned-button"
      onClick={() =>
        openModal(
          'ข้อความที่ปักหมุด',
          <PinnedPanel
            pinned={pinned}
            onUnpin={onUnpin}
            onGo={(id) => {
              closeModal(true);
              reveal(id);
            }}
          />,
          { narrow: true },
        )
      }
    >
      <Icon name="pin" />
      ดูข้อความที่ปักหมุด
      {pinned.length > 0 && <span className="pinned-count">{pinned.length}</span>}
    </button>
  );
}
