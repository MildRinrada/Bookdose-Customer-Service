/* Realtime hints from the API (docs/realtime.md). One WebSocket per page to the same origin as every other
   request; Next.js forwards /api/* to the Python server, upgrades included. The socket carries hints only: an event
   says what changed and the page asks the REST API again (src/lib/realtime-provider.tsx maps events to queries).
   `typing` and `read` are the only events shown as they arrive.

   The legacy server has no WebSocket: the connection simply never says hello, `connected` stays false and every screen
   keeps polling as before. */

export type RealtimeKind = 'staff' | 'customer' | 'guest';

export type ChangedScope = 'conversation' | 'conversations' | 'ticket' | 'tickets' | 'alerts';

export type RealtimeEvent =
  | { type: 'hello'; poll_ms?: number }
  | { type: 'changed'; scope: ChangedScope; id?: string; org?: string }
  | { type: 'typing'; conversation_id: string; org?: string; who: 'staff' | 'customer'; name?: string; ttl_ms?: number }
  /** Staff only: a member of the team has this conversation open (typing: and is writing in it). */
  | { type: 'here'; conversation_id: string; org?: string; user_id: string; name?: string; typing?: boolean; ttl_ms?: number; typing_ms?: number }
  | { type: 'read'; conversation_id: string; org?: string; by: 'staff' | 'customer'; at: string }
  | { type: 'ping' };

/** Client → server frames. `viewing` is the staff pages' heartbeat: "I have this conversation open". */
export type RealtimeFrame = { type: 'typing' | 'viewing'; conversation_id: string } | { type: 'pong' };

export const realtimePath = (kind: RealtimeKind, org?: string) =>
  kind === 'staff' ? '/api/realtime/staff' : kind === 'customer' ? '/api/realtime/customer' : `/api/public/${org}/guest/realtime`;

/** Server close codes: 4401 not signed in (or the session changed organization), 4403 wrong origin/host or guest chat
    off, 4429 too many sockets or frames. Others (4408 idle, 1013 backlog, 1011 server error) simply reconnect. */
export const CLOSE_UNAUTHORIZED = 4401;
export const CLOSE_FORBIDDEN = 4403;
export const CLOSE_RATE_LIMITED = 4429;

const MIN_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;
/** The server pings every 25 s; nothing for this long means the connection is dead even if the browser has not noticed. */
const SILENCE_MS = 70000;
/** A tab hidden this long lets its socket go; showing the tab again reconnects and catches up. */
const HIDDEN_PAUSE_MS = 5 * 60 * 1000;

export type RealtimeOptions = {
  path: string;
  onEvent: (event: RealtimeEvent) => void;
  onConnected: (connected: boolean) => void;
  /** Connected again after having been connected before (events may have been missed). */
  onResync: () => void;
  /** Closed by the server with one of the codes above. */
  onRejected?: (code: number) => void;
};

function parse(data: unknown): RealtimeEvent | null {
  if (typeof data !== 'string' || data.length > 16000) return null;
  try {
    const event = JSON.parse(data) as { type?: unknown };
    return event && typeof event === 'object' && typeof event.type === 'string' ? (event as RealtimeEvent) : null;
  } catch {
    return null;
  }
}

export class RealtimeClient {
  private readonly options: RealtimeOptions;
  private socket: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private silenceTimer: ReturnType<typeof setTimeout> | undefined;
  private hiddenTimer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private paused = false;
  private hadHello = false;
  private connected = false;
  /** Closed 4401: no retry until the tab comes back after a long pause, or the provider connects as someone else. */
  private refused = false;

  constructor(options: RealtimeOptions) {
    this.options = options;
  }

  start() {
    if (this.running || typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
    this.running = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('focus', this.onWake);
    window.addEventListener('online', this.onWake);
    this.connect();
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('focus', this.onWake);
    window.removeEventListener('online', this.onWake);
    clearTimeout(this.retryTimer);
    clearTimeout(this.hiddenTimer);
    this.drop();
  }

  /** Sends a frame when connected; otherwise nothing happens (typing is best effort). */
  send(frame: RealtimeFrame): boolean {
    if (!this.connected || this.socket?.readyState !== WebSocket.OPEN) return false;
    try {
      this.socket.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  }

  private url() {
    const { protocol, host } = window.location;
    return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}${this.options.path}`;
  }

  private setConnected(value: boolean) {
    if (this.connected === value) return;
    this.connected = value;
    this.options.onConnected(value);
  }

  private connect() {
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    if (!this.running || this.paused || this.refused || this.socket) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url());
    } catch {
      this.retry();
      return;
    }
    this.socket = socket;
    this.listen();
    socket.onmessage = (message) => {
      if (this.socket !== socket) return;
      this.listen();
      const event = parse(message.data);
      if (!event) return;
      if (event.type === 'ping') {
        this.send({ type: 'pong' });
        return;
      }
      if (event.type === 'hello') {
        this.attempt = 0;
        const again = this.hadHello;
        this.hadHello = true;
        this.setConnected(true);
        if (again) this.options.onResync();
      }
      this.options.onEvent(event);
    };
    socket.onclose = (close) => {
      if (this.socket !== socket) return;
      this.socket = null;
      clearTimeout(this.silenceTimer);
      this.setConnected(false);
      if (!this.running || this.paused) return;
      const refused = [CLOSE_UNAUTHORIZED, CLOSE_FORBIDDEN, CLOSE_RATE_LIMITED].includes(close.code);
      if (refused) this.options.onRejected?.(close.code);
      // Not signed in with this session: asking again changes nothing until the session does.
      if (close.code === CLOSE_UNAUTHORIZED) this.refused = true;
      else this.retry(refused);
    };
  }

  /** Any frame proves the connection is alive; a long silence drops it and connects again. */
  private listen() {
    clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      this.drop();
      this.retry();
    }, SILENCE_MS);
  }

  /** Closes the current socket without waiting for its close event. */
  private drop() {
    clearTimeout(this.silenceTimer);
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onmessage = null;
      socket.onclose = null;
      try {
        socket.close(1000);
      } catch {
        /* Already closed. */
      }
    }
    this.setConnected(false);
  }

  /** Exponential backoff 1 s → 30 s with jitter (half to full delay). Refused connections wait the longest. */
  private retry(slow = false) {
    if (!this.running || this.paused || this.refused || this.retryTimer) return;
    const ceiling = slow ? MAX_RETRY_MS : Math.min(MAX_RETRY_MS, MIN_RETRY_MS * 2 ** this.attempt);
    this.attempt += 1;
    const delay = ceiling / 2 + Math.random() * (ceiling / 2);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private onVisibility = (event: Event) => {
    if (document.visibilityState === 'hidden') {
      clearTimeout(this.hiddenTimer);
      this.hiddenTimer = setTimeout(() => {
        this.paused = true;
        clearTimeout(this.retryTimer);
        this.retryTimer = undefined;
        this.drop();
      }, HIDDEN_PAUSE_MS);
    } else this.onWake(event);
  };

  /** Back to the tab after a pause, or the network is back: connect now if the socket is not there. A short absence
      keeps its socket, or its pending retry. */
  private onWake = (event?: Event) => {
    if (document.visibilityState === 'hidden') return;
    clearTimeout(this.hiddenTimer);
    const wasPaused = this.paused;
    this.paused = false;
    if (wasPaused) this.refused = false;
    if (this.socket || (!wasPaused && event?.type !== 'online')) return;
    this.attempt = 0;
    this.connect();
  };
}
