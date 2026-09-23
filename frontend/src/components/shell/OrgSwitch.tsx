'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Icon } from '@/components/Icon';
import { OrgLogo } from '@/components/ui/OrgLogo';
import { useToast } from '@/components/ui/Toast';
import { roleLabels } from '@/lib/labels';
import type { Membership } from '@/lib/types';
import { useOpenOnThisPage } from './chrome';

/* The organization switch at the top of the staff sidebar (it was a plain select): the organization open now, with
   the member's role in it, and a menu of every organization they work in, each with its role, the open one ticked.
   With many organizations the menu has a search. The menu is drawn fixed beside the button, since the sidebar clips
   what sticks out of it (below the button, or to its right while the sidebar is collapsed to icons).
   Markup: layout.css (.org-switch, .org-menu). */

const SEARCH_FROM = 7;

export function OrgSwitch({ memberships, current, onSwitch }: { memberships: Membership[]; current: string | null; onSwitch: (id: string) => Promise<unknown> }) {
  const toast = useToast();
  const [open, setOpen] = useOpenOnThisPage();
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const here = memberships.find((m) => m.id === current) ?? null;

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const box = button.current?.getBoundingClientRect();
      const el = menu.current;
      if (!box || !el) return;
      const beside = document.documentElement.classList.contains('sidebar-collapsed') && window.innerWidth > 760;
      // As wide as the button under it (the phone's sliding sidebar clips anything wider), or up to 320px beside it.
      const width = beside ? Math.min(320, window.innerWidth - box.right - 22) : box.width;
      const left = beside ? box.right + 10 : box.left;
      const top = beside ? box.top : box.bottom + 8;
      // Through the CSS object model: the Content-Security-Policy refuses style attributes.
      el.style.setProperty('left', `${Math.round(left)}px`);
      el.style.setProperty('top', `${Math.round(top)}px`);
      el.style.setProperty('width', `${Math.round(width)}px`);
      el.style.setProperty('max-height', `${Math.max(200, Math.round(window.innerHeight - top - 12))}px`);
    };
    const onClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    place();
    window.addEventListener('resize', place);
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    // The keyboard starts on the search when there is one, else on the organization open now.
    (menu.current?.querySelector<HTMLElement>('.org-menu-search input') ?? menu.current?.querySelector<HTMLElement>('.org-option[aria-checked="true"]'))?.focus();
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  const term = query.trim().toLowerCase();
  const shown = term ? memberships.filter((m) => m.name.toLowerCase().includes(term)) : memberships;

  const choose = (id: string) => {
    setOpen(false);
    setQuery('');
    button.current?.focus();
    if (id !== current) onSwitch(id).catch((error: Error) => toast(error.message, true));
  };
  // ↑/↓ move between the organizations inside the open menu.
  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('.org-option') ?? [])];
    if (!items.length) return;
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items[at < 0 ? 0 : (at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  };

  return (
    <div className="workspace-select org-switch" ref={root} data-tip={here?.name ?? 'เลือกองค์กร'}>
      <button
        ref={button}
        type="button"
        id="tenant-switch"
        className="org-switch-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="org-menu"
        aria-label={here ? `องค์กร: ${here.name} · เปลี่ยนองค์กร` : 'เลือกองค์กร'}
        onClick={() => setOpen((o) => !o)}
      >
        <OrgLogo slug={here?.slug} name={here?.name || 'B'} hasLogo={here?.has_logo} />
        <span className="org-switch-text">
          <strong>{here?.name ?? 'ไม่มีองค์กรที่ใช้งานอยู่'}</strong>
          <small>{here ? roleLabels[here.role] : 'เลือกองค์กร'}</small>
        </span>
        <Icon name="down" />
      </button>
      <div ref={menu} className="org-menu" id="org-menu" role="menu" aria-label="เปลี่ยนองค์กร" hidden={!open} onKeyDown={onMenuKey}>
        <p className="org-menu-title">
          องค์กรที่คุณทำงานอยู่<span>{memberships.length}</span>
        </p>
        {memberships.length >= SEARCH_FROM && (
          <label className="org-menu-search">
            <Icon name="search" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาองค์กร" aria-label="ค้นหาองค์กร" />
          </label>
        )}
        <div className="org-menu-list">
          {shown.map((m, i) => (
            <button
              key={m.id}
              type="button"
              role="menuitemradio"
              aria-checked={m.id === current}
              className="org-option"
              onClick={() => choose(m.id)}
            >
              <OrgLogo slug={m.slug} name={m.name} index={i + 1} hasLogo={m.has_logo} />
              <span className="org-option-text">
                <strong>{m.name}</strong>
                <small>{roleLabels[m.role]}</small>
              </span>
              {m.id === current && <Icon name="check" />}
            </button>
          ))}
          {!shown.length && <p className="org-menu-empty">{memberships.length ? 'ไม่พบองค์กรที่ค้นหา' : 'ยังไม่มีองค์กรที่ใช้งานอยู่'}</p>}
        </div>
        <Link className="org-menu-more" href="/account?tab=organizations" onClick={() => setOpen(false)}>
          <Icon name="users" />
          จัดการองค์กรของฉัน
        </Link>
      </div>
    </div>
  );
}
