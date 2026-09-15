/* Calls to the Python server. Every request carries the staff session's CSRF token and the selected organization
   (X-Tenant-ID); on the customer side, the customer session's CSRF token and the conversation being read.
   The providers keep these up to date (setStaffCredentials / setCustomerCredentials / setConversation); feature
   code only calls api() and download().

   Same contract as before the move to Next.js: api(path) is a GET, api(path, body) a POST, api(path, body, method)
   anything else. A failed call throws an ApiError with the server's Thai message and the HTTP status. */

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const credentials: { csrf: string | null; tenantId: string | null; customerCsrf: string | null; conversation: string | null } = {
  csrf: null,
  tenantId: null,
  customerCsrf: null,
  conversation: null,
};

export function setStaffCredentials(csrf: string | null | undefined, tenantId: string | null | undefined) {
  credentials.csrf = csrf ?? null;
  credentials.tenantId = tenantId ?? null;
}

export function setCustomerCredentials(csrf: string | null | undefined) {
  credentials.customerCsrf = csrf ?? null;
}

/** The customer's open chat: /api/public/<org>/session, /messages and /csat act on it. */
export function setConversation(id: string | null | undefined) {
  credentials.conversation = id ?? null;
}

function headers(hasBody: boolean): Record<string, string> {
  const result: Record<string, string> = {};
  if (credentials.csrf) result['X-CSRF-Token'] = credentials.csrf;
  if (credentials.tenantId) result['X-Tenant-ID'] = credentials.tenantId;
  if (credentials.customerCsrf) result['X-Customer-CSRF'] = credentials.customerCsrf;
  if (credentials.conversation) result['X-Conversation-ID'] = credentials.conversation;
  if (hasBody) result['Content-Type'] = 'application/json';
  return result;
}

async function send(path: string, body?: unknown, method?: Method): Promise<Response> {
  const hasBody = body !== undefined;
  let response: Response;
  try {
    response = await fetch(path, {
      method: method ?? (hasBody ? 'POST' : 'GET'),
      headers: headers(hasBody),
      body: hasBody ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('ติดต่อโปรแกรมไม่ได้ กรุณาตรวจสอบว่าหน้าต่าง Bookdose ยังเปิดอยู่', 0);
  }
  if (!response.ok) {
    let message = 'เกิดข้อผิดพลาด กรุณาลองใหม่';
    try {
      message = ((await response.json()) as { error?: string }).error || message;
    } catch {
      /* Not JSON: keep the general message. */
    }
    throw new ApiError(message, response.status);
  }
  return response;
}

export async function api<T = unknown>(path: string, body?: unknown, method?: Method): Promise<T> {
  const response = await send(path, body, method);
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
