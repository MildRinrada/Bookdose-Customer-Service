'use client';

import { useEffect, type RefObject } from 'react';

/* The menu beside a settings page (ตั้งค่าองค์กร, ตั้งค่าบัญชี of staff and customers) stays exactly where it starts
   while the page scrolls - right under the page's title, which sticks too (pages/settings.css) - and ends above the
   bottom of the screen, so its lower sections are reached by scrolling the menu, not the page. Wide screens only
   (below that the menu sits above the page). Set through the CSSOM, not a style attribute, which the
   Content-Security-Policy refuses. */
export function usePinnedMenu(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1101px)');
    const fit = () => {
      const el = ref.current;
      const frame = el?.parentElement;
      if (!el || !frame) return;
      if (!wide.matches) {
        el.style.removeProperty('max-height');
        el.style.removeProperty('top');
        return;
      }
      // Measured from the layout, never from the scroll, so nothing moves while the page does.
      const heading = frame.previousElementSibling as HTMLElement | null;
      const style = heading ? getComputedStyle(heading) : null;
      const top = Math.round(
        heading && style?.position === 'sticky'
          ? parseFloat(style.top) + heading.offsetHeight + (parseFloat(getComputedStyle(frame).paddingTop) || 0)
          : frame.getBoundingClientRect().top + window.scrollY,
      );
      // The page's own space under the frame (its bottom padding): a menu reaching lower than that is pushed up by
      // its frame at the very end of the page, which made the page jump there.
      const below = parseFloat(getComputedStyle(frame.parentElement ?? frame).paddingBottom) || 0;
      el.style.setProperty('top', `${top}px`);
      el.style.setProperty('max-height', `${Math.max(200, Math.floor(window.innerHeight - top - below - 12))}px`);
    };
    fit();
    // The title can change height (text size, a narrower window); the page's own length never matters.
    const heading = ref.current?.parentElement?.previousElementSibling;
    const observer = new ResizeObserver(fit);
    if (heading) observer.observe(heading);
    window.addEventListener('resize', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [ref]);
}
