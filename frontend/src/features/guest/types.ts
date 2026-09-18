/* Shapes of the guest web chat API (/api/public/<org>/guest…, /widget, /api/settings/guest-chat,
   /api/customer/guest-claims, /api/platform/sms), snake_case as the server sends them. See docs/GUEST-CHAT-DESIGN.md. */

/** This browser's visitor (GET …/guest → guest). Addresses come back masked; `csrf` goes in X-Guest-CSRF. */
export type GuestInfo = {
  name: string;
  email_masked: string;
  email_verified: boolean;
  phone_masked: string;
  phone_verified: boolean;
  line_linked: boolean;
  /** true: a cookie kept for 400 days; false: forgotten when the browser closes. */
  remember: boolean;
  csrf: string;
};

/** One of the visitor's conversations with the organization. */
export type GuestConversation = {
  id: string;
  subject: string;
  status: string;
  updated_at: string;
  /** Replies the visitor has not read (a count, or true/false). */
  unread: number | boolean;
  survey_pending: boolean;
};

/** Which ways of following a chat the organization and the platform can offer. */
export type GuestFollow = {
  email_ready: boolean;
  sms_ready: boolean;
  line_ready: boolean;
  line_oa_name: string;
  line_add_url: string;
};

/** GET /api/public/<org>/guest */
export type GuestOverview = {
  guest: GuestInfo | null;
  conversations: GuestConversation[];
  follow: GuestFollow;
  categories: string[];
  organization: { name: string; slug: string };
};

/** POST /api/public/<org>/guest/conversations */
export type GuestStartBody = {
  body: string;
  subject: string;
  category: string;
  name: string;
  remember: boolean;
  /** Honeypot: people never see it, so it stays empty. */
  website: string;
  /** When the form was shown (epoch ms): a form sent within 2 seconds is refused. */
  started_ms: number;
  attachments: Array<{ name: string; data: string }>;
};

/** POST …/guest/line-code: a 6-digit code to send to the organization's LINE. */
export type GuestLineCode = { code: string; expires_at: string; oa_name: string; add_url: string };

/** GET /api/public/<org>/widget (public): the website widget of the organization. */
export type WidgetPosition = 'right' | 'left';
export type WidgetTheme = 'purple' | 'blue' | 'green' | 'orange' | 'charcoal';
export type WidgetInfo = {
  enabled: boolean;
  guest_chat: boolean;
  position: WidgetPosition;
  theme: WidgetTheme;
  title: string;
  origins: string[];
};

/** GET/POST /api/settings/guest-chat (admin). `chat_url` / `chat_qr` are optional extras (the chat link and its QR as
    an SVG data: URL, like the join links); the panel builds the link itself when they are missing. */
export type GuestChatSettings = {
  guest_chat: { enabled: boolean };
  widget: { enabled: boolean; origins: string[]; position: WidgetPosition; theme: WidgetTheme; title: string };
  chat_url?: string;
  chat_qr?: string;
};

/** GET /api/customer/guest-claims: chats this browser had with an organization before signing in. */
export type GuestClaim = { org_slug: string; org_name: string; conversations: number };

/** How a guest can be reached, on the staff side (conversation rows, the open conversation, contacts). */
export type GuestReach = { follow: Array<'browser' | 'email' | 'sms' | 'line' | string> };

export type SmsProvider = 'off' | 'log' | 'thaibulksms' | 'twilio';

/** GET/POST /api/platform/sms: the provider in use and, per real provider, whether its credentials are saved. */
export type SmsSettings = {
  provider: SmsProvider;
  sender: string;
  account: string;
  configured: { thaibulksms: boolean; twilio: boolean };
};

/** POST /api/platform/sms. key / secret: '' keeps the saved credentials. */
export type SmsSettingsBody = { provider: string; sender?: string; account?: string; key?: string; secret?: string };
