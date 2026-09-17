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
};

/** The platform admin's own support request for an organization, while it waits or is in force. */
export type SupportSummary = { id: string; status: 'pending' | 'approved'; hours: number; reason: string; created_at: string; expires_at: string | null };

/** GET /api/platform/tenants (support: by organization id). */
export type TenantsPage = { tenants: Tenant[]; audit: AuditEvent[]; support: Record<string, SupportSummary> };

export type TenantFilters = { q?: string; status?: string };

export type SystemWorker = { name: string; running: boolean; seconds_ago: number | null };

export type SystemHour = { start: string; requests: number; errors: number };

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

export type PlatformAdmin = { id: string; name: string; email: string; created_at: string };

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
