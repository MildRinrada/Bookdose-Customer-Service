import { api } from '@/lib/api/client';

/* Endpoints of backend/modules/trash/routes.py. Read with useApi(TRASH_PATH). */

export const TRASH_PATH = '/api/trash';

/** What a restore can bring back into view: the case list, contacts, articles and the screens counting them. */
export const RESTORE_PREFIXES = [TRASH_PATH, '/api/tickets', '/api/contacts', '/api/articles', '/api/dashboard', '/api/audit'];

export const restoreItem = (id: string) => api<{ restored: string; kind: string }>(`/api/trash/${id}/restore`, {});

export const purgeItem = (id: string) => api<{ purged: string }>(`/api/trash/${id}`, undefined, 'DELETE');
