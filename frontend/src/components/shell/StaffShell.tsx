'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { Avatar, EmptyState, ErrorState, InitialLoading, PageLoading, ProfilePhoto } from '@/components/ui/display';
import { useToast } from '@/components/ui/Toast';
import { AiAssistant } from '@/features/ai/components/AiAssistant';
import { HelpMenu } from '@/features/help/HelpMenu';
import { RecapPopup } from '@/features/achievements/components/RecapPopup';
import { Celebrations } from '@/features/staff-account/Celebrations';
import { Popups } from '@/components/ui/Popups';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { PlatformBell } from '@/features/platform/components/PlatformBell';
import { usePlatformAlerts } from '@/features/platform/usePlatformAlerts';
import { QuickSearch } from '@/features/search/QuickSearch';
import { StatusSwitch } from '@/features/staff-account/StatusSwitch';
import { useWorkAlerts } from '@/features/staff-account/useWorkAlerts';
import { isDone } from '@/lib/format';
import { roleLabels } from '@/lib/labels';
import { RealtimeProvider } from '@/lib/realtime-provider';
import { isAccountPath, isPlatformPath, managePages, platformPages, staffPageOf, workspacePages, type StaffPage } from '@/lib/routes';
import { AccountSwitcher } from '@/features/staff-account/AccountSwitcher';
import { activeMembership, useBoot, useStaffAlerts, useStaffLogout, useStaffTickets, useSwitchTenant, useWorkspace } from '@/lib/session';
import { AnnouncementBar } from './AnnouncementBar';
import { OrgSwitch } from './OrgSwitch';
import { SessionGuard } from './SessionGuard';
import { Brand, MobileToggle, NavItem, ProfileMenu, SidebarTips, SidebarToggle, useSidebar } from './chrome';
import { TextSizeMenu } from './TextSize';

/* The frame around every staff screen: sidebar (collapsible), top bar, organization switch and the account menu.
   It opens once the session, the workspace, the case list and the member's alerts are loaded, so the screens
   inside can use useWork(). It also keeps members out of screens their role does not include (they land on the
   overview, as before) and shows the platform console only to platform administrators.

   A platform administrator looks after the server, never an organization's work: every page they open is the
   console (the organization's screens send them to /platform/system), except an organization they were let into by
   support access, which they can only look at (work.read_only; the server refuses every change). */

const SEARCH_SHORTCUT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';

export function StaffShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const bootQuery = useBoot();
  const boot = bootQuery.data!;
  const user = boot.user!;
  // A platform admin without two-step sign-in or a passkey: the console stays shut, ตั้งค่าบัญชี opens to add one.
  const consoleLocked = Boolean(user.platform_admin && user.console_locked);
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
  const readOnly = Boolean(work?.read_only);
  // The member's own desktop notifications and sound (ตั้งค่าบัญชี → การแจ้งเตือน), while an organization is open.
  useWorkAlerts(user.id, Boolean(work) && !readOnly);
  // A platform admin's: the server or its security needing them now, wherever they are (also looking into an organization).
  usePlatformAlerts(Boolean(user.platform_admin) && !consoleLocked);
  const page = staffPageOf(pathname);
  // A platform admin looking into an organization on support access; anywhere else they are in the console.
  const supportView = user.platform_admin && Boolean(work) && !isPlatformPath(pathname) && !isAccountPath(pathname);
  const platform = user.platform_admin && !supportView;
  const allowed = isPlatformPath(pathname)
    ? user.platform_admin
    : user.platform_admin && !isAccountPath(pathname)
      ? Boolean(work)
      : !page?.roles || (work ? page.roles.includes(work.role) : true);

  // Platform mode swaps the organization switch, search and alerts for a banner: nothing there belongs to one organization.
  useEffect(() => {
    document.documentElement.classList.toggle('platform-mode', platform);
    return () => document.documentElement.classList.remove('platform-mode');
  }, [platform]);

  useEffect(() => {
    document.title = `${page?.label ?? 'Bookdose'} · Bookdose`;
  }, [page]);

  // The pinned top bar's height (--topbar-h), so what sticks below it (the settings menu) starts under it; it grows
  // when the bar wraps, and is 0 while hidden (the chat pages).
  const topbar = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = topbar.current;
    if (!bar) return;
    const root = document.documentElement;
    const measure = () => root.style.setProperty('--topbar-h', `${getComputedStyle(bar).position === 'sticky' ? bar.offsetHeight : 0}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    measure();
    return () => {
      observer.disconnect();
      root.style.removeProperty('--topbar-h');
    };
  });

  useEffect(() => {
    if (allowed) return;
    // A platform admin's home is the console; a member's is the overview of their organization.
    if (user.platform_admin) router.replace('/platform/system');
    else if (work || isPlatformPath(pathname)) router.replace('/dashboard');
  }, [allowed, work, pathname, router, user.platform_admin]);

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

  // Ctrl+K / ⌘K puts the cursor in ค้นหาด่วน (by key position, so it also works with a Thai keyboard layout).
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
  // The organization requires two-step sign-in and this account has none: only ตั้งค่าบัญชี opens, to add it.
  const needsTwoFactor = Boolean(membership) && failed?.reason === 'two_factor_required';
  if (membership && failed && !needsTwoFactor)
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
  // A screen opened from another one has no item of its own: the one it is opened from stays lit.
  const lit = page?.parent ?? page?.key;
  const nav = (p: StaffPage) => (
    <NavItem key={p.key} href={p.href} label={p.label} icon={p.icon} active={lit === p.key} count={p.key === 'tickets' ? openCases : 0} />
  );
  const visible = (p: StaffPage) => !p.roles || (work ? p.roles.includes(work.role) : false);
  const workspaceNav = work ? workspacePages.filter(visible) : [];
  const manageNav = work ? managePages.filter(visible) : [];
  const crumb = platform ? { label: 'คอนโซลระบบกลาง', href: '/platform/system' } : { label: work?.tenant.name || 'พื้นที่ทำงาน', href: '/dashboard' };
  const photo = boot.avatar ? <ProfilePhoto src={boot.avatar} /> : <Avatar name={user.name} index={2} />;
  const roleLabel = user.platform_admin ? 'ผู้ดูแลแพลตฟอร์ม' : work ? roleLabels[work.role] : 'ผู้ดูแลระบบกลาง';
  const activeMemberships = boot.memberships.filter((m) => m.status === 'active');

  const retry = () => {
    void workspace.refetch();
    void tickets.refetch();
    void alerts.refetch();
  };
  let content: ReactNode = children;
  if (!allowed) content = <PageLoading />;
  else if (consoleLocked && isAccountPath(pathname))
    content = (
      <>
        <div className="notice warning two-factor-gate-notice">
          <span className="grow">
            ผู้ดูแลแพลตฟอร์มต้องเปิดการยืนยันตัวตน 2 ขั้น หรือเพิ่ม Passkey ก่อนใช้คอนโซลระบบกลาง เปิดได้ในส่วน &ldquo;ความปลอดภัย&rdquo; ด้านล่าง
          </span>
          <button
            type="button"
            className="btn sm"
            onClick={async () => {
              const fresh = await bootQuery.refetch();
              if (fresh.data?.user?.console_locked) toast('ยังไม่พบการยืนยันตัวตน 2 ขั้นหรือ Passkey ในบัญชีนี้', true);
              else router.push('/platform/system');
            }}
          >
            ตั้งเสร็จแล้ว ไปที่คอนโซล
          </button>
        </div>
        {children}
      </>
    );
  else if (consoleLocked && isPlatformPath(pathname))
    content = (
      <EmptyState
        title="เปิดการยืนยันตัวตน 2 ขั้นก่อนใช้คอนโซลระบบกลาง"
        description="บัญชีผู้ดูแลแพลตฟอร์มเข้าถึงทุกองค์กรได้ จึงต้องมีรหัสยืนยันจากแอปในโทรศัพท์หรือ Passkey นอกจากรหัสผ่าน ตั้งเสร็จแล้วกลับมาใช้คอนโซลได้ทันที"
        icon="lock"
      >
        <Link className="btn primary" href="/account?tab=security">
          ไปตั้งค่าความปลอดภัย
        </Link>
        <button type="button" className="btn" onClick={() => void bootQuery.refetch()}>
          ตั้งเสร็จแล้ว ลองอีกครั้ง
        </button>
      </EmptyState>
    );
  else if (needsTwoFactor && isAccountPath(pathname))
    content = (
      <>
        <div className="notice warning two-factor-gate-notice">
          <span className="grow">{failed?.message} · เปิดได้ในส่วน &ldquo;ความปลอดภัย&rdquo; ด้านล่าง แล้วกลับไปทำงานต่อได้ทันที</span>
          <button type="button" className="btn sm" onClick={retry}>
            ตั้งเสร็จแล้ว กลับไปทำงาน
          </button>
        </div>
        {children}
      </>
    );
  else if (needsTwoFactor)
    content = (
      <EmptyState title="เปิดการยืนยันตัวตน 2 ขั้นก่อนเข้าใช้งาน" description={failed?.message ?? ''} icon="lock">
        <Link className="btn primary" href="/account?tab=security">
          ไปตั้งค่าความปลอดภัย
        </Link>
        <button type="button" className="btn" onClick={retry}>
          ตั้งเสร็จแล้ว ลองอีกครั้ง
        </button>
      </EmptyState>
    );
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
        <OrgSwitch memberships={activeMemberships} current={boot.tenant_id ?? null} onSwitch={(id) => switchTenant(id)} />
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
                <div className="nav-label nav-space">สิทธิ์เข้าช่วยเหลือ</div>
                <Link className="nav-item" href="/dashboard" title={`ดู ${work.tenant.name} แบบอ่านอย่างเดียว`}>
                  <Icon name="shield" />
                  <span className="truncate">ดู {work.tenant.name} (อ่านอย่างเดียว)</span>
                </Link>
              </>
            )}
          </nav>
        )}
        {/* Who is signed in, and the account settings, are in the profile menu at the top right. */}
      </aside>
      <SidebarTips />
      {/* ผู้ช่วย AI: for the organization's own team, not the console or a look in on support access. */}
      {work && !readOnly && !platform && <AiAssistant />}
      {work && !readOnly && !platform && <Celebrations userId={user.id} />}
      {((work && !readOnly) || user.platform_admin) && <Popups />}
      {/* Last month's summary, once, the first time the member opens the app in a new month. */}
      {work && !readOnly && !platform && <RecapPopup />}
      <div className="app-main">
        <AnnouncementBar announcement={boot.announcement} />
        {work?.role === 'admin' && (work.support_pending ?? 0) > 0 && (
          <Link className="support-banner" href="/settings?tab=teams" role="status">
            <Icon name="shield" />
            <span>
              ทีมผู้ดูแลแพลตฟอร์มขอเข้าช่วยดูแล {work.tenant.name} {work.support_pending} คำขอ · ยังไม่มีใครเข้าได้จนกว่าคุณจะอนุมัติ
            </span>
            <Icon name="arrow" />
          </Link>
        )}
        {supportView && (
          <div className="support-view-banner" role="status">
            <Icon name="shield" />
            <span>
              คุณกำลังดู {work?.tenant.name} ด้วยสิทธิ์เข้าช่วยเหลือ แบบอ่านอย่างเดียว · ผู้ดูแลแพลตฟอร์มไม่ตอบลูกค้า ไม่รับเคส และไม่แก้ไขข้อมูลขององค์กร
            </span>
            <Link className="btn sm" href="/platform/system">
              กลับคอนโซลระบบกลาง
            </Link>
          </div>
        )}
        {user.platform_admin && <PlatformBanner />}
        <header className="topbar" ref={topbar}>
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
                <QuickSearch inputRef={search} role={work.role} platformAdmin={Boolean(user.platform_admin)} shortcut={SEARCH_SHORTCUT} />
                {!readOnly && <StatusSwitch />}
                <NotificationBell />
              </>
            )}
            {platform && !consoleLocked && <PlatformBell />}
            {/* Switched per organization in the platform console (platform/model.py FEATURES). */}
            {work && work.features?.help_menu !== false && <HelpMenu />}
            <TextSizeMenu />
            <ProfileMenu photo={photo} label="เมนูโปรไฟล์และสลับบัญชี">
              <AccountSwitcher roleLabel={roleLabel} onLogout={() => logout()} />
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

// The platform-mode banner can be closed for the rest of the browser session (sessionStorage; in memory when the
// browser refuses storage). The server has no session storage, so the banner starts hidden and appears after hydration.
const BANNER_KEY = 'bookdose.platform-banner';
const bannerListeners = new Set<() => void>();
let bannerClosedHere = false;
const subscribeBanner = (listener: () => void) => {
  bannerListeners.add(listener);
  return () => void bannerListeners.delete(listener);
};
const bannerHidden = () => {
  if (bannerClosedHere) return true;
  try {
    return sessionStorage.getItem(BANNER_KEY) === 'hidden';
  } catch {
    return false;
  }
};
const hideBanner = () => {
  bannerClosedHere = true;
  try {
    sessionStorage.setItem(BANNER_KEY, 'hidden');
  } catch {
    /* Hidden for this page only. */
  }
  bannerListeners.forEach((listener) => listener());
};

function PlatformBanner() {
  const hidden = useSyncExternalStore(subscribeBanner, bannerHidden, () => true);
  if (hidden) return null;
  return (
    <div className="platform-banner" role="status">
      <Icon name="shield" />
      <span>โหมดผู้ดูแลแพลตฟอร์ม · การเปลี่ยนแปลงมีผลกับทุกองค์กร</span>
      <button type="button" className="platform-banner-close" aria-label="ซ่อนแถบโหมดผู้ดูแลแพลตฟอร์ม" title="ซ่อนจนกว่าจะปิดเบราว์เซอร์" onClick={hideBanner}>
        <Icon name="close" />
      </button>
    </div>
  );
}
