/* Shapes of the answers the sign-in, sign-up and verification screens read. Field names are the server's. */

/** GET /api/public/<code>: what the page says about the organization a customer signs up with (portal schema). */
export type PublicOrgInfo = {
  organization: { name: string; slug: string };
  welcome?: string;
  ai_enabled?: boolean;
  response_hours?: number | string;
  /** Sign-ups must confirm their email (the platform's email is set up). */
  email_verification: boolean;
  channels?: unknown[];
  categories?: string[];
} & Record<string, unknown>;

/** POST /api/customer/register: 201 and signed in when email is not set up, else 202 and a link is on its way. */
export type CustomerSignupResult = { ok: true; signed_in?: boolean; verification_required?: boolean };

/** GET / POST /api/platform/registration: the platform's email for confirming organization sign-ups. */
export type RegistrationConfig = {
  enabled: boolean;
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
  public_base_url: string;
  address: string;
  smtp_host: string;
  smtp_port: number;
  username: string;
  password: string;
};
