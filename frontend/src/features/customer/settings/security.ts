import { api } from '@/lib/api/client';
import type { PasskeyAnswer, PasskeyCreateOptions } from '@/features/auth/passkeys';
import type { AccountSession, Passkey, RecoveryCodes, SecurityApi, TotpSetup } from '@/features/account-security/cards';

export type { ActivityItem, ActivityPage, Passkey, RecoveryCodes, SecurityState, TotpSetup } from '@/features/account-security/cards';

/* Endpoints and shapes of ตั้งค่าบัญชี → ความปลอดภัย (backend/modules/customer_security). Kept beside its own
   screen rather than in features/customer/api.ts, so each section of the account settings stays self-contained.
   Field names are the server's. */

export const SECURITY_PATH = '/api/customer/security';
export const PASSKEYS_PATH = `${SECURITY_PATH}/passkeys`;
export const SESSIONS_PATH = `${SECURITY_PATH}/sessions`;
export const activityPath = (page: number) => `${SECURITY_PATH}/activity?page=${page}`;

/** GET .../sessions: one row per browser signed in to this account. */
export type CustomerSession = AccountSession;

/** Turning the second step on, and adding a passkey, cost the account's password: both add a way into the account. */
export const startTotp = (password: string) => api<TotpSetup>(`${SECURITY_PATH}/totp/setup`, { password });
export const confirmTotp = (code: string) => api<RecoveryCodes>(`${SECURITY_PATH}/totp/confirm`, { code });
export const disableTotp = (body: { password: string; code?: string; recovery_code?: string }) =>
  api<{ ok: true }>(`${SECURITY_PATH}/totp/disable`, body);
export const newRecoveryCodes = (password: string) => api<RecoveryCodes>(`${SECURITY_PATH}/recovery-codes`, { password });

export const passkeyOptions = (password: string) => api<PasskeyCreateOptions>(`${PASSKEYS_PATH}/options`, { password });
export const addPasskey = (name: string, credential: PasskeyAnswer) => api<{ passkeys: Passkey[] }>(PASSKEYS_PATH, { name, credential });
export const renamePasskey = (id: string, name: string) => api<{ passkeys: Passkey[] }>(`${PASSKEYS_PATH}/${id}`, { name });
export const removePasskey = (id: string, password: string) => api<{ passkeys: Passkey[] }>(`${PASSKEYS_PATH}/${id}/remove`, { password });

export const revokeSession = (id: string) => api<{ sessions: CustomerSession[] }>(`${SESSIONS_PATH}/${id}`, undefined, 'DELETE');
export const signOutEverywhere = (keepCurrent: boolean) =>
  api<{ ok: true; kept_current: boolean }>(`${SESSIONS_PATH}/sign-out-all`, { keep_current: keepCurrent });

/** The customer's endpoints for the shared two-factor and passkey cards. */
export const customerSecurityApi: SecurityApi = {
  path: SECURITY_PATH,
  startTotp,
  confirmTotp,
  disableTotp,
  newRecoveryCodes,
  passkeyOptions,
  addPasskey,
  renamePasskey,
  removePasskey,
};
