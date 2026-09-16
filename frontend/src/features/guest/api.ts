import { api } from '@/lib/api/client';
import type { GuestChatSettings, GuestClaim, GuestLineCode, GuestStartBody, SmsSettings } from './types';

/* Endpoints of the guest web chat (docs/GUEST-CHAT-DESIGN.md §3). The visitor's routes live under
   /api/public/<org>/guest; the chat named by X-Conversation-ID (setConversation) is the one /session, /messages,
   /handoff and /csat act on, exactly like the signed-in portal routes one level up. */

export const guestBase = (slug: string) => `/api/public/${slug}/guest`;

/** The `publicSlug` the shared chat pieces (MessageThread, Composer, AiPortalStatus, the survey) take: they build
    /api/public/<publicSlug>/messages, /attachments/<id>, /handoff and /csat, which for a guest are the guest routes. */
export const guestPortalSlug = (slug: string) => `${slug}/guest`;

/** GET: this browser's visitor, its conversations and the ways to follow them. */
export const guestPath = (slug: string) => guestBase(slug);

/** Cache key of one guest chat (the server reads X-Conversation-ID; the query only separates the cache entries). */
export const guestSessionKey = (slug: string, id: string) => `${guestBase(slug)}/session?conversation=${id}`;
export const guestSessionPath = (slug: string) => `${guestBase(slug)}/session`;

export const widgetPath = (slug: string) => `/api/public/${slug}/widget`;

export const startGuestChat = (slug: string, body: GuestStartBody) => api<{ id: string; csrf: string }>(`${guestBase(slug)}/conversations`, body);

export const setGuestName = (slug: string, name: string) => api<{ ok: true }>(`${guestBase(slug)}/name`, { name });

export const setGuestRemember = (slug: string, remember: boolean) => api<{ ok: true }>(`${guestBase(slug)}/remember`, { remember });

export const sendFollowLink = (slug: string, via: 'email' | 'sms', to: string) =>
  api<{ sent: true; to_masked: string }>(`${guestBase(slug)}/link`, { via, to });

export const resumeGuest = (slug: string, token: string) => api<{ ok: true; conversation_id: string }>(`${guestBase(slug)}/resume`, { token });

export const requestGuestLineCode = (slug: string) => api<GuestLineCode>(`${guestBase(slug)}/line-code`, {});

export const unlinkGuestLine = (slug: string) => api<{ ok: true }>(`${guestBase(slug)}/line`, undefined, 'DELETE');

export const forgetGuest = (slug: string) => api<{ ok: true }>(`${guestBase(slug)}/forget`, {});

/* Staff: ตั้งค่าองค์กร → แชทบนเว็บไซต์ */
export const GUEST_SETTINGS_PATH = '/api/settings/guest-chat';
export const saveGuestSettings = (body: Pick<GuestChatSettings, 'guest_chat' | 'widget'>) => api<GuestChatSettings>(GUEST_SETTINGS_PATH, body);

/* Signed-in customer: chats from before signing in */
export const GUEST_CLAIMS_PATH = '/api/customer/guest-claims';
export type GuestClaims = { claims: GuestClaim[] };
export const claimGuestChats = (org: string) => api<{ moved: number }>(GUEST_CLAIMS_PATH, { org });

/* Platform console */
export const SMS_PATH = '/api/platform/sms';
export const saveSmsSettings = (provider: string) => api<SmsSettings>(SMS_PATH, { provider });
