'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { OrganizationsSettings } from './OrganizationsSettings';
import { ProfileSettings } from './ProfileSettings';
import { SecuritySettings } from './SecuritySettings';
import { isStaffAccountTab, staffAccountTabPath, staffAccountTabs, type StaffAccountTab } from './tabs';

/* ตั้งค่าบัญชี of a staff account - a member of any role, or a platform admin (/account?tab=): laid out as a
   customer's (features/customer/AccountScreen.tsx), a menu of sections beside a column of cards. One account works
   in every organization it belongs to, so nothing here depends on the organization selected.
   Markup: pages/settings.css (.settings-nav), pages/account-settings.css. */

export function StaffAccountScreen({ tab }: { tab?: string }) {
  const current: StaffAccountTab = isStaffAccountTab(tab) ? tab : 'profile';
  const content = {
    profile: () => <ProfileSettings />,
    security: () => <SecuritySettings />,
    organizations: () => <OrganizationsSettings />,
  }[current]();
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>ตั้งค่าบัญชี</h1>
          <p>บัญชีเดียวใช้กับทุกองค์กรที่คุณเป็นทีมงาน ข้อมูลที่ทีมเห็น ความปลอดภัยของบัญชี และองค์กรของคุณ</p>
        </div>
      </div>
      <div className="settings-frame account-frame">
        <nav className="settings-nav" aria-label="หมวดการตั้งค่าบัญชี">
          {(Object.keys(staffAccountTabs) as StaffAccountTab[]).map((key) => {
            const meta = staffAccountTabs[key];
            const active = key === current;
            return (
              <Link
                key={key}
                href={staffAccountTabPath(key)}
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
