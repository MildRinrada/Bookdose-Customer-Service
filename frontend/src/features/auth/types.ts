/* Shapes of the answers the sign-in, sign-up and verification screens read. Field names are the server's. */

/** GET /api/public/<code>: what the page says about the organization a customer signs up with (portal schema). */
export type PublicOrgInfo = {
  /** logo: a data: URL, or '' when none is set; banner: the support pages' band (guest/components/OrgBanner). */
  organization: { name: string; slug: string; logo?: string; banner?: unknown };
  welcome?: string;
  ai_enabled?: boolean;
  response_hours?: number | string;
  response_in_opening_time?: boolean;
  /** Sign-ups must confirm their email (the platform's email is set up). */
  email_verification: boolean;
  channels?: unknown[];
  categories?: string[];
} & Record<string, unknown>;

/** POST /api/customer/login and /api/customer/reset: signed in, or stopped at the second step (customer_security).
    `methods` says what may finish it: 'totp' (the authenticator app) and 'recovery' (one of the printed codes). */
export type CustomerLoginResult = { ok: true; signed_in?: boolean; two_factor?: boolean; methods?: string[] };

/** POST /api/sign-in: which kind of account signed in (a staff account wins when both passwords match). Staff get the
    staff session; a customer gets exactly the customer sign-in's answer, the second step included. */
export type SignInResult =
  | { ok: true; kind: 'staff'; two_factor?: boolean; methods?: string[] }
  | ({ kind: 'customer' } & CustomerLoginResult);

/** POST /api/sign-in/passkey: which kind of account the passkey belongs to (each gets its own session). */
export type PasskeySignInResult = { ok: true; kind: 'staff' | 'customer' };

/** POST /api/customer/register: 201 and signed in when email is not set up, else 202 and a link is on its way. */
export type CustomerSignupResult = { ok: true; signed_in?: boolean; verification_required?: boolean };

/** GET / POST /api/platform/registration: the platform's email for confirming organization sign-ups. */
export type RegistrationConfig = {
  /** The system's mailbox works: verification links, chat follow links, password resets and invitations can be sent. */
  enabled: boolean;
  /** Anyone on the internet may create an organization from the sign-up page (needs `enabled` as well). */
  signup_enabled: boolean;
  smtp_host?: string;
  smtp_port?: number;
  username?: string;
  address?: string;
  public_base_url?: string;
  has_password: boolean;
} & Record<string, unknown>;

/** The body of POST /api/platform/registration. */
export type RegistrationSettingsInput = {
  enabled: boolean;
  signup_enabled: boolean;
  public_base_url: string;
  address: string;
  smtp_host: string;
  smtp_port: number;
  username: string;
  password: string;
};

/** GET /api/invitation?token=: what the invitation page shows before anything is typed. `needs_account` is false
    when the address already has an account on the platform - it then only joins the organization. */
export type InvitationView = { organization: string; email: string; role: string; needs_account: boolean };

/** POST /api/invitation/accept: joined. `signed_in` only for a brand-new account, which chose its password here. */
export type InvitationAccepted = { ok: true; organization: string; email: string; signed_in: boolean };
