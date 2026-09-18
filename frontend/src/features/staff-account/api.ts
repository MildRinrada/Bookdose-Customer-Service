import { api } from '@/lib/api/client';
import type { PasskeyAnswer, PasskeyCreateOptions } from '@/features/auth/passkeys';
import type { AccountSession, Passkey, RecoveryCodes, SecurityApi, TotpSetup } from '@/features/account-security/cards';

/* Endpoints of a staff account's own settings (ตั้งค่าบัญชี at /account): the profile and password (backend auth),
   two-factor sign-in, passkeys, the devices signed in and the history (backend staff_security). */

export const STAFF_SECURITY_PATH = '/api/account/security';
const PASSKEYS = `${STAFF_SECURITY_PATH}/passkeys`;
export const STAFF_SESSIONS_PATH = `${STAFF_SECURITY_PATH}/sessions`;
export const staffActivityPath = (page: number) => `${STAFF_SECURITY_PATH}/activity?page=${page}`;

export const saveStaffProfile = (body: { name: string; avatar: string }) => api<{ ok: true }>('/api/account/profile', body);
/** The answer carries a new session cookie; the page then reads /api/bootstrap again for its new CSRF token. */
export const changeStaffPassword = (body: { current_password: string; password: string }) => api<{ ok: true }>('/api/account/password', body);

export const revokeStaffSession = (id: string) => api<{ sessions: AccountSession[] }>(`${STAFF_SESSIONS_PATH}/${id}`, undefined, 'DELETE');
export const signOutStaffEverywhere = (keepCurrent: boolean) =>
  api<{ ok: true; kept_current: boolean }>(`${STAFF_SESSIONS_PATH}/sign-out-all`, { keep_current: keepCurrent });

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
