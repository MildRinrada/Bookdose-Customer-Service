'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useOpenOnThisPage } from './chrome';

/* Reading preferences shared by staff, sign-in and customer pages: html[data-text-size] scales the whole app
   (src/styles/text-size.css) and html[data-theme] repaints it (src/styles/themes.css). Both are kept in this browser,
   not on the account: it is how this person reads on this screen, and the screen at home is a different screen.

   The layout's first script applies them before anything is drawn - a saved dark theme that arrived one paint late
   would flash the whole white page at somebody reading in the dark. */

const KEY = 'bookdose.text-size';
const SIZES = ['80', '90', '100', '110', '120', '130', '140', '150'];
const LEGACY: Record<string, string> = { normal: '100', large: '110', larger: '130', largest: '150' };
const valid = (value: string | null | undefined) => (value && SIZES.includes(value) ? value : (value && LEGACY[value]) || '100');

const THEME_KEY = 'bookdose.theme';
export const THEMES = [
  { value: 'light', label: 'ขาว', title: 'พื้นขาว (ค่าเดิม)' },
  { value: 'cream', label: 'ครีม', title: 'พื้นครีม สบายตาในที่สว่าง' },
  { value: 'dark', label: 'ดาร์ก', title: 'พื้นเทาเข้ม' },
  { value: 'black', label: 'ดำ', title: 'พื้นดำ สำหรับห้องมืด' },
] as const;
const THEME_VALUES = THEMES.map((t) => t.value) as readonly string[];
const validTheme = (value: string | null | undefined) => (value && THEME_VALUES.includes(value) ? value : 'light');

/** The script the root layout runs first (with the CSP nonce): text size, theme and the collapsed sidebar, before paint. */
export const EARLY_PREFERENCES_SCRIPT = `(function(){var d=document.documentElement;try{var s=${JSON.stringify(SIZES)},l=${JSON.stringify(
  LEGACY,
)},v=localStorage.getItem('${KEY}');d.dataset.textSize=s.indexOf(v)>=0?v:(l[v]||'100');var t=${JSON.stringify(
  THEME_VALUES,
)},k=localStorage.getItem('${THEME_KEY}');d.dataset.theme=t.indexOf(k)>=0?k:'light';if(localStorage.getItem('bookdose.sidebar')==='collapsed')d.classList.add('sidebar-collapsed');}catch(e){d.dataset.textSize='100';d.dataset.theme='light';}})();`;

const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab of the same app changed a preference: follow it, so two windows never disagree.
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) document.documentElement.dataset.textSize = valid(event.newValue);
    if (event.key === THEME_KEY || event.key === null) document.documentElement.dataset.theme = validTheme(event.newValue);
    if (event.key === KEY || event.key === THEME_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage may be disabled: the choice still works on this page. */
  }
  listeners.forEach((l) => l());
}

function save(value: string) {
  const size = valid(value);
  document.documentElement.dataset.textSize = size;
  remember(KEY, size);
}

function saveTheme(value: string) {
  const theme = validTheme(value);
  document.documentElement.dataset.theme = theme;
  remember(THEME_KEY, theme);
}

/** The four papers to read on. Beside the size, as an e-reader puts them. */
export function ThemeControls() {
  const theme = useSyncExternalStore(subscribe, () => validTheme(document.documentElement.dataset.theme), () => 'light');
  return (
    <div className="text-size-controls theme-controls">
      <label id="theme-choice-label">ธีมสี</label>
      <div className="theme-choices" role="group" aria-labelledby="theme-choice-label">
        {THEMES.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`theme-chip is-${option.value}`}
            title={option.title}
            aria-label={option.title}
            aria-pressed={theme === option.value}
            onClick={() => saveTheme(option.value)}
          >
            T
          </button>
        ))}
      </div>
    </div>
  );
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
        <ThemeControls />
      </div>
    </div>
  );
}
