import { api } from '@/lib/api/client';
import type { GuestBlock, GuestChatSettings, GuestClaim, GuestLineCode, GuestStartBody, GuestStartLink, SmsSettings, SmsSettingsBody } from './types';
import type { LineMoveCode } from '@/features/customer/types';

/* Endpoints of the guest web chat (docs/features/support-page-and-guest-chat.md). The visitor's routes live under
   /api/public/<org>/guest; the chat named by X-Conversation-ID (the `conversation` option of api()) is the one /session, /messages,
   /handoff and /csat act on, exactly like the signed-in portal routes one level up. */

export const guestBase = (slug: string) => `/api/public/${slug}/guest`;

/** The `publicSlug` the shared chat pieces (MessageThread, Composer, AiPortalStatus, the survey) take: they build
    /api/public/<publicSlug>/messages, /attachments/<id>, /handoff and /csat, which for a guest are the guest routes. */
export const guestPortalSlug = (slug: string) => `${slug}/guest`;

/** GET: a case holding one of this browser's chats (status, progress, deadlines; 404 for any other case). */
export const guestCasePath = (slug: string, id: string) => `${guestBase(slug)}/cases/${id}`;

/** The organization's public page: its name, welcome and published articles (no sign-in, no guest cookie needed). */
export const publicOrgPath = (slug: string) => `/api/public/${slug}`;

/** The addresses of a guest's pages (/support/…; the older /chat/<org>… links redirect here, next.config.ts). */
export const guestPages = {
  /** Start a chat: the organization's own link (/support/tickets/new without one asks for its code). */
  start: (slug: string) => `/support/${slug}/tickets/new`,
  /** This browser's chats with the organization, or one of them. */
  chat: (slug: string, conversationId?: string) => `/support/${slug}/tickets${conversationId ? `/${conversationId}` : ''}`,
  faq: (slug: string) => `/support/${slug}/faq`,
  article: (slug: string, id: string) => `/support/${slug}/faq/${id}`,
  case: (slug: string, id: string) => `/support/${slug}/cases/${id}`,
  resume: (slug: string) => `/support/${slug}/resume`,
  embed: (slug: string) => `/support/${slug}/embed`,
};

/** GET: this browser's visitor, its conversations and the ways to follow them. */
export const guestPath = (slug: string) => guestBase(slug);

/** Cache key of one guest chat (the server reads X-Conversation-ID; the query only separates the cache entries). */
export const guestSessionKey = (slug: string, id: string) => `${guestBase(slug)}/session?conversation=${id}`;
export const guestSessionPath = (slug: string) => `${guestBase(slug)}/session`;

export const widgetPath = (slug: string) => `/api/public/${slug}/widget`;

export const startGuestChat = (slug: string, body: GuestStartBody) =>
  api<{ id: string; csrf: string; links?: GuestStartLink[] }>(`${guestBase(slug)}/conversations`, body);

export const setGuestName = (slug: string, name: string) => api<{ ok: true }>(`${guestBase(slug)}/name`, { name });

export const setGuestRemember = (slug: string, remember: boolean) => api<{ ok: true }>(`${guestBase(slug)}/remember`, { remember });

export const sendFollowLink = (slug: string, via: 'email' | 'sms', to: string) =>
  api<{ sent: true; to_masked: string }>(`${guestBase(slug)}/link`, { via, to });

/** `replace`: this browser already follows another guest's chats and the person said to open the link anyway. */
export const resumeGuest = (slug: string, token: string, replace = false) =>
  api<{ ok: true; conversation_id: string }>(`${guestBase(slug)}/resume`, replace ? { token, replace: true } : { token });

export const requestGuestLineCode = (slug: string) => api<GuestLineCode>(`${guestBase(slug)}/line-code`, {});

/** A code that carries the guest's chat to the organization's LINE (channels/move.py). */
export const continueGuestOnLine = (slug: string, conversationId: string) =>
  api<LineMoveCode>(`${guestBase(slug)}/line-continue`, {}, 'POST', { conversation: conversationId });

/** คุยต่อบนมือถือ: a QR that opens this chat on the guest's phone (backend guest/handoff.py): once, for 10 minutes. */
export const requestHandoffQr = (slug: string, conversationId: string) =>
  api<{ url: string; qr: string; expires_at: string }>(`${guestBase(slug)}/handoff-qr`, {}, 'POST', { conversation: conversationId });

export const unlinkGuestLine = (slug: string) => api<{ ok: true }>(`${guestBase(slug)}/line`, undefined, 'DELETE');

export const forgetGuest = (slug: string) => api<{ ok: true }>(`${guestBase(slug)}/forget`, {});

/* Staff: ตั้งค่าองค์กร → แชทบนเว็บไซต์ */
export const GUEST_SETTINGS_PATH = '/api/settings/guest-chat';
export const saveGuestSettings = (body: Pick<GuestChatSettings, 'guest_chat' | 'widget'> | { members_first: boolean }) =>
  api<GuestChatSettings>(GUEST_SETTINGS_PATH, body);

/* บล็อกผู้ก่อกวน (owners only): from the open conversation in the inbox, and the list in ตั้งค่าองค์กร → แชทบนเว็บไซต์. */
export const GUEST_BLOCKS_PATH = '/api/settings/guest-blocks';
export const blockGuest = (conversationId: string) =>
  api<{ block: GuestBlock; closed: number }>(`/api/conversations/${conversationId}/guest-block`, {});
export const unblockGuest = (conversationId: string) => api<{ ok: true }>(`/api/conversations/${conversationId}/guest-block`, undefined, 'DELETE');
export const liftGuestBlock = (id: string) => api<{ ok: true }>(`${GUEST_BLOCKS_PATH}/${id}`, undefined, 'DELETE');

/* Signed-in customer: chats from before signing in */
export const GUEST_CLAIMS_PATH = '/api/customer/guest-claims';
export type GuestClaims = { claims: GuestClaim[] };
export const claimGuestChats = (org: string) => api<{ moved: number }>(GUEST_CLAIMS_PATH, { org });

/* Platform console */
export const SMS_PATH = '/api/platform/sms';
/** Choose the provider; credentials left empty keep the saved ones (they never come back from the server). */
export const saveSmsSettings = (body: SmsSettingsBody) => api<SmsSettings>(SMS_PATH, body);
/** A test text through the provider in use now. */
export const sendTestSms = (to: string) => api<{ sent: true; to_masked: string }>(`${SMS_PATH}/test`, { to });
