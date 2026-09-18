'use client';

import { ActivityCard, PasskeysCard, PasswordCard, SessionsCard, TwoFactorCard, type DevicesApi, type SecurityState } from '@/features/account-security/cards';
import { useApi, useInvalidate } from '@/lib/query';
import { changePassword } from '../api';
import { SECURITY_PATH, SESSIONS_PATH, activityPath, customerSecurityApi, revokeSession, signOutEverywhere } from './security';

/* ตั้งค่าบัญชี → ความปลอดภัย: the password, two-factor sign-in with an authenticator app and recovery codes,
   passkeys, the browsers signed in to the account, and its history (backend customer_security). The cards are
   shared with a staff account's settings (features/account-security/cards.tsx). Markup: pages/security.css. */

export function SecuritySettings() {
  const state = useApi<SecurityState>(SECURITY_PATH);
  const refresh = useInvalidate();
  const devices: DevicesApi = {
    sessionsPath: SESSIONS_PATH,
    activityPath,
    revokeSession,
    signOutEverywhere,
    signedOut: () => refresh('/api/customer'),
  };
  return (
    <div className="account-section">
      <PasswordCard form="customer-password" change={(current, password) => changePassword({ current_password: current, password })} />
      <TwoFactorCard state={state.data} api={customerSecurityApi} />
      <PasskeysCard passkeys={state.data?.passkeys ?? []} api={customerSecurityApi} />
      <SessionsCard api={devices} />
      <ActivityCard api={devices} description="การเข้าสู่ระบบ การเปลี่ยนการตั้งค่าความปลอดภัย และเอกสารที่คุณลงนามหรืออนุมัติ" />
    </div>
  );
}
