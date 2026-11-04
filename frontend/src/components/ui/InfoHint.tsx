'use client';

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/Icon';
import { askAi, settingsHelpHere } from '@/features/ai/askAi';

/* An explanation that stays out of the way: a small (i) beside a title, and the text only when it is asked for.

   A card or a setting that explains itself in full on the page is a page of explanations, and the figures it is
   about get lost in them. So the text waits behind the (i): pointing at it shows it, clicking keeps it open (and on a
   phone, where nothing can be pointed at, a tap is the click), and pointing away, clicking elsewhere, Esc or
   scrolling put it away. It is drawn over the page, outside the card, so a card is never taller for having one and
   a card that clips its edges never cuts it off. Inside an open dialog it is drawn in the dialog instead: a modal
   dialog sits in the browser's top layer, above anything else on the page however high its z-index.

   Inside a link (a stat tile) a second control would be a control inside a control, so there `still` draws the (i)
   without a button: the text shows when the (i) is pointed at, and the link carries it as its description.

   On a settings page with a guide (features/ai/askAi), the text kept open by a click also offers ถาม AI เพิ่ม: the
   field's name and these words go to the ผู้ช่วย AI as a question, with the page. Pointing alone shows the text only,
   so nothing moves under a passing pointer. Markup: components.css (info-hint). */

const WIDTH = 300;
const GAP = 8;

/** host: where the text is drawn, the open dialog around the (i) or else the page. */
type Place = { x: number; y: number; above: boolean; host: Element };

/** Centred under (or over) the (i), but never so near the window's edge that the widest text would not fit. */
function placeBeside(anchor: HTMLElement): Place {
  const rect = anchor.getBoundingClientRect();
  const half = Math.min(WIDTH, window.innerWidth - 2 * GAP) / 2;
  const x = Math.min(Math.max(GAP + half, rect.left + rect.width / 2), window.innerWidth - GAP - half);
  // Below the (i), unless the window ends too soon there: then above it.
  const above = rect.bottom + 180 > window.innerHeight && rect.top > 180;
  return { x, y: above ? window.innerHeight - rect.top + GAP : rect.bottom + GAP, above, host: anchor.closest('dialog') ?? document.body };
}

export function InfoHint({ children, label = 'คำอธิบาย', still = false }: { children: ReactNode; label?: string; still?: boolean }) {
  const id = useId();
  const anchor = useRef<HTMLElement>(null);
  const pop = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<Place | null>(null);
  const [pinned, setPinned] = useState<Place | null>(null);
  const place = pinned ?? hover;

  // Put away when the page moves under it, on Esc, and (once kept open) on a click anywhere else.
  useEffect(() => {
    if (!place) return;
    const away = () => {
      setHover(null);
      setPinned(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // From the ถาม AI button inside, back to the (i) it belongs to.
      const inside = pop.current?.contains(document.activeElement);
      away();
      if (inside) anchor.current?.focus();
    };
    const outside = (e: PointerEvent) => {
      if (!anchor.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node)) away();
    };
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
      document.removeEventListener('keydown', key);
      document.removeEventListener('pointerdown', outside);
    };
  }, [place]);

  const show = () => anchor.current && setHover(placeBeside(anchor.current));
  const hide = () => setHover(null);

  // ถาม AI เพิ่ม, once the text is kept open on a settings page with a guide.
  const asks = pinned ? settingsHelpHere() : null;
  const byKeyboard = useRef(false);
  useEffect(() => {
    if (pinned && asks && byKeyboard.current) pop.current?.querySelector<HTMLButtonElement>('.info-hint-ask')?.focus();
  }, [pinned, asks]);
  const askMore = () => {
    if (!asks) return;
    const owner = anchor.current?.closest('label, legend, th, dt, h2, h3, h4');
    const name = (owner?.textContent ?? '').replace('*', '').trim();
    const words = (pop.current?.textContent ?? '').replace('ถาม AI เพิ่ม', '').trim();
    setPinned(null);
    setHover(null);
    askAi({ section: asks, question: `อธิบายเพิ่มเรื่อง "${name || 'ส่วนนี้'}" ในหน้านี้${words ? ` (หน้าจอบอกไว้ว่า ${words.slice(0, 400)})` : ''}` });
  };

  const bubble =
    place &&
    createPortal(
      <div
        id={id}
        // With a button in it, it is something to use, not only to read.
        role={asks ? 'dialog' : 'tooltip'}
        aria-label={asks ? label : undefined}
        className={`info-hint-pop${place.above ? ' above' : ''}`}
        // The place is measured, so it is written through the CSSOM (the page's rules allow that, not a style attribute).
        ref={(el) => {
          pop.current = el;
          el?.style.setProperty('--x', `${place.x}px`);
          el?.style.setProperty('--y', `${place.y}px`);
        }}
      >
        {children}
        {asks && (
          <button type="button" className="info-hint-ask" onClick={askMore}>
            <Icon name="sparkle" />
            ถาม AI เพิ่ม
          </button>
        )}
      </div>,
      place.host,
    );

  if (still)
    return (
      <span className="info-hint still" ref={anchor as RefObject<HTMLSpanElement>} onMouseEnter={show} onMouseLeave={hide}>
        <Icon name="info" />
        <span className="sr-only">{children}</span>
        {bubble}
      </span>
    );

  return (
    <>
      <button
        ref={anchor as RefObject<HTMLButtonElement>}
        type="button"
        className={`info-hint${pinned ? ' pinned' : ''}`}
        aria-label={label}
        aria-describedby={place ? id : undefined}
        aria-expanded={Boolean(pinned)}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={() => !pinned && hide()}
        onClick={(e) => {
          // A title that is itself a link or a summary should not also be pressed.
          e.preventDefault();
          e.stopPropagation();
          if (pinned) {
            setPinned(null);
            setHover(null);
          } else if (anchor.current) {
            // Enter or Space (no pointer): the ถาม AI button inside takes the focus, so it can be reached.
            byKeyboard.current = e.detail === 0;
            setPinned(placeBeside(anchor.current));
          }
        }}
      >
        <Icon name="info" />
      </button>
      {bubble}
    </>
  );
}
