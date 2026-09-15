/* Shapes of the activity log (backend/database/audit.py). Field names are the server's. */

/** A row of audit_logs, with the readable names audit.with_names adds (GET /api/audit, a case's history, the
    platform console). Names are optional because some callers send the raw rows. */
export type AuditEvent = {
  id?: number;
  actor: string;
  action: string;
  entity: string;
  detail?: string | null;
  created_at: string;
  actor_display?: string;
  entity_display?: string;
};

/** GET /api/audit */
export type AuditPage = { events: AuditEvent[] };

export type AuditGroup = 'work' | 'ai' | 'security' | 'settings';

/** The activity log's filters, kept while moving between screens. */
export type AuditFilters = { actor?: string; group?: string; from?: string; to?: string };
