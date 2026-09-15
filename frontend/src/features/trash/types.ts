/* Shapes of the recycle bin (backend/modules/trash). Field names are the server's. */

export type TrashKind = 'ticket' | 'contact' | 'article';

/** A row of GET /api/trash. */
export type TrashItem = {
  id: string;
  kind: TrashKind | (string & {});
  entity: string;
  title: string;
  detail: string | null;
  actor: string;
  deleted_at: string;
  label: string;
  days_left: number;
  /** The member's role may put this kind back (the server checks again). */
  can_restore: boolean;
};

/** GET /api/trash */
export type TrashPage = { items: TrashItem[]; keep_days: number };

/** The recycle bin's filters, kept while moving between screens. */
export type TrashFilters = { q?: string; kind?: string };
