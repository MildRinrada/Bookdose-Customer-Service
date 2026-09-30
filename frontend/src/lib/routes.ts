import type { Role } from './types';

/* Every screen's address. Links are real paths (/tickets/<id>), so Back, reload and shared links work without the
   #hash addresses of the old frontend. Old links (emails already sent, bookmarks) still arrive at / and are turned
   into these paths by legacyPath(). */

export type StaffPage = {
  key: string;
  href: string;
  label: string;
  icon: string;
  /** Who sees it in the menu and may open it; empty means every member. */
  roles?: Role[];
};

/** The organization's screens, in menu order. */
export const workspacePages: StaffPage[] = [
  { key: 'dashboard', href: '/dashboard', label: 'ภาพรวม', icon: 'dashboard' },
  { key: 'inbox', href: '/inbox', label: 'กล่องข้อความ', icon: 'inbox' },
  { key: 'tickets', href: '/tickets', label: 'เคสบริการ', icon: 'ticket' },
  { key: 'contacts', href: '/contacts', label: 'ข้อมูลลูกค้า', icon: 'users' },
  { key: 'knowledge', href: '/knowledge', label: 'คลังความรู้', icon: 'book' },
  { key: 'reports', href: '/reports', label: 'รายงาน', icon: 'chart' },
];

export const managePages: StaffPage[] = [
  { key: 'members', href: '/members', label: 'ทีมและสมาชิก', icon: 'users', roles: ['admin'] },
  { key: 'settings', href: '/settings', label: 'ตั้งค่าองค์กร', icon: 'settings', roles: ['admin'] },
];

/** Screens opened from ตั้งค่าองค์กร (its menu lists them under its own sections), which stays lit in the side menu
    while one of them is open. */
export const settingsPages: StaffPage[] = [
  { key: 'automation', href: '/automation', label: 'ระบบอัตโนมัติ', icon: 'macro', roles: ['admin'] },
  { key: 'audit', href: '/audit', label: 'ประวัติการทำงาน', icon: 'shield', roles: ['admin'] },
  { key: 'trash', href: '/trash', label: 'ถังขยะ', icon: 'trash', roles: ['admin'] },
];

/** Screens outside the menu. The guides open from the ? in the top bar (features/help/HelpMenu). */
export const otherStaffPages: StaffPage[] = [
  ...settingsPages,
  { key: 'guides', href: '/guides', label: 'คู่มือจาก Bookdose', icon: 'list' },
  { key: 'notifications', href: '/notifications', label: 'การแจ้งเตือน', icon: 'bell' },
  { key: 'account', href: '/account', label: 'ตั้งค่าบัญชี', icon: 'settings' },
];

/** Screens of the signed-in account itself: they open without a selected organization too. */
export const isAccountPath = (pathname: string) => pathname === '/account' || pathname.startsWith('/account/');

/** The platform console (platform administrators only): nothing on these screens belongs to one organization. */
export const platformPages: StaffPage[] = [
  { key: 'system', href: '/platform/system', label: 'ภาพรวมระบบ', icon: 'chart' },
  { key: 'platform', href: '/platform/organizations', label: 'จัดการองค์กร', icon: 'globe' },
  { key: 'platform-org-health', href: '/platform/org-health', label: 'สุขภาพองค์กร', icon: 'thumbUp' },
  { key: 'platform-accounts', href: '/platform/accounts', label: 'บัญชีผู้ใช้', icon: 'users' },
  { key: 'global-faq', href: '/platform/faq', label: 'FAQ กลาง', icon: 'book' },
  { key: 'platform-templates', href: '/platform/templates', label: 'คลังบทความแม่แบบ', icon: 'copy' },
  { key: 'platform-announcements', href: '/platform/announcements', label: 'ประกาศ', icon: 'bolt' },
  { key: 'platform-reports', href: '/platform/reports', label: 'รายงานปัญหา', icon: 'help' },
  { key: 'platform-pdpa', href: '/platform/pdpa', label: 'เครื่องมือ PDPA', icon: 'users' },
  { key: 'platform-team', href: '/platform/team', label: 'ทีมผู้ดูแลระบบ', icon: 'shield' },
  { key: 'platform-security', href: '/platform/security', label: 'ความปลอดภัย', icon: 'lock' },
  { key: 'platform-settings', href: '/platform/settings', label: 'ตั้งค่าระบบ', icon: 'settings' },
];

const staffPages = [...workspacePages, ...managePages, ...otherStaffPages, ...platformPages];

/** The staff screen an address belongs to (for the menu highlight and the breadcrumb). */
export function staffPageOf(pathname: string): StaffPage | undefined {
  return staffPages
    .filter((page) => pathname === page.href || pathname.startsWith(page.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

export const isPlatformPath = (pathname: string) => pathname === '/platform' || pathname.startsWith('/platform/');

export type CustomerPage = { key: string; href: string; label: string; icon: string };

/** The customer's screens, in menu order: services first, then the account. */
export const customerServicePages: CustomerPage[] = [
  { key: 'dashboard', href: '/customer/dashboard', label: 'ภาพรวม', icon: 'chart' },
  { key: 'chats', href: '/customer/chats', label: 'แชทของฉัน', icon: 'chat' },
  { key: 'cases', href: '/customer/cases', label: 'เคสของฉัน', icon: 'ticket' },
  { key: 'faq', href: '/customer/faq', label: 'คำถามที่พบบ่อย', icon: 'book' },
];

export const customerAccountPages: CustomerPage[] = [
  { key: 'alerts', href: '/customer/alerts', label: 'การแจ้งเตือน', icon: 'bell' },
  { key: 'account', href: '/customer/account', label: 'ตั้งค่าบัญชี', icon: 'settings' },
];

export function customerPageOf(pathname: string): CustomerPage | undefined {
  return [...customerServicePages, ...customerAccountPages].find((page) => pathname === page.href || pathname.startsWith(page.href + '/'));
}

/** Links to the customer side for an organization: the main page, naming the organization when it is not the
    platform's own (?org=<code> connects the organization once the customer signs in). */
export function customerHomeUrl(slug: string, homeSlug: string | null | undefined): string {
  return `${window.location.origin}/${homeSlug === slug ? '' : `?org=${encodeURIComponent(slug)}`}`;
}

export const ORG_CODE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const legacyStaff: Record<string, string> = {
  dashboard: '/dashboard',
  inbox: '/inbox',
  tickets: '/tickets',
  contacts: '/contacts',
  knowledge: '/knowledge',
  reports: '/reports',
  automation: '/automation',
  members: '/members',
  settings: '/settings',
  audit: '/audit',
  trash: '/trash',
  notifications: '/notifications',
  guides: '/guides',
  system: '/platform/system',
  platform: '/platform/organizations',
  'global-faq': '/platform/faq',
  'platform-templates': '/platform/templates',
  'platform-org-health': '/platform/org-health',
  'platform-announcements': '/platform/announcements',
  'platform-reports': '/platform/reports',
  'platform-pdpa': '/platform/pdpa',
  'platform-accounts': '/platform/accounts',
  'platform-team': '/platform/team',
  'platform-security': '/platform/security',
  'platform-settings': '/platform/settings',
  'verify-email': '/verify-email',
  'check-email': '/check-email',
  'resend-email': '/resend-email',
  register: '/register',
  login: '/login',
  forgot: '/customer/forgot',
};

const legacyCustomer = new Set(['dashboard', 'chats', 'cases', 'faq', 'alerts', 'account']);

/** The path for an address of the old frontend: "#tickets/<id>", "#chats/<org>/<id>", "#verify-email?token=…",
    "#verify=<token>", "#signup" … `search` is the page's own query (?org=…), kept on the new address.
    null when the hash names nothing known. */
export function legacyPath(hash: string, search = ''): string | null {
  const fragment = hash.replace(/^#/, '');
  if (!fragment) return null;
  const keep = new URLSearchParams(search);
  const withQuery = (path: string, extra?: URLSearchParams) => {
    const query = new URLSearchParams(keep);
    extra?.forEach((value, key) => query.set(key, value));
    const text = query.toString();
    return text ? `${path}?${text}` : path;
  };
  // Links from customer emails: #verify=<token>, #reset=<token>
  const token = /^(verify|reset)=([\w-]+)$/.exec(fragment);
  if (token) return withQuery(`/customer/${token[1]}`, new URLSearchParams({ token: token[2] }));
  if (fragment === 'signup') return withQuery('/login', new URLSearchParams({ tab: 'signup' }));
  const [path, query = ''] = fragment.split('?');
  const [page, ...rest] = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  const tail = rest.map(encodeURIComponent).join('/');
  if (legacyCustomer.has(page)) return withQuery(`/customer/${page}${tail ? `/${tail}` : ''}`, params);
  if (legacyStaff[page]) return withQuery(`${legacyStaff[page]}${tail ? `/${tail}` : ''}`, params);
  return null;
}
