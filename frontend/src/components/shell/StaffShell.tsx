'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { Avatar, EmptyState, ErrorState, InitialLoading, PageLoading, ProfilePhoto } from '@/components/ui/display';
import { useToast } from '@/components/ui/Toast';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { isDone } from '@/lib/format';
import { roleLabels } from '@/lib/labels';
import { RealtimeProvider } from '@/lib/realtime-provider';
import { isAccountPath, isPlatformPath, managePages, platformPages, staffPageOf, workspacePages, type StaffPage } from '@/lib/routes';
import { activeMembership, useBoot, useStaffAlerts, useStaffLogout, useStaffTickets, useSwitchTenant, useWorkspace } from '@/lib/session';
import { SessionGuard } from './SessionGuard';
import { Brand, MobileToggle, NavItem, ProfileMenu, SidebarToggle, useSidebar } from './chrome';
import { TextSizeMenu } from './TextSize';

/* The frame around every staff screen: sidebar (collapsible), top bar, organization switch and the account menu.
   It opens once the session, the workspace, the case list and the member's alerts are loaded, so the screens
   inside can use useWork(). It also keeps members out of screens their role does not include (they land on the
   overview, as before) and shows the platform console only to platform administrators. */

const SEARCH_SHORTCUT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';

export function StaffShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const boot = useBoot().data!;
  const user = boot.user!;
  const membership = activeMembership(boot);
  const workspace = useWorkspace();
  const tickets = useStaffTickets();
  const alerts = useStaffAlerts();
  const switchTenant = useSwitchTenant();
  const logout = useStaffLogout();
  const toast = useToast();
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const search = useRef<HTMLInputElement>(null);

  const work = workspace.data;
  const page = staffPageOf(pathname);
  const platform = isPlatformPath(pathname) && user.platform_admin;
  const allowed = isPlatformPath(pathname) ? user.platform_admin : !page?.roles || (work ? page.roles.includes(work.role) : true);

  // Platform mode swaps the organization switch, search and alerts for a banner: nothing there belongs to one organization.
  useEffect(() => {
    document.documentElement.classList.toggle('platform-mode', platform);
    return () => document.documentElement.classList.remove('platform-mode');
  }, [platform]);

  useEffect(() => {
    document.title = `${page?.label ?? 'Bookdose'} · Bookdose`;
  }, [page]);

  useEffect(() => {
    if (!allowed && (work || isPlatformPath(pathname))) router.replace('/dashboard');
  }, [allowed, work, pathname, router]);

  // A copied article link (/knowledge/<id>?tenant=<id>) while the selected organization is not usable: the knowledge
  // screen cannot open to switch, so the frame does it (then the address loses ?tenant, as in the knowledge screen).
  const tenantSwitched = useRef('');
  useEffect(() => {
    if (membership || !pathname.startsWith('/knowledge')) return;
    const tenant = new URLSearchParams(window.location.search).get('tenant') ?? '';
    if (!tenant || tenantSwitched.current === tenant || !boot.memberships.some((m) => m.id === tenant && m.status === 'active')) return;
    tenantSwitched.current = tenant;
    switchTenant(tenant, pathname).catch((error: Error) => toast(error.message, true));
  }, [membership, pathname, boot.memberships, switchTenant, toast]);

  // Ctrl+K / ⌘K jumps to case search (by key position, so it also works with a Thai keyboard layout).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.code === 'KeyK' && search.current && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        search.current.focus();
        search.current.select();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (membership && (workspace.isPending || tickets.isPending || alerts.isPending)) return <InitialLoading />;
  const failed = workspace.error ?? tickets.error ?? alerts.error;
  if (membership && failed)
    return (
      <ErrorState
        title="เปิดพื้นที่ทำงานไม่สำเร็จ"
        error={failed}
        onRetry={() => {
          void workspace.refetch();
          void tickets.refetch();
          void alerts.refetch();
        }}
      >
        <button type="button" className="btn" onClick={() => void logout()}>
          ออกจากระบบ
        </button>
      </ErrorState>
    );

  const openCases = (tickets.data?.tickets ?? []).filter((t) => !isDone(t)).length;
  const nav = (p: StaffPage) => (
    <NavItem key={p.key} href={p.href} label={p.label} icon={p.icon} active={page?.key === p.key} count={p.key === 'tickets' ? openCases : 0} />
  );
  const visible = (p: StaffPage) => !p.roles || (work ? p.roles.includes(work.role) : false);
  const workspaceNav = work ? workspacePages.filter(visible) : [];
  const manageNav = work ? managePages.filter(visible) : [];
  const crumb = platform ? { label: 'คอนโซลระบบกลาง', href: '/platform/system' } : { label: work?.tenant.name || 'พื้นที่ทำงาน', href: '/dashboard' };
  const photo = boot.avatar ? <ProfilePhoto src={boot.avatar} /> : <Avatar name={user.name} index={2} />;
  const roleLabel = work ? roleLabels[work.role] : 'ผู้ดูแลระบบกลาง';
  const activeMemberships = boot.memberships.filter((m) => m.status === 'active');

  let content: ReactNode = children;
  if (!allowed) content = <PageLoading />;
  else if (!work && !platform && !isAccountPath(pathname))
    content = (
      <EmptyState title="ไม่มีพื้นที่ทำงานที่ใช้งานอยู่" description="เลือกองค์กรอื่นจากเมนู หรือติดต่อผู้ดูแลองค์กรเพื่อเปิดใช้งานอีกครั้ง" icon="lock">
        {user.platform_admin && (
          <Link className="btn primary" href="/platform/system">
            ไปที่คอนโซลระบบกลาง
          </Link>
        )}
      </EmptyState>
    );

  return (
    // Live updates of the selected organization (inbox, cases, overview, bell); a new organization connects anew.
    <RealtimeProvider kind="staff" org={work?.tenant.slug} enabled={Boolean(work)} identity={`${user.id}|${work?.tenant.id ?? ''}`}>
      {/* Idle and absolute session limits (the platform console included): activity, the warning, expiry. */}
      <SessionGuard kind="staff" times={boot} onLogout={() => logout()} />
      <div className={`mobile-overlay${mobileOpen ? ' visible' : ''}`} onClick={() => setMobileOpen(false)} />
      <aside className={`sidebar${mobileOpen ? ' mobile-open' : ''}`}>
        <div className="sidebar-top">
          <Brand />
          <SidebarToggle collapsed={collapsed} onToggle={toggleCollapsed} />
        </div>
        <div className="workspace-select">
          <Avatar name={work?.tenant.name || 'B'} />
          <div className="grow">
            <select
              id="tenant-switch"
              aria-label="เลือกองค์กร"
              value={boot.tenant_id ?? ''}
              onChange={(e) => switchTenant(e.target.value).catch((error: Error) => toast(error.message, true))}
            >
              {activeMemberships.length ? (
                activeMemberships.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))
              ) : (
                <option value="">ไม่มีองค์กรที่ใช้งานอยู่</option>
              )}
            </select>
          </div>
        </div>
        {user.platform_admin && (
          <div className="platform-scope" role="note">
            <Icon name="globe" />
            <div className="grow">
              <strong>ทุกองค์กร</strong>
              <div className="tiny">โหมดผู้ดูแลแพลตฟอร์ม</div>
            </div>
          </div>
        )}
        <div className="nav-label nav-workspace">WORKSPACE</div>
        <nav className="nav-workspace">
          {workspaceNav.map(nav)}
          {manageNav.length > 0 && (
            <>
              <div className="nav-label nav-space" title="จัดการเฉพาะองค์กรที่เลือกอยู่">
                MANAGE
              </div>
              {manageNav.map(nav)}
            </>
          )}
          {user.platform_admin && (
            <>
              <div className="nav-label nav-space" title="ดูแลเซิร์ฟเวอร์และทุกองค์กร">
                PLATFORM
              </div>
              <NavItem href="/platform/system" label="คอนโซลระบบกลาง" icon="globe" active={false} />
            </>
          )}
        </nav>
        {user.platform_admin && (
          <nav className="nav-console" aria-label="คอนโซลระบบกลาง">
            <div className="nav-label">คอนโซลระบบกลาง</div>
            {platformPages.map(nav)}
            {work && (
              <>
                <div className="nav-label nav-space">พื้นที่ทำงาน</div>
                <Link className="nav-item" href="/dashboard" title={`กลับไปพื้นที่ทำงาน ${work.tenant.name}`}>
                  <Icon name="back" />
                  <span className="truncate">กลับไป {work.tenant.name}</span>
                </Link>
              </>
            )}
          </nav>
        )}
        <div className="sidebar-bottom">
          <div className="profile flex">
            {photo}
            <div className="grow">
              <strong className="truncate">{user.name}</strong>
              <div className="tiny muted">{roleLabel}</div>
            </div>
            <Link className="icon-btn" href="/account" aria-label="ตั้งค่าบัญชี" title="ตั้งค่าบัญชี">
              <Icon name="settings" />
            </Link>
          </div>
        </div>
      </aside>
      <div className="app-main">
        {work?.role === 'admin' && (work.support_pending ?? 0) > 0 && (
          <Link className="support-banner" href="/settings?tab=teams" role="status">
            <Icon name="shield" />
            <span>
              ทีมผู้ดูแลแพลตฟอร์มขอเข้าช่วยดูแล {work.tenant.name} {work.support_pending} คำขอ · ยังไม่มีใครเข้าได้จนกว่าคุณจะอนุมัติ
            </span>
            <Icon name="arrow" />
          </Link>
        )}
        {user.platform_admin && (
          <div className="platform-banner" role="status">
            <Icon name="shield" />
            <span>คุณกำลังอยู่ในโหมดผู้ดูแลแพลตฟอร์ม (System Level) · การเปลี่ยนแปลงในหน้านี้มีผลกับทุกองค์กร</span>
          </div>
        )}
        <header className="topbar">
          <div className="breadcrumb">
            <MobileToggle onClick={() => setMobileOpen((o) => !o)} />
            <Link className="crumb-root" href={crumb.href}>
              {crumb.label}
            </Link>
            <span aria-hidden="true">/</span>
            <b aria-current="page">{page?.label ?? 'เคสบริการ'}</b>
          </div>
          <div className="top-actions">
            {work && (
              <>
                <form
                  id="global-search"
                  className="global-search"
                  role="search"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const q = new FormData(e.currentTarget).get('q');
                    router.push(`/tickets?q=${encodeURIComponent(String(q ?? ''))}`);
                  }}
                >
                  <Icon name="search" />
                  <input ref={search} aria-label="ค้นหาเคสทั้งหมด" aria-keyshortcuts="Control+K Meta+K" name="q" placeholder="ค้นหาเคส ลูกค้า…" />
                  <span className="kbd" aria-hidden="true" title={`กด ${SEARCH_SHORTCUT} เพื่อค้นหาได้ทันที`}>
                    {SEARCH_SHORTCUT}
                  </span>
                </form>
                <span className="online" title="ระบบพร้อมใช้งาน">
                  Online
                </span>
                <NotificationBell />
              </>
            )}
            <TextSizeMenu />
            <ProfileMenu
              photo={photo}
              label="เมนูโปรไฟล์"
              head={
                <>
                  <strong className="truncate">{user.name}</strong>
                  <span className="muted">{roleLabel}</span>
                </>
              }
            >
              <Link className="menu-item" href="/account">
                <Icon name="settings" />
                ตั้งค่าบัญชี
              </Link>
              <button type="button" className="menu-item danger" onClick={() => void logout().catch((error: Error) => toast(error.message, true))}>
                <Icon name="logout" />
                ออกจากระบบ
              </button>
            </ProfileMenu>
          </div>
        </header>
        <main className="content" id="page">
          {content}
        </main>
      </div>
    </RealtimeProvider>
  );
}
