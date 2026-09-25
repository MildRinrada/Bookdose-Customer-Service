'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';

/* Pieces both frames (staff and customer) are built from: the brand, a menu entry, the sidebar's collapse and mobile
   toggles, and the profile menu in the top bar. */

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="Bookdose Customer Service">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="brand-logo" src="/logo.png" width={40} height={40} alt="" />
      <span className="brand-text">
        bookdose<small>CUSTOMER SERVICE</small>
      </span>
    </Link>
  );
}

export function NavItem({ href, label, icon, active, count = 0 }: { href: string; label: string; icon: string; active: boolean; count?: number }) {
  return (
    <Link href={href} className={`nav-item${active ? ' active' : ''}`} data-tip={label} aria-current={active ? 'page' : undefined}>
      <Icon name={icon} />
      <span>{label}</span>
      {count > 0 && <span className="nav-count">{count}</span>}
    </Link>
  );
}

/** A panel that closes on moving to another screen: it is open only on the address it was opened on. */
export function useOpenOnThisPage() {
  const pathname = usePathname();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const setOpen = useCallback(
    (next: boolean | ((open: boolean) => boolean)) =>
      setOpenOn((current) => ((typeof next === 'function' ? next(current === pathname) : next) ? pathname : null)),
    [pathname],
  );
  return [openOn === pathname, setOpen] as const;
}

// The collapsed sidebar is a class on <html> (set before paint by the layout's first script); components follow it.
const sidebarListeners = new Set<() => void>();
const subscribeSidebar = (listener: () => void) => {
  sidebarListeners.add(listener);
  return () => void sidebarListeners.delete(listener);
};
const sidebarCollapsed = () => document.documentElement.classList.contains('sidebar-collapsed');

/** The sidebar can be collapsed to icons (remembered in the browser) and, on phones, slides in over the page. */
export function useSidebar() {
  const collapsed = useSyncExternalStore(subscribeSidebar, sidebarCollapsed, () => false);
  const [mobileOpen, setMobileOpen] = useOpenOnThisPage();
  const toggleCollapsed = () => {
    const next = document.documentElement.classList.toggle('sidebar-collapsed');
    try {
      localStorage.setItem('bookdose.sidebar', next ? 'collapsed' : '');
    } catch {
      /* Still works for this page. */
    }
    sidebarListeners.forEach((listener) => listener());
  };
  return { collapsed, toggleCollapsed, mobileOpen, setMobileOpen };
}

export function SidebarToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const label = collapsed ? 'ขยายเมนู' : 'ยุบเมนู';
  return (
    <button type="button" className="icon-btn sidebar-collapse" aria-expanded={!collapsed} aria-label={label} data-tip={label} onClick={onToggle}>
      <Icon name="sidebar" />
    </button>
  );
}

/** While the sidebar is collapsed to icons, a bubble beside the icon under the pointer (or the keyboard's focus) names
    it, sliding and fading in and gliding from one icon to the next. It is drawn outside the sidebar (position: fixed),
    which clips anything that sticks out. The names are already in the links for screen readers, so the bubble is
    hidden from them. Markup: layout.css (sidebar-tip). */
export function SidebarTips() {
  const collapsed = useSyncExternalStore(subscribeSidebar, sidebarCollapsed, () => false);
  const bubble = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState({ text: '', shown: false });

  useEffect(() => {
    const sidebar = document.querySelector<HTMLElement>('.sidebar');
    if (!collapsed || !sidebar) return;
    let current: HTMLElement | null = null;
    const targetOf = (node: EventTarget | null) =>
      node instanceof Element ? node.closest<HTMLElement>('.nav-item, [data-tip], .workspace-select, .profile [aria-label]') : null;
    const show = (target: HTMLElement) => {
      const text = target.dataset.tip || target.getAttribute('aria-label') || target.textContent?.trim() || '';
      const box = bubble.current;
      if (!box || !text || target === current) return;
      const rect = target.getBoundingClientRect();
      // Set through the CSS object model: the page's CSP allows no inline style attributes.
      box.style.setProperty('top', `${Math.round(rect.top + rect.height / 2)}px`);
      box.style.setProperty('left', `${Math.round(rect.right + 12)}px`);
      current = target;
      setTip({ text, shown: true });
    };
    const hide = () => {
      current = null;
      setTip((t) => (t.shown ? { ...t, shown: false } : t));
    };
    const onOver = (event: PointerEvent) => {
      const target = targetOf(event.target);
      if (target && sidebar.contains(target)) show(target);
      else hide();
    };
    const onFocus = (event: FocusEvent) => {
      const target = targetOf(event.target);
      if (target && target.matches(':focus-visible')) show(target);
    };
    sidebar.addEventListener('pointerover', onOver);
    sidebar.addEventListener('pointerleave', hide);
    sidebar.addEventListener('focusin', onFocus);
    sidebar.addEventListener('focusout', hide);
    sidebar.addEventListener('scroll', hide, true);
    return () => {
      sidebar.removeEventListener('pointerover', onOver);
      sidebar.removeEventListener('pointerleave', hide);
      sidebar.removeEventListener('focusin', onFocus);
      sidebar.removeEventListener('focusout', hide);
      sidebar.removeEventListener('scroll', hide, true);
    };
  }, [collapsed]);

  return (
    <div ref={bubble} className={`sidebar-tip${collapsed && tip.shown ? ' shown' : ''}`} aria-hidden="true">
      {tip.text}
    </div>
  );
}

export function MobileToggle({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="icon-btn mobile-toggle" aria-label="เปิดเมนู" onClick={onClick}>
      <Icon name="menu" />
    </button>
  );
}

/** The avatar button in the top bar and its panel. Closes on a click outside, on Escape, on one of its items
    and on moving to another screen. */
export function ProfileMenu({ photo, label, head, children }: { photo: ReactNode; label: string; head?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useOpenOnThisPage();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!root.current?.contains(target) || target.closest('.menu-item')) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
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
    <div className="profile-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className="avatar-btn"
        aria-expanded={open}
        aria-controls="profile-menu"
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        {photo}
        <Icon name="down" />
      </button>
      <div className="profile-menu-panel" id="profile-menu" hidden={!open}>
        {head && <div className="profile-menu-head">{head}</div>}
        {children}
      </div>
    </div>
  );
}
