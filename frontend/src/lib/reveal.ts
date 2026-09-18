'use client';

import { useEffect, type RefObject } from 'react';

/* Sections that glide in as they are scrolled to: every [data-reveal] inside `root` starts faded a little to the
   right and slides into place the first time it comes into view; the ones arriving together follow one another.
   The hidden state is set here (data-reveal-state), so without script - or with reduced motion (styles/reveal.css) -
   everything simply shows. Markup: styles/reveal.css. */

const STEP_MS = 90;

export function useScrollReveal(root: RefObject<HTMLElement | null>, ready: boolean) {
  useEffect(() => {
    const box = root.current;
    if (!ready || !box || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const items = [...box.querySelectorAll<HTMLElement>('[data-reveal]')].filter((el) => !el.dataset.revealState);
    items.forEach((el) => el.setAttribute('data-reveal-state', 'hidden'));
    const observer = new IntersectionObserver(
      (entries) => {
        let order = 0;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          el.style.setProperty('--reveal-delay', `${order++ * STEP_MS}ms`);
          el.setAttribute('data-reveal-state', 'shown');
          observer.unobserve(el);
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
    items.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [root, ready]);
}
