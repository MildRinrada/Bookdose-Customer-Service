import { api } from '@/lib/api/client';
import type { BlockDuration, SecurityEventFilters, SecurityRange, SecuritySettings } from './types';

/* Endpoints of the platform security API (docs/SECURITY-DESIGN.md §3, scope 'platform'). Every read lives under
   SECURITY_PREFIX, so refreshing it after a change redraws the whole page. */

export const SECURITY_PREFIX = '/api/platform/security';
export const LOCKS_PATH = `${SECURITY_PREFIX}/locks`;
export const OPEN_ALERTS_PATH = `${SECURITY_PREFIX}/alerts?open=1`;
export const IP_BLOCKS_PATH = `${SECURITY_PREFIX}/ip-blocks`;
export const SETTINGS_PATH = `${SECURITY_PREFIX}/settings`;

export const overviewPath = (range: SecurityRange) => `${SECURITY_PREFIX}/overview?range=${range}`;

export const EVENTS_PAGE_SIZE = 50;

export function eventsPath(filters: SecurityEventFilters, before = ''): string {
  const query = new URLSearchParams();
  for (const key of ['kind', 'severity', 'actor', 'ip', 'tenant', 'q'] as const) {
    const value = filters[key]?.trim();
    if (value) query.set(key, value);
  }
  if (before) query.set('before', before);
  query.set('limit', String(EVENTS_PAGE_SIZE));
  return `${SECURITY_PREFIX}/events?${query.toString()}`;
}

export const unlockAccount = (key: string) => api<{ ok: true }>(`${LOCKS_PATH}/unlock`, { key });

export const acknowledgeAlert = (id: string | number) => api<{ ok: true }>(`${SECURITY_PREFIX}/alerts/${encodeURIComponent(String(id))}/ack`, {});

export const blockIp = (body: { ip: string; reason: string; duration: BlockDuration }) => api(IP_BLOCKS_PATH, body);

export const unblockIp = (ip: string) => api(IP_BLOCKS_PATH, { ip }, 'DELETE');

export const revokeSessions = (body: { actor: 'staff' | 'customer'; subject: string }) =>
  api<{ revoked: number }>(`${SECURITY_PREFIX}/revoke-sessions`, body);

export const saveSecuritySettings = (body: SecuritySettings) => api<Partial<SecuritySettings>>(SETTINGS_PATH, body);
