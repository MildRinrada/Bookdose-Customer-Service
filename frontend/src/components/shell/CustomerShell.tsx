'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/ui/display';
import { useToast } from '@/components/ui/Toast';
import { useCustomer, useCustomerLogout, useCustomerOverview, type CustomerOverview } from '@/lib/customer-session';
import { RealtimeProvider } from '@/lib/realtime-provider';
import { customerAccountPages, customerPageOf, customerServicePages, type CustomerPage } from '@/lib/routes';
import { useBoot } from '@/lib/session';
import { AnnouncementBar } from './AnnouncementBar';
import { Brand, MobileToggle, NavItem, ProfileMenu, SidebarToggle, useSidebar } from './chrome';
import { SessionGuard } from './SessionGuard';
import { TextSizeMenu } from './TextSize';

/* The customer's frame: the team's side menu and top bar, with the customer's own menu (overview, chats, cases,
   frequently asked questions; notifications and account settings). Every chat and case inside says which
   organization it is with. */

/** The team replied after the customer last opened the chat. */
export function customerUnread(c: { last_kind?: string | null; seen_at?: string | null; updated_at: string }): boolean {
  return c.last_kind === 'reply' && (!c.seen_at || c.seen_at < c.updated_at);
}

function menuCounts(d: CustomerOverview): Record<string, number> {
  return {
    chats: d.conversations.filter(customerUnread).length,
    cases: d.cases.filter((t) => !['resolved', 'closed'].includes(t.status)).length,
    alerts: d.alert_count,
  };
}

export function CustomerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const me = useCustomer();
  const overview = useCustomerOverview().data!;
  const home = useBoot().data?.home;
  const logout = useCustomerLogout();
  const toast = useToast();
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const page = customerPageOf(pathname);
  const counts = menuCounts(overview);

  useEffect(() => {
    document.title = `${page?.label ?? 'บัญชีลูกค้า'} · ${home?.name ?? 'Bookdose'}`;
  }, [page, home]);

  const nav = (p: CustomerPage) => (
    <NavItem key={p.key} href={p.href} label={p.label} icon={p.icon} active={page?.key === p.key} count={counts[p.key] ?? 0} />
  );
  const photo = <Avatar name={me.name} index={2} />;

  return (
    // Live updates of the customer's chats, cases and alerts in every organization.
    <RealtimeProvider kind="customer" identity={me.email}>
      <SessionGuard kind="customer" times={me} onLogout={() => logout()} />
      <div className={`mobile-overlay${mobileOpen ? ' visible' : ''}`} onClick={() => setMobileOpen(false)} />
      <aside className={`sidebar customer-sidebar${mobileOpen ? ' mobile-open' : ''}`}>
        <div className="sidebar-top">
          <Brand />
          <SidebarToggle collapsed={collapsed} onToggle={toggleCollapsed} />
        </div>
        <div className="nav-label">บริการของฉัน</div>
        <nav aria-label="เมนูลูกค้า">
          <div id="customer-nav">{customerServicePages.map(nav)}</div>
          <div className="nav-label nav-space">บัญชีของฉัน</div>
          <div id="customer-account-nav">{customerAccountPages.map(nav)}</div>
        </nav>
        <div className="sidebar-bottom">
          <div className="profile flex">
            {photo}
            <div className="grow">
              <strong className="truncate">{me.name}</strong>
              <div className="tiny muted truncate" title={me.email}>
                {me.email}
              </div>
            </div>
            <Link className="icon-btn" href="/customer/account" aria-label="ตั้งค่าบัญชี" title="ตั้งค่าบัญชี">
              <Icon name="settings" />
            </Link>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <AnnouncementBar announcement={me.announcement} />
        <header className="topbar">
          <div className="breadcrumb">
            <MobileToggle onClick={() => setMobileOpen((o) => !o)} />
            <Link className="crumb-root" href="/customer/chats">
              บัญชีลูกค้า
            </Link>
            <span aria-hidden="true">/</span>
            <b aria-current="page">{page?.label ?? 'แชทของฉัน'}</b>
          </div>
          <div className="top-actions">
            {/* The top bar's primary action is what to do next; on the new-chat page itself it only repeats the form. */}
            {pathname !== '/customer/chats/new' && (
              <Link className="btn primary customer-new-button" href="/customer/chats/new">
                <Icon name="plus" />
                เริ่มแชทใหม่
              </Link>
            )}
            <Link className="icon-btn bell customer-bell" href="/customer/alerts" aria-label="การแจ้งเตือน" title="การแจ้งเตือน">
              <Icon name="bell" />
              {counts.alerts > 0 && <span className="bell-count">{counts.alerts}</span>}
            </Link>
            <TextSizeMenu />
            <ProfileMenu
              photo={photo}
              label="เมนูบัญชี"
              head={
                <>
                  <strong className="truncate">{me.name}</strong>
                  <span className="muted truncate">{me.email}</span>
                </>
              }
            >
              <Link className="menu-item" href="/customer/account">
                <Icon name="settings" />
                ตั้งค่าบัญชี
              </Link>
              <button
                type="button"
                className="menu-item danger"
                onClick={() =>
                  void logout()
                    .then(() => toast('ออกจากระบบแล้ว'))
                    .catch((error: Error) => toast(error.message, true))
                }
              >
                <Icon name="logout" />
                ออกจากระบบ
              </button>
            </ProfileMenu>
          </div>
        </header>
        <main className="content" id="page">
          {children}
        </main>
      </div>
    </RealtimeProvider>
  );
}
