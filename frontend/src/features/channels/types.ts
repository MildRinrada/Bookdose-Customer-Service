/* Shapes of the LINE / Email / Facebook API (backend/modules/channels). Field names are the server's. */

/** message.channel_delivery (channels.schema.delivery_view): null for messages that are not sent anywhere. */
export type ChannelDeliveryState = { error: string; retryable: boolean; attempts: number; has_file_links: boolean };

export type OutboxCount = { status: string; count: number };

export type LineConfig = {
  team_id?: string;
  chatbot_enabled?: boolean;
  groups_enabled?: boolean;
  group_chatbot_enabled?: boolean;
  public_base_url?: string;
  display_name?: string;
  identity?: string;
  /** The reply sent when a customer adds the account as a friend (channels.service.welcome_new_friend). */
  welcome_enabled?: boolean;
  welcome_message?: string;
} & Record<string, unknown>;

export type EmailConfig = {
  team_id?: string;
  chatbot_enabled?: boolean;
  address?: string;
  username?: string;
  imap_host?: string;
  smtp_host?: string;
  smtp_port?: number;
  poll_seconds?: number;
  auth_mode?: 'password' | 'google' | 'microsoft' | string;
  oauth_client_id?: string;
  oauth_redirect_uri?: string;
  display_name?: string;
  /** Shown beside the address as the sender, and under every reply (channel_transport.build_email). */
  sender_name?: string;
  signature?: string;
} & Record<string, unknown>;

/** A row of GET /api/channels (LINE and Email). */
export type ChannelSetting = {
  kind: 'line' | 'email';
  enabled: boolean;
  config: LineConfig & EmailConfig;
  credentials_configured: boolean;
  /** LINE: the channel ID as saved (not a secret, so it is shown back). */
  channel_id?: string;
  oauth_client_configured: boolean;
  route_id: string | null;
  last_error: string;
  last_checked: string | null;
  last_received: string | null;
  outbox: OutboxCount[];
  events?: unknown[];
  /** LINE: where LINE says it sends events, as the last check read it (channels/health.py); {} before a check. */
  webhook?: { endpoint?: string; active?: boolean };
};

/** GET /api/channels/facebook */
export type FacebookSetting = {
  kind: 'facebook';
  enabled: boolean;
  config: {
    team_id: string;
    page_id: string;
    page_name: string;
    verify_token: string;
    /** The Instagram professional account connected to the Page, whose DMs come in with the same token. */
    instagram_enabled: boolean;
    instagram_id: string;
    instagram_username: string;
  };
  credentials_configured: boolean;
  route_id: string | null;
  last_error: string;
  last_checked: string | null;
  last_received: string | null;
  outbox: OutboxCount[];
  /** on: the Page is on, Instagram is turned on and its account is known (channels/facebook.instagram_on). */
  instagram: { on: boolean; last_received: string | null; outbox: OutboxCount[] };
};

/** Workspace.channels: which provider channels are on, and whether their chatbot is. */
export type WorkspaceChannels = Partial<Record<string, { enabled: boolean; chatbot_enabled: boolean }>>;
