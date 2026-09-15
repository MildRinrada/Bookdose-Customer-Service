'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useOpenOnThisPage } from './chrome';

/* A browser preference shared by staff, sign-in and customer pages: html[data-text-size] scales the whole app
   (src/styles/text-size.css). The layout's first script applies the saved size before anything is drawn. */

const KEY = 'bookdose.text-size';
const SIZES = ['80', '90', '100', '110', '120', '130', '140', '150'];
const LEGACY: Record<string, string> = { normal: '100', large: '110', larger: '130', largest: '150' };
const valid = (value: string | null | undefined) => (value && SIZES.includes(value) ? value : (value && LEGACY[value]) || '100');

/** The script the root layout runs first (with the CSP nonce): text size and the collapsed sidebar, before paint. */
export const EARLY_PREFERENCES_SCRIPT = `(function(){var d=document.documentElement;try{var s=${JSON.stringify(SIZES)},l=${JSON.stringify(
  LEGACY,
)},v=localStorage.getItem('${KEY}');d.dataset.textSize=s.indexOf(v)>=0?v:(l[v]||'100');if(localStorage.getItem('bookdose.sidebar')==='collapsed')d.classList.add('sidebar-collapsed');}catch(e){d.dataset.textSize='100';}})();`;

const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) {
      document.documentElement.dataset.textSize = valid(event.newValue);
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function save(value: string) {
  const size = valid(value);
  document.documentElement.dataset.textSize = size;
  try {
    localStorage.setItem(KEY, size);
  } catch {
    /* Storage may be disabled: the choice still works on this page. */
  }
  listeners.forEach((l) => l());
}

/** The label, A− / the size / A+, as a group. Shown as is on sign-in and link pages. */
export function TextSizeControls() {
  const size = useSyncExternalStore(subscribe, () => valid(document.documentElement.dataset.textSize), () => '100');
  const index = SIZES.indexOf(size);
  return (
    <div className="text-size-controls">
      <label htmlFor="text-size-select">ขนาดตัวอักษร</label>
      <div className="text-size-steps">
        <button type="button" title="ลดขนาดตัวอักษร" aria-label="ลดขนาดตัวอักษร" disabled={index <= 0} onClick={() => save(SIZES[Math.max(0, index - 1)])}>
          A−
        </button>
        <select id="text-size-select" value={size} onChange={(e) => save(e.target.value)}>
          {SIZES.map((value) => (
            <option key={value} value={value}>
              {value}%
            </option>
          ))}
        </select>
        <button
          type="button"
          title="เพิ่มขนาดตัวอักษร"
          aria-label="เพิ่มขนาดตัวอักษร"
          disabled={index >= SIZES.length - 1}
          onClick={() => save(SIZES[Math.min(SIZES.length - 1, index + 1)])}
        >
          A+
        </button>
      </div>
    </div>
  );
}

/** In a top bar the controls sit behind a small "Aa" button so they don't crowd the bar. */
export function TextSizeMenu() {
  const [open, setOpen] = useOpenOnThisPage();
  const menu = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);
  return (
    <div className="text-size-menu" ref={menu}>
      <button
        ref={toggle}
        type="button"
        className="text-size-toggle"
        title="ปรับขนาดตัวอักษร"
        aria-label="ปรับขนาดตัวอักษร"
        aria-controls="text-size-panel"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Aa
      </button>
      <div className="text-size-panel" id="text-size-panel" hidden={!open}>
        <TextSizeControls />
      </div>
    </div>
  );
}
