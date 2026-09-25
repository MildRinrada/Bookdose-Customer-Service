import type { AuditEvent } from '@/features/audit/types';

/* Answers of backend/modules/platform, field names as the server sends them. */

/** A row of GET /api/platform/tenants. */
export type Tenant = {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | (string & {});
  created_at: string;
  member_count: number;
  /** Whether it set a picture of its own; the picture itself is fetched from /api/public/<slug>/logo. */
  has_logo?: boolean;
  /** Who runs the organization: its own admins (a platform admin never is one). */
  admins: { name: string; email: string }[];
  /** Emails invited as its admin, not answered yet. */
  admin_invites: string[];
  /** Which features are on for this organization: its own answers over each feature's default. */
  features: Record<string, boolean>;
  /** Codes it used to have. Links customers were given with them still lead here. */
  former_slugs: string[];
};

/** One switchable feature, as the console lists them (backend platform/model.py FEATURES). */
export type FeatureInfo = { key: string; label: string; detail: string; default: boolean };

/** The platform admin's own support request for an organization, while it waits or is in force. */
export type SupportSummary = { id: string; status: 'pending' | 'approved'; hours: number; reason: string; created_at: string; expires_at: string | null };

/** GET /api/platform/tenants (support: by organization id). */
export type TenantsPage = { tenants: Tenant[]; audit: AuditEvent[]; support: Record<string, SupportSummary>; can_invite: boolean; feature_catalogue: FeatureInfo[] };

export type TenantFilters = { q?: string; status?: string };

export type SystemWorker = { name: string; running: boolean; starting?: boolean; seconds_ago: number | null };

/** One thing to do on ภาพรวมระบบ → ต้องจัดการ; `action.do` is a button the card handles itself. */
export type TodoItem = {
  key: string;
  level: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  action: { label: string; href: string; do?: 'key-saved' };
};

export type ChannelState = {
  kind: 'line' | 'email' | 'facebook';
  name: string;
  enabled: boolean;
  status: 'ok' | 'warning' | 'error';
  error: string;
  stuck: boolean;
  last_received: string | null;
  waiting: number;
  failed: number;
  unknown: number;
  oldest_waiting: string | null;
  last_failure: string;
  last_failure_at: string | null;
};

export type OrgChannels = { id: string; name: string; slug: string; status: 'ok' | 'warning' | 'error'; channels: ChannelState[] };

export type OrgUsage = {
  id: string;
  name: string;
  slug: string;
  status: string;
  members: number;
  open_cases: number;
  messages_7d: number;
  /** Its attachment files. */
  storage_bytes: number;
  /** Its own database file. */
  database_bytes: number;
  /** The two together: what it takes on the shared disk. */
  used_bytes: number;
  /** Its ceiling in MB; 0 means it has none. */
  quota_mb: number;
  /** used_bytes / quota, 0 when there is no ceiling. */
  share: number;
  /** How this organization is doing (backend platform/orghealth.py). `score` is null and `level` is 'new' when
      nothing has happened yet: a quiet organization is not a failing one. */
  health: OrgHealth | null;
  last_active: string | null;
};

export type SecuritySummary = { failed_sign_ins: number; locked_accounts: number; blocked_ips: number; trap_hits: number; open_alerts: number };

export type BackupSettings = { enabled: boolean; hour: number; keep: number };

/** auto / manual: made here; upload: sent from the console to restore; before: taken just before a restore. */
export type BackupFile = { name: string; kind: 'auto' | 'manual' | 'upload' | 'before'; size: number; created_at: string };

/** POST /api/platform/restore/preview: what restoring the file would replace (backend platform/restore.py). */
export type RestorePreview = {
  name: string;
  /** What the admin types to confirm. */
  confirm: string;
  created_at: string | null;
  size: number;
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    change: 'replace' | 'add' | 'remove';
    cases_now: number | null;
    cases_backup: number | null;
    conversations_now: number | null;
    conversations_backup: number | null;
  }>;
  totals: { replace: number; add: number; remove: number; cases_now: number; cases_backup: number };
  attachments: number;
  /** Who can sign in to the platform console afterwards. */
  platform_admins: string[];
  secrets: { key_id: string | null; available: boolean; files: number };
};

export type RestoreResult = { ok: true; safety_backup: string; secrets_restored: boolean; secrets_skipped: boolean };

export type BackupsView = {
  folder: string;
  inside_data: boolean;
  same_disk: boolean;
  from_environment: boolean;
  settings: BackupSettings;
  last: { at: string; ok: boolean; name?: string; size?: number; kind: string; error?: string } | null;
  files: BackupFile[];
  running: boolean;
  key_id: string;
};

export type Announcement = {
  text: string;
  level: 'info' | 'warning';
  audience: 'staff' | 'all';
  starts_at?: string;
  ends_at?: string;
  by?: string;
  at?: string;
};

export type AnnouncementInput = Pick<Announcement, 'text' | 'level' | 'audience' | 'starts_at' | 'ends_at'>;

/** GET /api/platform/dormant: organizations nobody has used for `days` days (backend platform/dormant.py). */
export type DormantPage = {
  days: number;
  mail_ready: boolean;
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    created_at: string;
    members: number;
    admins: Array<{ name: string; email: string }>;
    /** A member of the team last opened the app (null: never). */
    last_seen: string | null;
    last_case: string | null;
    last_customer_message: string | null;
    open_cases: number;
    used_bytes: number;
    asleep_since: string;
    contacted: { at: string; by: string } | null;
  }>;
};

/** GET /api/platform/health */
export type HealthPage = {
  todo: TodoItem[];
  channels: OrgChannels[];
  usage: OrgUsage[];
  security: SecuritySummary;
  backups: BackupsView;
  announcement: Announcement | null;
};

/** A published vulnerability in a library the server runs (backend platform/vulns.py, from OSV.dev). */
export type VulnFinding = {
  ecosystem: 'PyPI' | 'npm' | string;
  name: string;
  version: string;
  /** Only used to build and test the web app: never runs on the server (listed, not emailed). */
  dev: boolean;
  id: string;
  cves: string[];
  summary: string;
  level: 'critical' | 'high' | 'medium' | 'low' | 'unknown';
  score: number | null;
  fixed: string[];
  url: string;
};

export type VulnsView = {
  last: { at: string; ok: boolean; error?: string; python: number; npm: number | null; findings: VulnFinding[] } | null;
  running: boolean;
  every_hours: number;
};

/** A row of GET /api/platform/notifications: a to-do of ภาพรวมระบบ, or the answer to the admin's own support request.
    `notify`: counted on the bell (advice and a request still waiting are listed only). */
export type PlatformNotice = {
  key: string;
  kind: 'system' | 'support';
  level: 'critical' | 'warning' | 'info';
  icon: string;
  title: string;
  detail: string;
  href: string;
  at: string | null;
  /** When an approved support access ends. */
  until: string | null;
  notify: boolean;
};

export type SystemHour ={ start: string; requests: number; errors: number };

export type SystemError = { at: string; source: string; detail: string; where: string };

/** GET /api/platform/system (monitor.snapshot() plus the platform service's counts). */
export type SystemOverview = {
  started_at: string;
  uptime_seconds: number;
  requests: number;
  server_errors: number;
  client_errors: number;
  average_ms: number;
  last_hour: number;
  hours: SystemHour[];
  areas: Record<string, number>;
  errors: SystemError[];
  workers: SystemWorker[];
  tenant_usage: Array<{ id: string; name: string; requests: number }>;
  queues: { outbox_waiting: number; outbox_failed: number; ai_pending: number; notices_pending: number };
  users: number;
  server: {
    python: string;
    system: string;
    data_dir: string;
    database_bytes: number;
    files_bytes: number;
    disk_total: number;
    disk_free: number;
  };
  organizations: { active: number; suspended: number; members: number };
  audit: AuditEvent[];
  /** Where the secret key comes from, and whether this admin's own account has a second factor or a passkey. */
  security?: { secret_key: 'environment' | 'file'; account_protected: boolean };
};

export type PlatformAdmin = { id: string; name: string; email: string; created_at: string; owner: boolean };

/** GET /api/platform/admins */
export type PlatformTeam = { admins: PlatformAdmin[]; me: string };

export type GlobalAudience = 'platform' | 'staff' | 'customer';

/** Where a global article stands: never published, published as it is, or published with changes waiting. */
export type GlobalArticleState = 'draft' | 'published' | 'changed';

/** A row of GET /api/platform/faq: the latest words (with the waiting changes) and, while they differ, `live`: the
    version readers see. */
export type GlobalArticle = {
  id: string;
  title: string;
  category: string;
  body: string;
  audience: GlobalAudience;
  author: string;
  updated_at: string;
  published_at: string | null;
  state: GlobalArticleState;
  live: { title: string; category: string; body: string; audience: GlobalAudience } | null;
};

export type GlobalFaqPage = { articles: GlobalArticle[] };

export type GlobalFaqFilters = { q?: string; audience?: string; state?: string };

export type GlobalArticleInput = { title: string; category: string; body: string; audience: string };

/** GET/POST /api/platform/turnstile: the bot check on the public support form (backend/extensions/turnstile.py).
    `site_key` is the public key the form draws its widget with; `configured` says the secret key is sealed on the
    server (it never comes back). */
export type TurnstileSettings = { enabled: boolean; site_key: string; configured: boolean };

/** A row of GET /api/platform/reports: what a member of an organization sent from the ? in their top bar. */
export type ProblemReport = {
  id: string;
  tenant_id: string | null;
  tenant_name: string;
  user_id: string;
  user_name: string;
  user_email: string;
  page: string;
  message: string;
  browser: string;
  status: 'open' | 'done';
  created_at: string;
  handled_at: string | null;
  handled_by: string | null;
};

/** GET /api/platform/reports */
export type ProblemReportsPage = { reports: ProblemReport[]; open: number };

/** A ready-made answer in คลังบทความแม่แบบ (backend platform article_templates). */
export type ArticleTemplate = {
  id: string;
  title: string;
  category: string;
  body: string;
  /** 0 until the platform team publishes it; organizations only ever see published ones. */
  published: number;
  author: string;
  updated_at: string;
};

/** One of the four things an organization is judged on; `score` null means there is not enough to go on yet. */
export type HealthSignal = {
  key: string;
  score: number | null;
  /** response */
  total?: number;
  in_time?: number;
  /** csat */
  answers?: number;
  average?: number | null;
  /** backlog */
  open_cases?: number;
  overdue?: number;
  /** channels */
  failing?: string[];
  connected?: number;
};

export type OrgHealth = {
  score: number | null;
  level: 'ok' | 'watch' | 'risk' | 'new';
  signals: Record<string, HealthSignal>;
};
