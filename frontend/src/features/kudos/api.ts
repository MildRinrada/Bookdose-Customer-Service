import { api } from '@/lib/api/client';
import type { KudosWall } from './types';

/* กำแพงคำชม (backend/modules/kudos/routes.py). The overview carries the newest few; the whole wall is read with
   useApi(KUDOS_PATH) in its dialog. */

export const KUDOS_PATH = '/api/kudos';

/** What a cheer or a take-down touches: the wall and the overview that shows its newest items. */
export const KUDOS_PREFIXES = [KUDOS_PATH, '/api/automation/overview'];

export type { KudosWall };

export const cheerKudos = (id: string, on: boolean) => api<{ ok: true }>(`${KUDOS_PATH}/${id}/cheer`, { on });

export const hideKudos = (id: string) => api<{ ok: true }>(`${KUDOS_PATH}/${id}`, undefined, 'DELETE');
