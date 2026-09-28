/* Calls to the Python server. Every request carries the staff session's CSRF token and the selected organization
   (X-Tenant-ID); on the customer side, the customer session's CSRF token; for a visitor without an account, the
   guest cookie's CSRF token (X-Guest-CSRF) and, inside an iframe, X-Embed. The providers keep these up to date
   (setStaffCredentials / setCustomerCredentials / setGuestCredentials); feature code only calls api() and download().
   A customer's chat is named by each call that acts on it ({ conversation }, sent as X-Conversation-ID), never by
   page-wide state: a message whose files are still being read must not land in the chat opened meanwhile.

   Same contract as before the move to Next.js: api(path) is a GET, api(path, body) a POST, api(path, body, method)
   anything else. A failed call throws an ApiError with the server's Thai message and the HTTP status.

   Session limits (lib/session-expiry.ts): every answer's Date header keeps the server's clock, a successful change
   (non-GET) counts as activity like it does on the server, and a 401 with `reason` says the session ran out. */

import { noteExpired, noteRequestActivity, noteServerDate } from '../session-expiry';

export class ApiError extends Error {
  readonly status: number;
  /** 401: why the session ended ('idle' | 'absolute'), when it ran out rather than never existed. */
  readonly reason?: string;
  /** 429: seconds until trying again is allowed (`retry_after`, else the Retry-After header). */
  readonly retryAfter?: number;
  constructor(message: string, status: number, extra: { reason?: string; retryAfter?: number } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.reason = extra.reason;
    this.retryAfter = extra.retryAfter;
  }
}

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const credentials: {
  csrf: string | null;
  tenantId: string | null;
  customerCsrf: string | null;
  guestCsrf: string | null;
  embed: boolean;
} = {
  csrf: null,
  tenantId: null,
  customerCsrf: null,
  guestCsrf: null,
  embed: false,
};

export function setStaffCredentials(csrf: string | null | undefined, tenantId: string | null | undefined) {
  credentials.csrf = csrf ?? null;
  credentials.tenantId = tenantId ?? null;
}

export function setCustomerCredentials(csrf: string | null | undefined) {
  credentials.customerCsrf = csrf ?? null;
}

/** A visitor chatting without an account (/support/<org>/…): the csrf of this browser's guest cookie (GET …/guest). */
export function setGuestCredentials(csrf: string | null | undefined) {
  credentials.guestCsrf = csrf ?? null;
}

/** The chat runs inside another website's iframe (/support/<org>/embed): the server then sends the cookie form a
    third-party frame can keep. */
export function setEmbedded(embedded: boolean) {
  credentials.embed = embedded;
}

export type RequestOptions = {
  /** The customer's or guest's chat the call acts on (/session, /messages, /handoff, /csat of a portal). */
  conversation?: string;
};

/** The browser's time zone, which a platform admin's sign-in is compared with (backend security/sign_in_alerts.py). */
let timeZone: string | null = null;
function browserTimeZone(): string {
  if (timeZone === null) {
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
      timeZone = '';
    }
  }
  return timeZone;
}

function headers(hasBody: boolean, options: RequestOptions): Record<string, string> {
  const result: Record<string, string> = {};
  if (browserTimeZone()) result['X-Bookdose-Timezone'] = browserTimeZone();
  if (credentials.csrf) result['X-CSRF-Token'] = credentials.csrf;
  if (credentials.tenantId) result['X-Tenant-ID'] = credentials.tenantId;
  if (credentials.customerCsrf) result['X-Customer-CSRF'] = credentials.customerCsrf;
  if (options.conversation) result['X-Conversation-ID'] = options.conversation;
  if (credentials.guestCsrf) result['X-Guest-CSRF'] = credentials.guestCsrf;
  if (credentials.embed) result['X-Embed'] = '1';
  if (hasBody) result['Content-Type'] = 'application/json';
  return result;
}

/* ยืนยันรหัสผ่านอีกครั้ง (backend security/admin_guard.py): a dangerous act of the platform console answers 403 with
   reason 'reauth_required' when the session has not proven its password in the last minutes. The page registers how
   to ask for it (components/ui/ReauthPrompt); once the password is confirmed the same request goes again, once.
   Several requests refused together share one question. */
let askPassword: (() => Promise<boolean>) | null = null;
let asking: Promise<boolean> | null = null;

export function setReauthPrompt(prompt: (() => Promise<boolean>) | null) {
  askPassword = prompt;
}

function confirmAgain(): Promise<boolean> {
  if (!askPassword) return Promise.resolve(false);
  asking ??= askPassword().finally(() => {
    asking = null;
  });
  return asking;
}

async function send(path: string, body?: unknown, method?: Method, options: RequestOptions = {}, again = true): Promise<Response> {
  const hasBody = body !== undefined;
  const verb = method ?? (hasBody ? 'POST' : 'GET');
  let response: Response;
  try {
    response = await fetch(path, {
      method: verb,
      headers: headers(hasBody, options),
      body: hasBody ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('ติดต่อโปรแกรมไม่ได้ กรุณาตรวจสอบว่าหน้าต่าง Bookdose ยังเปิดอยู่', 0);
  }
  noteServerDate(response.headers.get('date'));
  if (!response.ok) {
    let message = 'เกิดข้อผิดพลาด กรุณาลองใหม่';
    let reason: string | undefined;
    let retryAfter: number | undefined;
    try {
      const answer = (await response.json()) as { error?: string; reason?: unknown; retry_after?: unknown };
      message = answer.error || message;
      if (typeof answer.reason === 'string') reason = answer.reason;
      if (typeof answer.retry_after === 'number' && Number.isFinite(answer.retry_after)) retryAfter = answer.retry_after;
    } catch {
      /* Not JSON: keep the general message. */
    }
    if (response.status === 429 && retryAfter === undefined) {
      const header = Number(response.headers.get('retry-after'));
      if (Number.isFinite(header) && header > 0) retryAfter = header;
    }
    if (response.status === 401 && (reason === 'idle' || reason === 'absolute')) noteExpired(reason);
    if (response.status === 403 && reason === 'reauth_required' && again) {
      if (await confirmAgain()) return send(path, body, method, options, false);
      throw new ApiError('ยกเลิกการทำรายการแล้ว', 403, { reason: 'reauth_cancelled' });
    }
    throw new ApiError(message, response.status, { reason, retryAfter });
  }
  if (verb !== 'GET') noteRequestActivity(path);
  return response;
}

export async function api<T = unknown>(path: string, body?: unknown, method?: Method, options?: RequestOptions): Promise<T> {
  const response = await send(path, body, method, options);
  if (response.headers.get('content-type')?.includes('application/json')) return (await response.json()) as T;
  return (await response.blob()) as T;
}

/** Fetch a file through the API (with the session's headers) and save it under the given name. */
export async function download(path: string, filename: string) {
  const blob = await (await send(path)).blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file behind the API as a Blob (images and videos in messages: the caller checks its type, then makes a blob: URL). */
export async function fetchBlob(path: string): Promise<Blob> {
  return (await send(path)).blob();
}
