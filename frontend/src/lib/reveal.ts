'use client';

import { useEffect, type RefObject } from 'react';

/* Sections that glide in as they are scrolled to: every [data-reveal] inside `root` (or what `selector` picks) starts
   faded a little to the right and slides into place the first time it comes into view; the ones arriving together
   follow one another. One scrolled past too fast to be seen is simply there, so nothing stays invisible. The hidden
   state is set here (data-reveal-state), so without script - or with reduced motion (styles/reveal.css) - everything
   simply shows. Markup: styles/reveal.css. */

const STEP_MS = 90;

/** `selector` picks what glides in (by default the [data-reveal] elements inside `root`). */
export function useScrollReveal(root: RefObject<HTMLElement | null>, ready: boolean, selector = '[data-reveal]') {
  useEffect(() => {
    const box = root.current;
    if (!ready || !box || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const pending = new Set([...box.querySelectorAll<HTMLElement>(selector)].filter((el) => el.dataset.revealState !== 'shown'));
    pending.forEach((el) => el.setAttribute('data-reveal-state', 'hidden'));

    const show = (el: HTMLElement, delay: number) => {
      el.style.setProperty('--reveal-delay', `${delay}ms`);
      el.setAttribute('data-reveal-state', 'shown');
      pending.delete(el);
      observer.unobserve(el);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        let order = 0;
        for (const entry of entries) if (entry.isIntersecting) show(entry.target as HTMLElement, order++ * STEP_MS);
      },
      { threshold: 0, rootMargin: '0px 0px -8% 0px' },
    );
    pending.forEach((el) => observer.observe(el));

    // Jumped past (above the screen) without ever being in view: the observer never sees that, a scroll check does.
    let frame = 0;
    const sweep = () => {
      frame = 0;
      pending.forEach((el) => {
        if (el.getBoundingClientRect().bottom < 0) show(el, 0);
      });
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(sweep);
    };
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll, { capture: true });
      cancelAnimationFrame(frame);
    };
  }, [root, ready, selector]);
}
