import { api } from '@/lib/api/client';
import type { Boot } from '@/lib/types';
import type { PasskeyAnswer, PasskeyRequestOptions } from './passkeys';
import type { CustomerLoginResult, CustomerSignupResult, RegistrationConfig, RegistrationSettingsInput, SignInResult } from './types';

/* Endpoints of backend/modules/auth (the shared sign-in, setup, organization sign-up), backend/modules/customers (the
   customer account's public actions) and the platform's registration email settings. */

/** The sign-in page, staff and customers alike: one request checks both kinds of account of this email. */
export const signIn = (email: string, password: string) => api<SignInResult>('/api/sign-in', { email, password });

export const setUp = (body: {
  name: string;
  email: string;
  password: string;
  organization: string;
  slug: string;
  setup_token?: string;
  demo: boolean;
}) => api('/api/setup', body);

export const registerOrganization = (body: {
  name: string;
  email: string;
  password: string;
  password_confirm: string;
  organization: string;
  slug: string;
}) => api('/api/register', body);

export const resendRegistration = (email: string) => api('/api/register/resend', { email });

export const verifyRegistration = (token: string) => api('/api/register/verify', { token });

export const bootstrap = () => api<Boot>('/api/bootstrap');

export const completeEmailOAuth = (state: string | null, code: string | null) =>
  api('/api/channels/email/oauth/complete', { state, code });

/** The second step of a sign-in: the code from the authenticator app, or one of the recovery codes. */
export const customerLoginVerify = (body: { code?: string; recovery_code?: string }) => api('/api/customer/login/verify', body);

/** Signing in with a passkey: no account is named, the passkey itself says who it is. */
export const passkeyLoginOptions = () => api<PasskeyRequestOptions>('/api/customer/passkey/options', {});
export const passkeyLogin = (credential: PasskeyAnswer) => api('/api/customer/passkey/login', { credential });

export const customerRegister = (body: { name: string; email: string; password: string; phone: string; consent: boolean; org?: string }) =>
  api<CustomerSignupResult>('/api/customer/register', body);

export const customerResend = (email: string) => api('/api/customer/resend', { email });

export const customerVerify = (token: string, password: string) => api('/api/customer/verify', { token, password });

export const customerForgot = (email: string) => api('/api/customer/forgot', { email });

export const customerReset = (token: string, password: string) => api<CustomerLoginResult>('/api/customer/reset', { token, password });

export const saveRegistrationSettings = (body: RegistrationSettingsInput) =>
  api<RegistrationConfig>('/api/platform/registration', body);
