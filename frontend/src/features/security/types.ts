/* Answers of the platform security API (docs/SECURITY-DESIGN.md §3), field names as the server sends them. */

export type SecurityRange = '24h' | '7d';
export type Severity = 'info' | 'warning' | 'critical';
export type SecurityActor = 'staff' | 'platform' | 'customer' | 'guest' | 'anonymous';

/** GET /api/platform/security/overview?range= */
export type SecurityOverview = {
  cards: {
    failed_logins: number;
    locked_now: number;
    rate_limited: number;
    origin_csrf_rejected: number;
    cross_tenant_denied: number;
    open_alerts: number;
    /** Decoy path and hidden form field hits in the range (docs/HONEYPOT-DESIGN.md §4). */
    honeypot_hits?: number;
    /** Honeytoken triggers in the range. */
    honeytoken_triggers?: number;
  };
  /** Hourly buckets for 24h, 6-hourly for 7d. */
  series: Array<{ at: string; failed_logins: number; rate_limited: number; rejected: number }>;
  top_ips: Array<{ ip: string; events: number; failed_logins: number; blocked: boolean }>;
  top_subjects: Array<{ subject: string; actor: SecurityActor | (string & {}); failures: number }>;
};

/** A row of GET /api/platform/security/events. */
export type SecurityEvent = {
  id: string | number;
  at: string;
  kind: string;
  severity: Severity | (string & {});
  actor: SecurityActor | (string & {});
  subject: string | null;
  tenant_id?: string | null;
  tenant_name: string | null;
  ip: string | null;
  user_agent: string | null;
  count: number;
  detail: Record<string, unknown> | string | null;
};

/** `next_before`: the id the next (older) page starts before; null on the last page. */
export type SecurityEventsPage = { events: SecurityEvent[]; next_before: string | number | null };

export type SecurityEventFilters = { kind?: string; severity?: string; actor?: string; ip?: string; tenant?: string; q?: string };

/** A row of GET /api/platform/security/locks. */
export type SignInLockRow = {
  key: string;
  actor: string;
  subject: string;
  failures: number;
  level: number;
  locked_until: string;
  last_ip: string | null;
};

/** A row of GET /api/platform/security/alerts?open=1. */
export type SecurityAlert = {
  id: string | number;
  rule: string;
  severity: Severity | (string & {});
  started_at: string;
  last_seen_at: string;
  count: number;
  ip: string | null;
  detail: string | Record<string, unknown> | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  /** The server's own words for the rule (labels.ts has the page's). */
  label?: string;
};

/** A row of GET /api/platform/security/ip-blocks. */
export type IpBlock = { ip: string; reason: string; created_by: string | null; created_at: string; expires_at: string | null };

export type BlockDuration = '1h' | '24h' | '7d' | 'permanent';

/** GET / POST /api/platform/security/settings */
export type SecuritySettings = {
  /** Honeypots (docs/HONEYPOT-DESIGN.md §3); a save that leaves it out keeps it as it is. */
  honeypot?: HoneypotSettings;
  sessions: {
    staff: { idle_minutes: number; absolute_hours: number };
    platform: { idle_minutes: number; absolute_hours: number };
    customer: { idle_days: number; absolute_days: number };
  };
  alerts: {
    ip_failed_logins_10m: number;
    platform_failed_logins_10m: number;
    locks_1h: number;
    ip_rate_limited_10m: number;
    webhook_failures_10m: number;
  };
};

/* Honeypots and honeytokens (docs/HONEYPOT-DESIGN.md) */

export type DecoyPathMatch = 'exact' | 'prefix';

export type HoneypotSettings = {
  paths_enabled: boolean;
  forms_enabled: boolean;
  custom_api_paths: Array<{ path: string; match: DecoyPathMatch }>;
  block_on_path_hits: { enabled: boolean; hits: number; window_minutes: number; duration: BlockDuration };
  block_on_honeytoken: { enabled: boolean; duration: BlockDuration };
};

export type HoneytokenKind = 'decoy_account' | 'api_key' | 'password' | 'link';

/** A row of GET /api/platform/security/honeytokens. `preview`: the first characters of the secret, never all of it. */
export type Honeytoken = {
  id: string;
  kind: HoneytokenKind | (string & {});
  label: string;
  placed_at_note: string | null;
  decoy_email: string | null;
  preview: string | null;
  enabled: boolean;
  created_at: string;
  created_by: string | null;
  trigger_count: number;
  last_triggered_at: string | null;
  last_ip: string | null;
};

/** 201 of POST /api/platform/security/honeytokens: the secret (key / password / full link / decoy email) is shown once. */
export type HoneytokenCreated = { token: Honeytoken; secret: string };
