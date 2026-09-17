'use client';

import { ErrorState, PageLoading } from '@/components/ui/display';
import { api } from '@/lib/api/client';
import { useApi } from '@/lib/query';
import { useBoot } from '@/lib/session';
import type { PasskeyAnswer, PasskeyCreateOptions } from '@/features/auth/passkeys';
import { PasskeysCard, TwoFactorCard, type Passkey, type RecoveryCodes, type SecurityApi, type SecurityState, type TotpSetup } from './cards';

/* ความปลอดภัยของบัญชี (/account/security): two-factor sign-in and passkeys of a staff account - a member of an
   organization or a platform admin (backend staff_security). The same cards as a customer's account; the password
   stays in จัดการบัญชี. */

export const STAFF_SECURITY_PATH = '/api/account/security';
const PASSKEYS = `${STAFF_SECURITY_PATH}/passkeys`;

export const staffSecurityApi: SecurityApi = {
  path: STAFF_SECURITY_PATH,
  startTotp: (password) => api<TotpSetup>(`${STAFF_SECURITY_PATH}/totp/setup`, { password }),
  confirmTotp: (code) => api<RecoveryCodes>(`${STAFF_SECURITY_PATH}/totp/confirm`, { code }),
  disableTotp: (body) => api<{ ok: true }>(`${STAFF_SECURITY_PATH}/totp/disable`, body),
  newRecoveryCodes: (password) => api<RecoveryCodes>(`${STAFF_SECURITY_PATH}/recovery-codes`, { password }),
  passkeyOptions: (password) => api<PasskeyCreateOptions>(`${PASSKEYS}/options`, { password }),
  addPasskey: (name: string, credential: PasskeyAnswer) => api<{ passkeys: Passkey[] }>(PASSKEYS, { name, credential }),
  renamePasskey: (id, name) => api<{ passkeys: Passkey[] }>(`${PASSKEYS}/${id}`, { name }),
  removePasskey: (id, password) => api<{ passkeys: Passkey[] }>(`${PASSKEYS}/${id}/remove`, { password }),
};

export function StaffSecurityScreen() {
  const state = useApi<SecurityState>(STAFF_SECURITY_PATH);
  const platformAdmin = Boolean(useBoot().data?.user?.platform_admin);
  if (state.error && !state.data) return <ErrorState error={state.error} onRetry={() => void state.refetch()} />;
  if (!state.data) return <PageLoading />;
  const protectedAccount = state.data.two_factor.enabled || state.data.passkeys.length > 0;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>ความปลอดภัยของบัญชี</h1>
          <p>เพิ่มการยืนยันสองขั้นตอนหรือ Passkey ให้บัญชีนี้ รหัสผ่านที่หลุดไปอย่างเดียวจะเข้าบัญชีไม่ได้</p>
        </div>
      </div>
      {!protectedAccount && (
        <p className={`notice${platformAdmin ? ' warning' : ''}`} role="status">
          {platformAdmin
            ? 'บัญชีผู้ดูแลแพลตฟอร์มเข้าถึงทุกองค์กรได้ ควรเปิดการยืนยันสองขั้นตอนหรือเพิ่ม Passkey อย่างน้อยหนึ่งอย่าง'
            : 'บัญชีนี้ยังใช้รหัสผ่านอย่างเดียว เปิดการยืนยันสองขั้นตอนหรือเพิ่ม Passkey เพื่อป้องกันบัญชี'}
        </p>
      )}
      <div className="account-section">
        <TwoFactorCard state={state.data} api={staffSecurityApi} />
        <PasskeysCard passkeys={state.data.passkeys} api={staffSecurityApi} />
      </div>
      <p className="small muted">
        ทำโทรศัพท์และรหัสสำรองหายทั้งคู่: ให้ผู้ดูแลเซิร์ฟเวอร์รีเซ็ตด้วยคำสั่ง <code>python -m backend.modules.staff_security reset &lt;อีเมล&gt;</code>
      </p>
    </>
  );
}
