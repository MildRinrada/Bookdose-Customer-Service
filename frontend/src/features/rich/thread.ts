'use client';

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/* A message thread (the element with data-thread): newest messages are at the bottom. It opens at the end and stays
   pinned there when it changes size (window resize, fonts, a picture that finishes loading) or when polling brings
   new messages, unless the person has scrolled up to read older ones. data-pinned="yes|no" on the thread is what
   MessageAttachment reads. Replaces the pinning in the old syncMessageThread / scrollThreadsToEnd. */

export function useThreadPin(ref: RefObject<HTMLElement | null>, content: unknown) {
  // Was the reader near the end before the last change? (the old syncMessageThread threshold: 100 px)
  const near = useRef(true);

  useEffect(() => {
    const thread = ref.current;
    if (!thread) return;
    const end = () => {
      thread.scrollTop = thread.scrollHeight;
    };
    thread.dataset.pinned = 'yes';
    near.current = true;
    end();
    const frame = requestAnimationFrame(end);
    const onScroll = () => {
      const distance = thread.scrollHeight - thread.scrollTop - thread.clientHeight;
      thread.dataset.pinned = distance < 60 ? 'yes' : 'no';
      near.current = distance < 100;
    };
    const observer = new ResizeObserver(() => {
      if (thread.dataset.pinned !== 'no') end();
    });
    thread.addEventListener('scroll', onScroll);
    observer.observe(thread);
    return () => {
      cancelAnimationFrame(frame);
      thread.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [ref]);

  useLayoutEffect(() => {
    const thread = ref.current;
    if (thread && near.current) thread.scrollTop = thread.scrollHeight;
  }, [ref, content]);
}
