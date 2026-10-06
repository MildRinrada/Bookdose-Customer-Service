'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';

/* The chat header's menu (the profile menu's markup): follow this chat, start another, forget this browser.
   Closes on a click outside, on Escape (focus back on the button) and after choosing. */

/** `danger` for what cannot be undone, `done` for what finishes the case: neither reads as one more setting. */
export type GuestMenuItem = { key: string; label: string; icon: string; danger?: boolean; done?: boolean; onSelect: () => void };

export function GuestMenu({ items }: { items: GuestMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>('.menu-item')?.focus();
    const onClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>('.menu-item') ?? [])];
      if (!buttons.length) return;
      event.preventDefault();
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'ArrowDown' ? (at + 1) % buttons.length : (at - 1 + buttons.length) % buttons.length;
      buttons[next].focus();
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className="profile-menu guest-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className="icon-btn guest-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="guest-menu"
        aria-label="เมนูแชท"
        title="เมนูแชท"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="menu" />
      </button>
      <div className="profile-menu-panel guest-menu-panel" id="guest-menu" role="menu" ref={panel} hidden={!open}>
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            className={`menu-item${item.danger ? ' danger' : ''}${item.done ? ' done' : ''}`}
            onClick={() => {
              setOpen(false);
              item.onSelect();
            }}
          >
            <Icon name={item.icon} />
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
