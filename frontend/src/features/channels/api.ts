import { api } from '@/lib/api/client';

/* LINE / Email / Facebook endpoints (backend/modules/channels/routes.py). */

export const CHANNELS_PATH = '/api/channels';
export const FACEBOOK_PATH = '/api/channels/facebook';
/** What a settings change touches: both panels and the workspace (the inbox reads which chatbots are on). */
export const CHANNEL_SETTINGS_PREFIXES = ['/api/channels', '/api/workspace'];

export function saveChannel(kind: 'line' | 'email', body: Record<string, unknown>) {
  return api(`/api/channels/${kind}`, body, 'PATCH');
}

/** Only the words customers read (email: sender name and signature; LINE: the welcome): the connection is untouched. */
export function saveChannelPresentation(
  kind: 'line' | 'email',
  body: { sender_name?: string; signature?: string; welcome_enabled?: boolean; welcome_message?: string },
) {
  return api(`/api/channels/${kind}/presentation`, body, 'PATCH');
}

export function testChannel(kind: 'line' | 'email') {
  return api(`/api/channels/${kind}/test`, {});
}

export function syncEmail() {
  return api('/api/channels/email/sync', {});
}

export function startEmailOAuth() {
  return api<{ url: string }>('/api/channels/email/oauth/start', {});
}

export function saveFacebook(body: Record<string, unknown>) {
  return api(FACEBOOK_PATH, body, 'PATCH');
}

export function testFacebook() {
  return api('/api/channels/facebook/test', {});
}

export function retryDelivery(messageId: string) {
  return api(`/api/messages/${messageId}/retry`, {});
}

export function revokeFileLinks(messageId: string) {
  return api(`/api/messages/${messageId}/revoke-files`, {});
}
