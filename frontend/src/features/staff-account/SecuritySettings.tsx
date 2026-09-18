'use client';

import { ActivityCard, PasskeysCard, PasswordCard, SessionsCard, TwoFactorCard, type DevicesApi, type SecurityState } from '@/features/account-security/cards';
import { useApi, useInvalidate } from '@/lib/query';
import { useBoot, useStaffSignedOut } from '@/lib/session';
import {
  STAFF_SECURITY_PATH,
  STAFF_SESSIONS_PATH,
  changeStaffPassword,
  revokeStaffSession,
  signOutStaffEverywhere,
  staffActivityPath,
  staffSecurityApi,
} from './api';

/* ตั้งค่าบัญชี → ความปลอดภัย of a staff account: the same cards as a customer's (features/account-security/cards.tsx)
   on the staff endpoints (backend auth and staff_security). A platform admin reaches every organization, so an
   account of theirs without a second factor or a passkey is flagged. */

export function SecuritySettings() {
  const state = useApi<SecurityState>(STAFF_SECURITY_PATH);
  const platformAdmin = Boolean(useBoot().data?.user?.platform_admin);
  const refresh = useInvalidate();
  const signedOut = useStaffSignedOut();
  const devices: DevicesApi = {
    sessionsPath: STAFF_SESSIONS_PATH,
    activityPath: staffActivityPath,
    revokeSession: revokeStaffSession,
    signOutEverywhere: signOutStaffEverywhere,
    signedOut: async (keptCurrent) => (keptCurrent ? refresh(STAFF_SESSIONS_PATH, STAFF_SECURITY_PATH) : signedOut()),
  };
  const unprotected = state.data && !state.data.two_factor.enabled && state.data.passkeys.length === 0;
  return (
    <div className="account-section">
      {unprotected && (
        <p className={`notice${platformAdmin ? ' warning' : ''}`} role="status">
          {platformAdmin
            ? 'บัญชีผู้ดูแลแพลตฟอร์มเข้าถึงทุกองค์กรได้ ควรเปิดการยืนยันสองขั้นตอนหรือเพิ่ม Passkey อย่างน้อยหนึ่งอย่าง'
            : 'บัญชีนี้ยังใช้รหัสผ่านอย่างเดียว เปิดการยืนยันสองขั้นตอนหรือเพิ่ม Passkey เพื่อป้องกันบัญชี'}
        </p>
      )}
      <PasswordCard
        form="staff-password"
        change={async (current, password) => {
          await changeStaffPassword({ current_password: current, password });
          // A new session (and CSRF token) replaced this one; the other devices are signed out.
          await refresh('/api/bootstrap', STAFF_SECURITY_PATH);
        }}
      />
      <TwoFactorCard state={state.data} api={staffSecurityApi} />
      <PasskeysCard passkeys={state.data?.passkeys ?? []} api={staffSecurityApi} />
      <SessionsCard api={devices} />
      <ActivityCard api={devices} description="การเข้าสู่ระบบ การเปลี่ยนรหัสผ่านและข้อมูลส่วนตัว และการเปลี่ยนการตั้งค่าความปลอดภัย" />
      <p className="small muted">
        ทำโทรศัพท์และรหัสสำรองหายทั้งคู่: ให้ผู้ดูแลเซิร์ฟเวอร์รีเซ็ตด้วยคำสั่ง <code>python -m backend.modules.staff_security reset &lt;อีเมล&gt;</code>
      </p>
    </div>
  );
}
