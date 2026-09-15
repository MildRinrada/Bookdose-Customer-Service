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
      <img className="brand-logo" src="/icon.svg" width={40} height={40} alt="" />
      <span className="brand-text">
        bookdose<small>CUSTOMER SERVICE</small>
      </span>
    </Link>
  );
}

export function NavItem({ href, label, icon, active, count = 0 }: { href: string; label: string; icon: string; active: boolean; count?: number }) {
  return (
    <Link href={href} className={`nav-item${active ? ' active' : ''}`} title={label} aria-current={active ? 'page' : undefined}>
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
    <button type="button" className="icon-btn sidebar-collapse" aria-expanded={!collapsed} aria-label={label} title={label} onClick={onToggle}>
      <Icon name="sidebar" />
    </button>
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
export function ProfileMenu({ photo, label, head, children }: { photo: ReactNode; label: string; head: ReactNode; children: ReactNode }) {
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
        <div className="profile-menu-head">{head}</div>
        {children}
      </div>
    </div>
  );
}
