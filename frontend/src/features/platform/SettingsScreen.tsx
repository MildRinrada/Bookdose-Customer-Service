'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Icon } from '@/components/Icon';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { RegistrationSettingsPanel } from '@/features/auth/components/RegistrationSettingsPanel';
import type { RegistrationConfig } from '@/features/auth/types';
import { useApi } from '@/lib/query';
import { REGISTRATION_PATH } from './api';
import { SmsSettingsCard } from './components/SmsSettingsCard';
import { TurnstileSettingsCard } from './components/TurnstileSettingsCard';

/* Platform console, ตั้งค่าระบบ: how the platform itself sends messages - the email (SMTP) that confirms organization
   sign-ups and invitations (#email), the SMS provider for guests' chat links (#sms) - and the bot check on the public
   support form (#turnstile). Other pages link straight to any section. Markup: pages/platform.css
   (.platform-settings-section). */

export function SettingsScreen() {
  const registration = useApi<RegistrationConfig>(REGISTRATION_PATH);
  const ready = Boolean(registration.data);

  // /platform/settings#turnstile: the browser looked for the section before it was drawn, so scroll to it once it is.
  // The SMS and Turnstile cards load their own settings after that and grow, which pushed the section back down (the
  // page opened on SMS): it is kept in place while the sections settle, until the admin scrolls, or for a few seconds.
  useEffect(() => {
    if (!ready || !window.location.hash) return;
    const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
    if (!target) return;
    const align = () => target.scrollIntoView({ block: 'start' });
    align();
    const observer = new ResizeObserver(align);
    document.querySelectorAll('.platform-settings-section').forEach((section) => observer.observe(section));
    const stop = () => {
      observer.disconnect();
      window.clearTimeout(timer);
      for (const kind of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.removeEventListener(kind, stop);
    };
    const timer = window.setTimeout(stop, 4000);
    for (const kind of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.addEventListener(kind, stop, { passive: true });
    return stop;
  }, [ready]);

  if (registration.error && !registration.data) return <ErrorState error={registration.error} onRetry={() => void registration.refetch()} />;
  if (!registration.data) return <PageLoading />;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>ตั้งค่าระบบ</h1>
          <p>อีเมล SMS และการตรวจบอทที่ระบบใช้ · มีผลกับทุกองค์กรบนระบบนี้</p>
        </div>
        <div className="flex">
          <Link className="btn" href="/platform/team">
            <Icon name="shield" />
            ทีมผู้ดูแลระบบ
          </Link>
          <Link className="btn" href="/platform/security">
            <Icon name="lock" />
            ความปลอดภัย
          </Link>
        </div>
      </div>
      <section id="email" className="platform-settings-section" aria-label="อีเมล (SMTP)">
        <RegistrationSettingsPanel config={registration.data} />
      </section>
      <section id="sms" className="platform-settings-section" aria-label="SMS">
        <SmsSettingsCard />
      </section>
      <section id="turnstile" className="platform-settings-section" aria-label="ตรวจบอทหน้าติดต่อ">
        <TurnstileSettingsCard />
      </section>
    </>
  );
}
