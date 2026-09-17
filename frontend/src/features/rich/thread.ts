'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';

/* A message thread (the element with data-thread): newest messages are at the bottom. It opens at the end and stays
   pinned there when it changes size (window resize, fonts, a picture that finishes loading) or when polling brings
   new messages, unless the person has scrolled up to read older ones. data-pinned="yes|no" on the thread is what
   MessageAttachment reads. Replaces the pinning in the old syncMessageThread / scrollThreadsToEnd.

   "The end" is where the newest message can be read. What follows it inside the thread (the satisfaction survey, the
   guest's follow card) is shown whole when it fits; a tall one takes at most half of the view, so a new message
   never arrives hidden behind it. The pin belongs to one conversation: showing another one in the same thread
   (the guest chat switches without leaving the page) opens that one at its end too. */

/** How much of the view the newest messages keep when something tall follows them. */
const MESSAGES_SHARE = 0.5;

function measure(thread: HTMLElement) {
  const max = Math.max(0, thread.scrollHeight - thread.clientHeight);
  // .typing-status follows the last message (and holds the typing bubble); anything after it is the thread's tail.
  const status = thread.querySelector<HTMLElement>(':scope > .typing-status');
  if (!status) return { target: max, messagesEnd: thread.scrollHeight };
  const messagesEnd = status.getBoundingClientRect().bottom - thread.getBoundingClientRect().top - thread.clientTop + thread.scrollTop;
  return { target: Math.max(0, Math.min(max, Math.round(messagesEnd - thread.clientHeight * MESSAGES_SHARE))), messagesEnd };
}

/** Scroll a pinned thread so its newest message is in view, without moving a reader who already sees it (e.g. while
    filling in the survey below it). */
export function pinThread(thread: HTMLElement) {
  if (!thread.clientHeight) return;
  const { target, messagesEnd } = measure(thread);
  const shown = messagesEnd - thread.scrollTop;
  if (thread.scrollTop < target || shown < Math.min(80, thread.clientHeight / 3)) thread.scrollTop = target;
}

const FOLLOW_EVENT = 'thread-follow';

/** The reader just sent a message from the composer `from` belongs to: the thread of that screen goes back to its
    end and stays there, even if the reader had scrolled up (their own message must never arrive out of sight). */
export function followThread(from: Element | null | undefined) {
  from?.closest('[data-thread-scope]')?.querySelector('[data-thread]')?.dispatchEvent(new Event(FOLLOW_EVENT));
}

/** Straight to the end (opening a conversation, changing the filter). */
export function scrollThreadToEnd(thread: HTMLElement) {
  thread.scrollTop = measure(thread).target;
}

export function useThreadPin(ref: RefObject<HTMLElement | null>, threadId: string, content: unknown) {
  // Was the reader near the end before the last change? (the old syncMessageThread threshold: 100 px)
  const near = useRef(true);

  // Before paint, so another conversation never shows for a frame where the previous one was scrolled to.
  useLayoutEffect(() => {
    const thread = ref.current;
    if (!thread) return;
    thread.dataset.pinned = 'yes';
    near.current = true;
    scrollThreadToEnd(thread);
    const frame = requestAnimationFrame(() => scrollThreadToEnd(thread));
    const onScroll = () => {
      const distance = measure(thread).target - thread.scrollTop;
      thread.dataset.pinned = distance < 60 ? 'yes' : 'no';
      near.current = distance < 100;
    };
    const onFollow = () => {
      thread.dataset.pinned = 'yes';
      near.current = true;
      scrollThreadToEnd(thread);
    };
    const observer = new ResizeObserver(() => {
      if (thread.dataset.pinned !== 'no') pinThread(thread);
    });
    thread.addEventListener('scroll', onScroll);
    thread.addEventListener(FOLLOW_EVENT, onFollow);
    observer.observe(thread);
    return () => {
      cancelAnimationFrame(frame);
      thread.removeEventListener('scroll', onScroll);
      thread.removeEventListener(FOLLOW_EVENT, onFollow);
      observer.disconnect();
    };
  }, [ref, threadId]);

  useLayoutEffect(() => {
    const thread = ref.current;
    if (thread && near.current) pinThread(thread);
  }, [ref, content]);
}
