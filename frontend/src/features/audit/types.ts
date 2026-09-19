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
export type AuditFilters = {
  /** Free text: who, what or the item. */
  actor?: string;
  /** A kind (AuditGroup) or 'important'. */
  group?: string;
  /** A quick period (auditRanges); 'custom' uses from/to. */
  range?: string;
  from?: string;
  to?: string;
  /** Who did it (the actor's shown name). */
  person?: string;
  /** Show the system's and the AI's own events too. */
  automated?: boolean;
};
