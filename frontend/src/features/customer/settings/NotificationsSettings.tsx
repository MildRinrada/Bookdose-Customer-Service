'use client';

import { NotifySettingsCard } from '../components/NotifySettings';

/* ตั้งค่าบัญชี → การแจ้งเตือน: which events go by email or LINE, and linking LINE per organization.
   Markup: pages/alerts-customer.css. */

export function NotificationsSettings() {
  return (
    <div className="account-section">
      <NotifySettingsCard />
    </div>
  );
}
