import type { AuditEvent } from '@/features/audit/types';
import type { ContractTemplate } from '@/features/contracts/types';

/* Answers of backend/modules/platform (and the platform half of contracts), field names as the server sends them. */

/** A row of GET /api/platform/tenants. */
export type Tenant = {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | (string & {});
  created_at: string;
  member_count: number;
};

/** GET /api/platform/tenants */
export type TenantsPage = { tenants: Tenant[]; audit: AuditEvent[] };

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
};

export type PlatformAdmin = { id: string; name: string; email: string; created_at: string };

/** GET /api/platform/admins */
export type PlatformTeam = { admins: PlatformAdmin[]; me: string };

export type GlobalAudience = 'platform' | 'staff' | 'customer';

/** A row of GET /api/platform/faq. */
export type GlobalArticle = {
  id: string;
  title: string;
  category: string;
  body: string;
  audience: GlobalAudience;
  author: string;
  updated_at: string;
};

export type GlobalFaqPage = { articles: GlobalArticle[] };

export type GlobalFaqFilters = { q?: string; audience?: string };

export type GlobalArticleInput = { title: string; category: string; body: string; audience: string };

/** GET /api/platform/contract-templates */
export type PlatformTemplates = { templates: ContractTemplate[]; placeholders: string[] };

/** POST /api/platform/contracts/verify */
export type VerifyResult =
  | { found: false }
  | {
      found: true;
      valid: boolean;
      organization: string;
      reference: string;
      title: string;
      version: number | string;
      completed_at: string | null;
      customer_name: string;
      signatures: Array<{ party: string; signer_name: string; verified_by: string; signed_at: string; ip: string }>;
    };
