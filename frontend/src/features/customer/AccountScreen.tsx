'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { Icon } from '@/components/Icon';
import { usePinnedMenu } from '@/components/ui/usePinnedMenu';
import { NotificationsSettings } from './settings/NotificationsSettings';
import { OrganizationsSettings } from './settings/OrganizationsSettings';
import { ProfileSettings } from './settings/ProfileSettings';
import { SecuritySettings } from './settings/SecuritySettings';
import { accountTabPath, accountTabs, isAccountTab, type AccountTab } from './settings/tabs';

/* ตั้งค่าบัญชี: one account for every organization, in sections (?tab=): the details teams use to reach the
   customer, security, the organizations the customer can contact, and notifications (email and LINE). Each section is its own component in ./settings/. Markup: pages/settings.css (.settings-nav), pages/account-settings.css. */

export function AccountScreen({ tab }: { tab?: string }) {
  const current: AccountTab = isAccountTab(tab) ? tab : 'profile';
  const content = {
    profile: () => <ProfileSettings />,
    security: () => <SecuritySettings />,
    organizations: () => <OrganizationsSettings />,
    notifications: () => <NotificationsSettings />,
  }[current]();
  const nav = useRef<HTMLElement>(null);
  usePinnedMenu(nav);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>ตั้งค่าบัญชี</h1>
          <p>บัญชีเดียวใช้กับทุกองค์กร ข้อมูลที่ทีมงานใช้ติดต่อคุณ องค์กรที่ติดต่อได้ และความปลอดภัยของบัญชี</p>
        </div>
      </div>
      <div className="settings-frame account-frame">
        <nav ref={nav} className="settings-nav" aria-label="หมวดการตั้งค่าบัญชี">
          {(Object.keys(accountTabs) as AccountTab[]).map((key) => {
            const meta = accountTabs[key];
            const active = key === current;
            return (
              <Link
                key={key}
                href={accountTabPath(key)}
                className={`settings-nav-item${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
                data-tab={key}
                replace
                scroll={false}
              >
                <span className="settings-nav-icon">
                  <Icon name={meta.icon} />
                </span>
                <span className="settings-nav-text">
                  <strong>{meta.label}</strong>
                  <span className="settings-nav-hint">{meta.hint}</span>
                </span>
              </Link>
            );
          })}
        </nav>
        <div className="settings-panels account-panel" data-tab={current}>
          {content}
        </div>
      </div>
    </>
  );
}
