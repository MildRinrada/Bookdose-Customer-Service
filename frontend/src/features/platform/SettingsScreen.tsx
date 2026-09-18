'use client';

import { useEffect } from 'react';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { RegistrationSettingsPanel } from '@/features/auth/components/RegistrationSettingsPanel';
import type { RegistrationConfig } from '@/features/auth/types';
import { useApi } from '@/lib/query';
import { REGISTRATION_PATH } from './api';
import { SmsSettingsCard } from './components/SmsSettingsCard';

/* Platform console, ตั้งค่าระบบ: how the platform itself sends messages - the email (SMTP) that confirms organization
   sign-ups and invitations (#email), and the SMS provider for guests' chat links (#sms). Other pages link straight
   to either section. Markup: pages/platform.css (.platform-settings-section). */

export function SettingsScreen() {
  const registration = useApi<RegistrationConfig>(REGISTRATION_PATH);
  const ready = Boolean(registration.data);

  // /platform/settings#sms: the browser looked for the section before it was drawn, so scroll to it once it is.
  useEffect(() => {
    if (!ready || !window.location.hash) return;
    document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView({ block: 'start' });
  }, [ready]);

  if (registration.error && !registration.data) return <ErrorState error={registration.error} onRetry={() => void registration.refetch()} />;
  if (!registration.data) return <PageLoading />;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>ตั้งค่าระบบ</h1>
          <p>อีเมลและ SMS ที่ระบบใช้ส่งถึงทุกองค์กร · มีผลกับทุกองค์กรบนระบบนี้</p>
        </div>
      </div>
      <section id="email" className="platform-settings-section" aria-label="อีเมล (SMTP)">
        <RegistrationSettingsPanel config={registration.data} />
      </section>
      <section id="sms" className="platform-settings-section" aria-label="SMS">
        <SmsSettingsCard />
      </section>
    </>
  );
}
