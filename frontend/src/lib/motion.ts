'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';

/* The app's motion that is worked out in script rather than CSS: what moved in a list, what just arrived. Each is
   short (a quarter of a second or so), says that something changed and where, and is skipped for a person who asked
   their system for less motion. The CSS animations follow the same rule (base.css, and each page's own). */

export const prefersStill = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A list whose rows change places (the inbox when a message comes in): each row glides from where it was to where it
    is now, and a row that was not there fades in, instead of everything jumping. Rows carry data-flip="<key>". A new
    filter or search, which swaps most of the list, is redrawn as it is: only a reorder or a few rows coming or going
    move. */
export function useFlip(box: RefObject<HTMLElement | null>, keys: string[]) {
  const before = useRef<Map<string, number>>(new Map());
  const order = keys.join('|');
  useLayoutEffect(() => {
    const root = box.current;
    if (!root) return;
    const rows = [...root.querySelectorAll<HTMLElement>('[data-flip]')];
    const now = new Map(rows.map((row) => [row.dataset.flip ?? '', row.offsetTop]));
    const old = before.current;
    before.current = now;
    if (!old.size || prefersStill()) return;
    const shared = [...now.keys()].filter((key) => old.has(key)).length;
    if (now.size - shared > 2 || old.size - shared > 2) return;
    for (const row of rows) {
      const from = old.get(row.dataset.flip ?? '');
      const to = now.get(row.dataset.flip ?? '') ?? 0;
      if (from === undefined) row.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'ease-out' });
      else if (from !== to) row.animate([{ transform: `translateY(${from - to}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }, [box, order]);
}

/** Messages that arrive while the conversation is open come in gently, so the eye finds the new one; those already
    there when it opens (or when another conversation replaces it: none of the ids carried over) stand still. Each
    message carries data-message-id. */
export function useArrivals(ids: string[]) {
  const seen = useRef<Set<string> | null>(null);
  const list = ids.join('|');
  useLayoutEffect(() => {
    const now = list ? list.split('|') : [];
    const old = seen.current;
    seen.current = new Set(now);
    if (!old || !now.some((id) => old.has(id)) || prefersStill()) return;
    for (const id of now) {
      if (old.has(id)) continue;
      document
        .querySelector(`[data-message-id="${CSS.escape(id)}"]`)
        ?.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
    }
  }, [list]);
}
