/* When the signed-in session runs out (docs/SECURITY-DESIGN.md §2). The server keeps two limits per session: idle
   (no activity for too long) and absolute (signed in too long). It says when each ends as `idle_expires_at` /
   `absolute_expires_at` (GET /api/session, GET /api/customer/account, and the activity endpoints), and answers an
   expired session with 401 {reason: 'idle' | 'absolute'}.

   This module is the page's memory of those two moments, with no React in it: api() (lib/api/client.ts) tells it about
   the server's clock, every successful change (a non-GET request is activity on the server too) and every expired
   answer; the frames' SessionGuard reads it to warn before the idle limit and to send the person to sign-in with the
   reason. Background traffic (polling GETs, the realtime socket) never reaches noteRequestActivity(). */

export type SessionKind = 'staff' | 'customer';
export type ExpiryReason = 'idle' | 'absolute';
/** The two fields as the server sends them (ISO times). */
export type ExpiryTimes = { idle_expires_at?: string | null; absolute_expires_at?: string | null };

export type SessionExpiry = {
  /** Server-clock milliseconds; null when not known (e.g. a server without session limits). */
  idleAt: number | null;
  absoluteAt: number | null;
  /** The idle limit's length, learnt from an activity answer (the server has just set last_active_at = now). */
  idleMs: number | null;
  /** Local time of the last activity the server has counted (an activity post or any successful change). */
  countedAt: number;
};

const EMPTY: SessionExpiry = { idleAt: null, absoluteAt: null, idleMs: null, countedAt: 0 };

const entries: Record<SessionKind, SessionExpiry> = { staff: EMPTY, customer: EMPTY };
let active: SessionKind | null = null;
let clockOffset = 0;
let expired: { reason: ExpiryReason; at: number } | null = null;

const listeners = new Set<() => void>();
const expiredListeners = new Set<(reason: ExpiryReason) => void>();
const emit = () => listeners.forEach((listener) => listener());

export function subscribeExpiry(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const expiryOf = (kind: SessionKind): SessionExpiry => entries[kind];

/** The server's clock, as far as its Date headers tell (one-second resolution is plenty for minutes). */
export const serverNow = () => Date.now() + clockOffset;

export function noteServerDate(header: string | null) {
  const at = header ? Date.parse(header) : NaN;
  if (Number.isNaN(at)) return;
  const offset = at - Date.now();
  // Date has whole seconds: small wobbles are noise.
  if (Math.abs(offset - clockOffset) > 1500) clockOffset = Math.abs(offset) < 1500 ? 0 : offset;
}

const parse = (value: string | null | undefined) => {
  const at = value ? Date.parse(value) : NaN;
  return Number.isNaN(at) ? null : at;
};

/** The frame of this kind is on screen: successful changes now count as its activity. */
export function setActiveSession(kind: SessionKind | null) {
  active = kind;
}

/** New limits from the server. `fromActivity`: the answer of an activity post, which also tells the idle length. */
export function applyExpiry(kind: SessionKind, times: ExpiryTimes | null | undefined, fromActivity = false) {
  if (!times) return;
  const idleAt = parse(times.idle_expires_at);
  const absoluteAt = parse(times.absolute_expires_at);
  if (idleAt === null && absoluteAt === null) return;
  const current = entries[kind];
  const idleMs = fromActivity && idleAt !== null ? Math.max(0, idleAt - serverNow()) : current.idleMs;
  const countedAt = fromActivity ? Date.now() : current.countedAt;
  if (current.idleAt === idleAt && current.absoluteAt === absoluteAt && current.idleMs === idleMs && current.countedAt === countedAt) return;
  entries[kind] = { idleAt, absoluteAt, idleMs, countedAt };
  emit();
}

/** Signed out, or signed in anew: forget the old limits (and any expiry reason). */
export function clearExpiry(kind: SessionKind) {
  entries[kind] = EMPTY;
  expired = null;
  emit();
}

// Requests that are not the person's own activity on this frame's session.
const NOT_ACTIVITY = /^\/api\/(session\/activity|customer\/activity|logout|customer\/logout|login|sign-in|customer\/login)(\/|\?|$)/;

/** A change went through (non-GET, 2xx): the server counted it as activity of the session that sent it. */
export function noteRequestActivity(path: string) {
  if (!active || NOT_ACTIVITY.test(path)) return;
  const customerPath = path.startsWith('/api/customer/') || path.startsWith('/api/public/');
  if ((active === 'customer') !== customerPath) return;
  const current = entries[active];
  const idleAt = current.idleMs !== null ? serverNow() + current.idleMs : current.idleAt;
  entries[active] = { ...current, idleAt: idleAt !== null && current.absoluteAt !== null ? Math.min(idleAt, current.absoluteAt) : idleAt, countedAt: Date.now() };
  emit();
}

/** A 401 said the session ran out. */
export function noteExpired(reason: ExpiryReason) {
  expired = { reason, at: Date.now() };
  expiredListeners.forEach((listener) => listener(reason));
}

export function onSessionExpired(listener: (reason: ExpiryReason) => void) {
  expiredListeners.add(listener);
  return () => void expiredListeners.delete(listener);
}

/** Why the session of this kind is gone, if it ran out: what the server said lately, else what the known limits say. */
export function expiryReason(kind: SessionKind): ExpiryReason | null {
  if (expired && Date.now() - expired.at < 5 * 60 * 1000) return expired.reason;
  const { idleAt, absoluteAt } = entries[kind];
  const now = serverNow();
  if (absoluteAt !== null && now >= absoluteAt) return 'absolute';
  if (idleAt !== null && now >= idleAt) return 'idle';
  return null;
}

export const expiryNotices: Record<ExpiryReason, string> = {
  idle: 'หมดเวลาเนื่องจากไม่ได้ใช้งาน',
  absolute: 'ครบเวลาการเข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่',
};

/** The sign-in address after a session ended: back to `path` afterwards, with the reason to show. */
export function signInAddress(path: string, reason: ExpiryReason | null): string {
  const query = new URLSearchParams({ next: path });
  if (reason) query.set('expired', reason);
  return `/login?${query.toString()}`;
}
