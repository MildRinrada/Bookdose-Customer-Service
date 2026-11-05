'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { prefersStill } from '@/lib/motion';
import type { Role } from '@/lib/types';
import { tours, type TourStep } from './tours';

/* ไกด์การใช้งาน (tours.ts): the screen is dimmed except for the thing a step talks about, and a card beside it says
   what it is for. It goes from page to page by itself, so a new member sees where everything is without having to
   find it first.

   Remembered in this browser, per account and role (localStorage), not on the server: an organization that tries
   the system on several computers with one account sees it once on each computer, so every person who sits down at
   one is shown around. It starts by itself on the member's home page once nothing else is asking for an answer (the
   legal documents, a dialog), and again from the ? in the top bar (startTour). Raising VERSION shows it once more to
   everyone, for a guide that changed a lot.

   The page under it takes no clicks while it runs; Esc or ข้าม ends it, ← and → move through it. Positions are set
   through the CSS object model (the page's CSP allows no inline style attributes). Markup: pages/tour.css. */

const VERSION = '1';
const EVENT = 'bookdose:tour';
/** How long a step waits for what it lights up (a page still loading its data) before going on without it. */
const FIND_MS = 6000;
/** On its own: after the page has settled, so the guide is not the first thing to flash past. */
const SETTLE_MS = 1200;
/** Anything that is waiting for an answer goes first; the guide waits for it to close. */
const BUSY = '.legal-gate, dialog[open], .initial-loading';

const keyOf = (role: Role, userId: string) => `bookdose.tour:${role}:${userId}`;

function seen(role: Role, userId: string) {
  try {
    return localStorage.getItem(keyOf(role, userId)) === VERSION;
  } catch {
    // Storage refused: shown on every visit would be worse than not at all; the ? still opens it.
    return true;
  }
}

function remember(role: Role, userId: string) {
  try {
    localStorage.setItem(keyOf(role, userId), VERSION);
  } catch {
    /* Only for this visit, then. */
  }
}

/** Open the guide of the member's role from the start (the ? in the top bar). */
export function startTour() {
  window.dispatchEvent(new Event(EVENT));
}

/** Is the browser at a step's page? Its path or one under it (the inbox opens its first chat at /inbox/<id>), and every
    value its query names (?tab=ai), the rest of the address aside. */
function isAt(path: string) {
  const [pathname, query = ''] = path.split('?');
  const here = window.location.pathname;
  if (here !== pathname && !here.startsWith(pathname + '/')) return false;
  const params = new URLSearchParams(window.location.search);
  return [...new URLSearchParams(query)].every(([key, value]) => params.get(key) === value);
}

/** On screen: with a size, not hidden, and not slid out to the side (the phone's closed menu). */
function shown(element: Element) {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && box.right > 0 && box.left < window.innerWidth && getComputedStyle(element).visibility !== 'hidden';
}

function find(step: TourStep): HTMLElement | null {
  for (const selector of step.target ?? []) {
    const element = [...document.querySelectorAll<HTMLElement>(selector)].find(shown);
    if (element) return element;
  }
  return null;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));

/** Where the light goes: the target, or (hug) around what is inside it. */
function boxOf(target: HTMLElement, hug: boolean | undefined): DOMRect {
  const whole = target.getBoundingClientRect();
  if (!hug || target.children.length < 2) return whole;
  const parts = [...target.children].map((child) => child.getBoundingClientRect()).filter((box) => box.width > 0 && box.height > 0);
  if (!parts.length) return whole;
  const top = Math.min(...parts.map((box) => box.top));
  const left = Math.min(...parts.map((box) => box.left));
  return new DOMRect(left, top, Math.max(...parts.map((box) => box.right)) - left, Math.max(...parts.map((box) => box.bottom)) - top);
}

/** The pinned top bar's height (StaffShell sets it): what is under it is not on screen. */
const topBar = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 0;

type Run = { steps: TourStep[]; index: number; origin: string; forward: boolean };

export function Tour({
  role,
  userId,
  organization,
  home,
  searchKey,
}: {
  role: Role;
  userId: string;
  organization: string;
  home: string;
  searchKey: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [run, setRun] = useState<Run | null>(null);
  // The step on screen: what it lights up (null: the card in the middle), once it has been looked for.
  const [found, setFound] = useState<{ index: number; target: HTMLElement | null } | null>(null);
  const card = useRef<HTMLElement>(null);
  const spot = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const tour = tours[role];

  const start = useCallback(() => {
    setFound(null);
    setRun({
      // What the top bar does not have here (a switch the platform turned off) is left out now, so the count does not
      // jump over it later. A page's own card is only known on its page.
      steps: tours[role].steps({ organization, searchKey }).filter((s) => s.path || !s.optional || !s.target || find(s)),
      index: 0,
      origin: window.location.pathname + window.location.search,
      forward: true,
    });
  }, [role, organization, searchKey]);

  const finish = useCallback(() => {
    remember(role, userId);
    // Back where it started: the guide took the member around, it should not leave them somewhere else.
    if (run && window.location.pathname + window.location.search !== run.origin) router.push(run.origin, { scroll: false });
    setRun(null);
    setFound(null);
  }, [run, role, userId, router]);

  const go = useCallback((delta: number) => {
    setRun((current) => {
      if (!current) return current;
      const index = clamp(current.index + delta, 0, current.steps.length - 1);
      return index === current.index ? current : { ...current, index, forward: delta > 0 };
    });
  }, []);

  // From the ? in the top bar.
  useEffect(() => {
    window.addEventListener(EVENT, start);
    return () => window.removeEventListener(EVENT, start);
  }, [start]);

  // By itself: the first time this account opens its home page in this browser, once the page is free.
  useEffect(() => {
    if (run || pathname !== home || seen(role, userId)) return;
    let timer = 0;
    const attempt = () => {
      if (document.querySelector(BUSY)) timer = window.setTimeout(attempt, 800);
      else start();
    };
    timer = window.setTimeout(attempt, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [run, pathname, home, role, userId, start]);

  // Each step: to its page, then wait for what it lights up.
  const index = run?.index ?? -1;
  const step = run ? run.steps[run.index] : null;
  useEffect(() => {
    if (!run || !step) return;
    if (step.path && !isAt(step.path)) router.push(step.path, { scroll: false });
    const began = Date.now();
    let timer = 0;
    const look = () => {
      const there = !step.path || isAt(step.path);
      const target = there && step.target ? find(step) : null;
      if (target || (there && !step.target)) {
        const box = target?.getBoundingClientRect();
        if (box && (box.top < 0 || box.bottom > window.innerHeight))
          target!.scrollIntoView({ block: box.height > window.innerHeight * 0.8 ? 'start' : 'center', behavior: prefersStill() ? 'auto' : 'smooth' });
        setFound({ index: run.index, target });
        return;
      }
      if (Date.now() - began < FIND_MS) {
        timer = window.setTimeout(look, 120);
        return;
      }
      // Not on this screen (a card this role or this screen size does not have): an optional step is left out.
      const last = run.index === run.steps.length - 1;
      if (step.optional && !(run.forward && last) && !(!run.forward && run.index === 0)) go(run.forward ? 1 : -1);
      else setFound({ index: run.index, target: null });
    };
    timer = window.setTimeout(look, 60);
    return () => window.clearTimeout(timer);
    // run.forward and run.steps only change with the index (a new run starts at 0 with found cleared).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, run?.steps]);

  const current = found && found.index === index ? found : null;
  // The step the page was moved for, so the card has room under what it talks about (once per step).
  const roomMade = useRef(-1);
  // What is lit: found again when the page puts a new one in its place (the inbox redraws as it opens its first chat).
  const lit = useRef<HTMLElement | null>(null);

  // Where the light and the card go: around the target, the card on the side with room (beside a tall one).
  const layout = useCallback(() => {
    const box = card.current;
    const light = spot.current;
    if (!box || !light || !current || !step) return;
    if (lit.current && !lit.current.isConnected) lit.current = find(step);
    const width = window.innerWidth;
    const height = window.innerHeight;
    const target = lit.current ? boxOf(lit.current, step.hug) : null;
    const pad = 6;
    const gap = 14;
    const margin = 16;
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    // The lit box, before it is cut to the screen (and, for one taller than the room, to its top part).
    let shown = target ? { top: target.top - pad, left: target.left - pad, right: target.right + pad, bottom: target.bottom + pad } : null;
    let place = 'center';
    let x = (width - w) / 2;
    let y = (height - h) / 2;
    if (width < 640) {
      // A phone: the card is a sheet across the bottom, or the top when what it talks about is down there.
      place = target && target.top + target.height / 2 > height / 2 ? 'sheet-top' : 'sheet';
    } else if (target && shown) {
      const across = clamp(target.left + target.width / 2 - w / 2, margin, width - w - margin);
      const down = clamp(target.top + target.height / 2 - h / 2, margin, height - h - margin);
      const sides: Array<[string, boolean, number, number]> = [
        ['below', shown.bottom + gap + h <= height - margin, across, shown.bottom + gap],
        ['above', shown.top - gap - h >= margin, across, shown.top - gap - h],
        ['right', shown.right + gap + w <= width - margin, shown.right + gap, down],
        ['left', shown.left - gap - w >= margin, shown.left - gap - w, down],
      ];
      // A tall one (the menu, the chat list) is talked about from beside it; anything else from under or over it.
      const order = target.height > height * 0.35 ? [2, 3, 0, 1] : [0, 1, 2, 3];
      const side = order.map((i) => sides[i]).find(([, fits]) => fits);
      if (side) [place, , x, y] = side;
      else {
        // Bigger than the room around it. Moved up under the top bar first (once; the scroll lays it out again),
        // then its top part is lit with the card under it, or, with too little of it left, the card goes over it.
        const room = topBar() + margin;
        if (roomMade.current !== index && shown.top > room + 4) {
          roomMade.current = index;
          window.scrollBy({ top: shown.top - room, behavior: prefersStill() ? 'auto' : 'smooth' });
        }
        const cut = height - margin - h - gap;
        if (cut - Math.max(shown.top, room) >= 140) {
          shown = { ...shown, bottom: Math.min(shown.bottom, cut) };
          place = 'below';
          x = across;
          y = shown.bottom + gap;
        } else {
          place = 'inside';
          x = across;
          y = clamp(target.top + margin, margin, height - h - margin);
        }
      }
    }
    if (shown) {
      const top = Math.max(shown.top, 4);
      const left = Math.max(shown.left, 4);
      light.style.setProperty('--y', `${top}px`);
      light.style.setProperty('--x', `${left}px`);
      light.style.setProperty('--w', `${Math.max(Math.min(shown.right, width - 4) - left, 0)}px`);
      light.style.setProperty('--h', `${Math.max(Math.min(shown.bottom, height - 4) - top, 0)}px`);
    } else {
      light.style.setProperty('--y', `${height / 2}px`);
      light.style.setProperty('--x', `${width / 2}px`);
      light.style.setProperty('--w', '0px');
      light.style.setProperty('--h', '0px');
    }
    light.dataset.lit = shown ? 'true' : 'false';
    box.dataset.place = place;
    if (place.startsWith('sheet')) return;
    box.style.setProperty('--x', `${Math.round(x)}px`);
    box.style.setProperty('--y', `${Math.round(y)}px`);
  }, [current, index, step]);

  useLayoutEffect(() => {
    if (!current) return;
    lit.current = current.target;
    layout();
    let frame = 0;
    const again = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(layout);
    };
    // Also now and then: what loads above the target moves it without a resize or a scroll.
    const tick = window.setInterval(again, 400);
    window.addEventListener('resize', again);
    window.addEventListener('scroll', again, true);
    const watch = new ResizeObserver(again);
    if (current.target) watch.observe(current.target);
    if (card.current) watch.observe(card.current);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(tick);
      window.removeEventListener('resize', again);
      window.removeEventListener('scroll', again, true);
      watch.disconnect();
    };
  }, [current, layout]);

  // The keys, and the focus kept on the card (unless a dialog of the page's own opened over it).
  useEffect(() => {
    if (!run) return;
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open], .legal-gate')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        finish();
      } else if (event.key === 'ArrowRight' && !event.altKey) {
        event.preventDefault();
        if (run.index === run.steps.length - 1) finish();
        else go(1);
      } else if (event.key === 'ArrowLeft' && !event.altKey) {
        event.preventDefault();
        go(-1);
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (document.querySelector('dialog[open], .legal-gate')) return;
      if (card.current && !card.current.contains(event.target as Node)) primary.current?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus);
    };
  }, [run, go, finish]);

  useEffect(() => {
    if (current) primary.current?.focus({ preventScroll: true });
  }, [current]);

  if (!run || !step) return null;
  const last = run.index === run.steps.length - 1;
  const total = run.steps.length;
  return (
    <div className="tour-layer">
      {/* The page under the guide takes no clicks: it moves by itself, and a click there would lose the member. */}
      <div className="tour-block" aria-hidden="true" />
      <div ref={spot} className="tour-spot" aria-hidden="true" />
      {current && (
        <section
          ref={card}
          key={run.index}
          className="tour-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-title"
          aria-describedby="tour-body"
        >
          <header className="tour-head">
            <span className="tour-label">
              <Icon name="sparkle" />
              {tour.label}
            </span>
            <button type="button" className="icon-btn tour-close" aria-label="ปิดไกด์" title="ปิดไกด์ เปิดอีกครั้งได้ที่ปุ่ม ?" onClick={finish}>
              <Icon name="close" />
            </button>
          </header>
          <h2 id="tour-title">{step.title}</h2>
          <p id="tour-body">{step.body}</p>
          <footer className="tour-foot">
            <span className="tour-progress" aria-label={`ขั้นที่ ${run.index + 1} จาก ${total}`}>
              <span className="tour-count">
                {run.index + 1}/{total}
              </span>
              <span className="tour-track" aria-hidden="true">
                <ProgressFill value={(run.index + 1) / total} />
              </span>
            </span>
            {run.index === 0 ? (
              <button type="button" className="btn" onClick={finish}>
                ข้าม
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => go(-1)}>
                <Icon name="back" />
                ย้อนกลับ
              </button>
            )}
            <button ref={primary} type="button" className="btn primary" onClick={() => (last ? finish() : go(1))}>
              {last ? 'เริ่มใช้งาน' : run.index === 0 ? 'เริ่มเลย' : 'ถัดไป'}
              {!last && <Icon name="arrow" />}
            </button>
          </footer>
        </section>
      )}
    </div>
  );
}

/** The bar under the count, filled to where the guide is (a CSS variable: no inline style attribute). */
function ProgressFill({ value }: { value: number }) {
  const bar = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    bar.current?.style.setProperty('--done', String(value));
  }, [value]);
  return <span ref={bar} className="tour-fill" />;
}
