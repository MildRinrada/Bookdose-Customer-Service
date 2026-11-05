'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { prefersStill } from '@/lib/motion';

/* A figure that counts up to itself the first time it is shown (the overview's and the reports' stat cards), so the
   numbers arrive rather than sit there. Only the first time: a figure that changes later, while someone reads the
   page, simply changes. What is not a plain figure ("-", a name) is shown as it is. The text node React wrote is
   the one counted, so React keeps hold of it. */

const FIGURE = /^(\D*?)(\d[\d,]*(?:\.\d+)?)(\D*)$/;
const DURATION = 700;

export function CountUp({ value }: { value: ReactNode }) {
  const box = useRef<HTMLSpanElement>(null);
  const done = useRef(false);
  const text = typeof value === 'number' || typeof value === 'string' ? String(value) : null;

  useEffect(() => {
    const node = box.current?.firstChild;
    if (text === null || !node || node.nodeType !== Node.TEXT_NODE) return;
    // Counted once already: whatever an unfinished count left behind gives way to the figure itself.
    if (done.current) {
      node.nodeValue = text;
      return;
    }
    done.current = true;
    const parts = FIGURE.exec(text);
    if (!parts || prefersStill()) return;
    const [, before, figure, after] = parts;
    const target = Number(figure.replace(/,/g, ''));
    const decimals = figure.split('.')[1]?.length ?? 0;
    const grouped = figure.includes(',');
    if (!target) return;
    const show = (n: number) => {
      const fixed = n.toFixed(decimals);
      node.nodeValue = before + (grouped ? Number(fixed).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : fixed) + after;
    };
    const start = performance.now();
    let frame = 0;
    let finished = false;
    const tick = (moment: number) => {
      const t = Math.min(1, (moment - start) / DURATION);
      if (t >= 1) {
        node.nodeValue = text;
        finished = true;
        return;
      }
      show(target * (1 - Math.pow(1 - t, 3)));
      frame = requestAnimationFrame(tick);
    };
    show(0);
    frame = requestAnimationFrame(tick);
    // Stopped halfway (the page left, or development's double run): the figure as it is, and the count may run again.
    return () => {
      cancelAnimationFrame(frame);
      if (!finished) {
        done.current = false;
        node.nodeValue = text;
      }
    };
  }, [text]);

  return text === null ? <>{value}</> : <span ref={box}>{text}</span>;
}
