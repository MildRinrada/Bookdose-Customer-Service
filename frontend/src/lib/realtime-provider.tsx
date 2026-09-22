'use client';

import { useQueryClient, type Query } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { CLOSE_UNAUTHORIZED, RealtimeClient, realtimePath, type RealtimeEvent, type RealtimeFrame, type RealtimeKind } from './realtime';

/* The realtime connection of one frame: the staff shell, the customer shell, or the guest chat (full page and embed).
   Events become query invalidations (the page asks the REST API again, which keeps every permission rule there);
   `typing` and `read` are kept here for the message thread to show. While connected the screens poll only as a
   safety net (useRealtimeInterval); without a connection nothing changes. */

const DEFAULT_POLL_MS = 60000;
/** Events in a burst (a message, its status and the list) become one round of refetching. */
const DEBOUNCE_MS = 150;
const TYPING_THROTTLE_MS = 3000;

type Side = 'staff' | 'customer';

/** A colleague who has a conversation open (`typing` while they are writing in it). */
export type Colleague = { id: string; name: string; typing: boolean };

type HereEntry = { name: string; typing: boolean; timer: ReturnType<typeof setTimeout>; typingTimer?: ReturnType<typeof setTimeout> };

const NOBODY: Colleague[] = [];

const same = (a: Colleague[], b: Colleague[]) =>
  a.length === b.length && a.every((x, i) => x.id === b[i].id && x.name === b[i].name && x.typing === b[i].typing);

/** Typing, read and who-is-here state from events, read with useSyncExternalStore. */
class LiveStore {
  private typing = new Map<string, { who: Side; name: string; timer: ReturnType<typeof setTimeout> }>();
  private reads = new Map<string, string>();
  /** conversation id → member id → their presence, and the array the hooks hand out (kept stable between changes). */
  private here = new Map<string, Map<string, HereEntry>>();
  private hereShown = new Map<string, Colleague[]>();
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify() {
    this.listeners.forEach((listener) => listener());
  }

  typingName(conversationId: string, who: Side): string | null {
    const entry = this.typing.get(conversationId);
    return entry && entry.who === who ? entry.name : null;
  }

  readAt(conversationId: string, by: Side): string | null {
    return this.reads.get(`${conversationId}|${by}`) ?? null;
  }

  setTyping(conversationId: string, who: Side, name: string, ttl: number) {
    const current = this.typing.get(conversationId);
    if (current) clearTimeout(current.timer);
    const timer = setTimeout(() => this.clearTyping(conversationId), ttl);
    this.typing.set(conversationId, { who, name, timer });
    if (!current || current.who !== who || current.name !== name) this.notify();
  }

  clearTyping(conversationId: string) {
    const current = this.typing.get(conversationId);
    if (!current) return;
    clearTimeout(current.timer);
    this.typing.delete(conversationId);
    this.notify();
  }

  /* Who else has this conversation open. Every member's page says so every 15 seconds and whenever they write, so an
     entry that stops arriving simply expires: nothing has to be told when a browser is closed or a laptop is shut. */

  hereIn(conversationId: string): Colleague[] {
    return this.hereShown.get(conversationId) ?? NOBODY;
  }

  setHere(conversationId: string, userId: string, name: string, typing: boolean, ttl: number, typingTtl: number) {
    const room = this.here.get(conversationId) ?? new Map<string, HereEntry>();
    this.here.set(conversationId, room);
    const before = room.get(userId);
    if (before) {
      clearTimeout(before.timer);
      clearTimeout(before.typingTimer);
    }
    const entry: HereEntry = {
      name,
      typing,
      timer: setTimeout(() => {
        room.delete(userId);
        this.showHere(conversationId);
      }, ttl),
    };
    // Writing stops long before the page does: the typing mark fades on its own, the presence stays.
    if (typing)
      entry.typingTimer = setTimeout(() => {
        entry.typing = false;
        this.showHere(conversationId);
      }, typingTtl);
    room.set(userId, entry);
    this.showHere(conversationId);
  }

  private showHere(conversationId: string) {
    const room = this.here.get(conversationId);
    if (!room?.size) {
      this.here.delete(conversationId);
      this.hereShown.delete(conversationId);
      this.notify();
      return;
    }
    const next = [...room].map(([id, entry]) => ({ id, name: entry.name, typing: entry.typing }));
    // A heartbeat that says what the screen already shows must not redraw it.
    if (same(this.hereIn(conversationId), next)) return;
    this.hereShown.set(conversationId, next);
    this.notify();
  }

  setRead(conversationId: string, by: Side, at: string) {
    const key = `${conversationId}|${by}`;
    const before = this.reads.get(key);
    if (before && Date.parse(before) >= Date.parse(at)) return;
    this.reads.set(key, at);
    this.notify();
  }

  clear() {
    this.typing.forEach((entry) => clearTimeout(entry.timer));
    this.typing.clear();
    this.here.forEach((room) =>
      room.forEach((entry) => {
        clearTimeout(entry.timer);
        clearTimeout(entry.typingTimer);
      }),
    );
    this.here.clear();
    this.hereShown.clear();
    this.reads.clear();
    this.notify();
  }
}

type RealtimeValue = {
  connected: boolean;
  /** How often screens poll while connected (the server's hello says, 60 s by default). */
  pollMs: number;
  kind: RealtimeKind | null;
  store: LiveStore | null;
  send: (frame: RealtimeFrame) => boolean;
};

const RealtimeContext = createContext<RealtimeValue>({ connected: false, pollMs: DEFAULT_POLL_MS, kind: null, store: null, send: () => false });

/* Which cached queries an event touches. A target is a query key rule:
     =path   exactly that key          ^prefix   keys starting with it
     ~part   keys containing it        @ticket:<conversation id>   a case screen showing that conversation */
function eventTargets(kind: RealtimeKind, event: Extract<RealtimeEvent, { type: 'changed' }>, org: string | undefined): string[] {
  const id = typeof event.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(event.id) ? event.id : '';
  if (kind === 'staff') {
    const overview = ['=/api/automation/alerts', '^/api/automation/overview'];
    switch (event.scope) {
      case 'conversation':
        // A new message moves the list too (preview, waiting for a reply); a note may @mention the member.
        return id ? [`=/api/conversations/${id}`, '=/api/conversations', `@ticket:${id}`, '=/api/automation/alerts'] : ['^/api/conversations'];
      case 'conversations':
        return ['=/api/conversations', ...overview];
      case 'ticket':
        return id ? [`=/api/tickets/${id}`, '=/api/tickets', ...overview] : ['^/api/tickets', ...overview];
      case 'tickets':
        return ['=/api/tickets', ...overview];
      default:
        return overview;
    }
  }
  if (kind === 'customer') {
    // The overview holds the chat list, the unread marks, the cases and the bell.
    const overview = '=/api/customer/overview';
    switch (event.scope) {
      case 'conversation':
        // features/customer/api.ts sessionKey: /api/public/<org>/session?conversation=<id>
        return id ? [`~/session?conversation=${id}`, overview] : [overview];
      case 'ticket':
        // features/customer/api.ts casePath: /api/public/<org>/cases/<id>
        return id ? [`~/cases/${id}`, overview, '=/api/customer/dashboard'] : [overview, '=/api/customer/dashboard'];
      case 'tickets':
        return [overview, '=/api/customer/dashboard'];
      default:
        return [overview];
    }
  }
  // Guest: features/guest/api.ts guestPath and guestSessionKey.
  const base = `/api/public/${org}/guest`;
  return event.scope === 'conversation' && id ? [`=${base}/session?conversation=${id}`, `=${base}`] : [`=${base}`];
}

/** Everything an event could have touched, after a reconnect (events may have been missed meanwhile). */
function resyncTargets(kind: RealtimeKind, org: string | undefined): string[] {
  if (kind === 'staff') return ['^/api/conversations', '^/api/tickets', '=/api/automation/alerts', '^/api/automation/overview'];
  if (kind === 'customer') return ['=/api/customer/overview', '~/session?conversation=', '~/cases/', '=/api/customer/dashboard'];
  return [`^/api/public/${org}/guest`];
}

function matches(target: string, key: string, query: Query): boolean {
  const rule = target[0];
  const value = target.slice(1);
  if (rule === '=') return key === value;
  if (rule === '^') return key.startsWith(value);
  if (rule === '~') return key.includes(value);
  if (target.startsWith('@ticket:')) {
    if (!/^\/api\/tickets\/[^/?]+$/.test(key)) return false;
    const conversationId = target.slice('@ticket:'.length);
    const data = query.state.data as { conversations?: Array<{ id?: string }> } | undefined;
    return Boolean(data?.conversations?.some((c) => c.id === conversationId));
  }
  return false;
}

type ProviderProps = {
  kind: RealtimeKind;
  /** staff: the workspace's slug (events of another organization are ignored); guest: the organization. */
  org?: string;
  /** Connect only when there is someone to connect as (a guest without a cookie has nothing to hear). */
  enabled?: boolean;
  /** Who is connected (the organization selected, the account, the guest cookie): a change connects anew. */
  identity?: string | null;
  children: ReactNode;
};

export function RealtimeProvider({ kind, org, enabled = true, identity = '', children }: ProviderProps) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [pollMs, setPollMs] = useState(DEFAULT_POLL_MS);
  const [store] = useState(() => new LiveStore());
  const socket = useRef<RealtimeClient | null>(null);
  const path = realtimePath(kind, org);

  // --- Invalidation, debounced and held while the tab is hidden (a hidden chat must not count as read) ---
  const pending = useRef({ targets: new Set<string>(), typingDone: new Set<string>(), timer: undefined as ReturnType<typeof setTimeout> | undefined });

  const flush = useCallback(() => {
    const batch = pending.current;
    batch.timer = undefined;
    if (document.visibilityState === 'hidden' || !batch.targets.size) return;
    const targets = [...batch.targets];
    const typingDone = [...batch.typingDone];
    batch.targets.clear();
    batch.typingDone.clear();
    void queryClient
      .invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && targets.some((target) => matches(target, key, query));
        },
      })
      .catch(() => {})
      // The typing bubble gives way to the message once it is on the screen.
      .finally(() => typingDone.forEach((id) => store.clearTyping(id)));
  }, [queryClient, store]);

  const schedule = useCallback(
    (targets: string[], typingDone?: string) => {
      const batch = pending.current;
      targets.forEach((target) => batch.targets.add(target));
      if (typingDone) batch.typingDone.add(typingDone);
      if (batch.timer === undefined) batch.timer = setTimeout(flush, DEBOUNCE_MS);
    },
    [flush],
  );

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && pending.current.targets.size && pending.current.timer === undefined) flush();
    };
    document.addEventListener('visibilitychange', onVisible);
    const batch = pending.current;
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(batch.timer);
      batch.timer = undefined;
    };
  }, [flush]);

  // --- Events ---
  const handlers = useRef({
    event: (event: RealtimeEvent) => void event,
    resync: () => {},
    rejected: (code: number) => void code,
  });
  useEffect(() => {
    const otherOrg = (eventOrg: unknown) => kind !== 'customer' && Boolean(org) && typeof eventOrg === 'string' && eventOrg !== org;
    handlers.current = {
      event: (event) => {
        switch (event.type) {
          case 'hello':
            setPollMs(typeof event.poll_ms === 'number' && event.poll_ms > 0 ? Math.min(Math.max(event.poll_ms, 15000), 300000) : DEFAULT_POLL_MS);
            break;
          case 'changed':
            if (otherOrg(event.org)) break;
            schedule(eventTargets(kind, event, org), event.scope === 'conversation' && event.id ? event.id : undefined);
            break;
          case 'typing': {
            if (otherOrg(event.org) || typeof event.conversation_id !== 'string') break;
            if (event.who !== 'staff' && event.who !== 'customer') break;
            const ttl = typeof event.ttl_ms === 'number' ? Math.min(Math.max(event.ttl_ms, 1000), 15000) : 6000;
            store.setTyping(event.conversation_id, event.who, String(event.name ?? '').slice(0, 80), ttl);
            break;
          }
          case 'here': {
            // Staff only: nobody else is ever sent one, and no other frame has a use for it.
            if (kind !== 'staff' || otherOrg(event.org) || typeof event.conversation_id !== 'string' || typeof event.user_id !== 'string') break;
            const ttl = typeof event.ttl_ms === 'number' ? Math.min(Math.max(event.ttl_ms, 5000), 120000) : 25000;
            const typingTtl = typeof event.typing_ms === 'number' ? Math.min(Math.max(event.typing_ms, 1000), 15000) : 6000;
            store.setHere(event.conversation_id, event.user_id, String(event.name ?? '').slice(0, 80), Boolean(event.typing), ttl, typingTtl);
            break;
          }
          case 'read':
            if (otherOrg(event.org) || typeof event.conversation_id !== 'string' || Number.isNaN(Date.parse(event.at))) break;
            if (event.by !== 'staff' && event.by !== 'customer') break;
            store.setRead(event.conversation_id, event.by, event.at);
            break;
        }
      },
      resync: () => schedule(resyncTargets(kind, org)),
      rejected: (code) => {
        // Signed out or the cookie is gone: ask who this is again; the frame then leaves (or shows the start form).
        if (code !== CLOSE_UNAUTHORIZED) return;
        const key = kind === 'staff' ? '/api/bootstrap' : kind === 'customer' ? '/api/customer/account' : `/api/public/${org}/guest`;
        void queryClient.invalidateQueries({ queryKey: [key] });
      },
    };
  });

  useEffect(() => {
    if (!enabled) return;
    const client = new RealtimeClient({
      path,
      onEvent: (event) => handlers.current.event(event),
      onConnected: setConnected,
      onResync: () => handlers.current.resync(),
      onRejected: (code) => handlers.current.rejected(code),
    });
    socket.current = client;
    client.start();
    return () => {
      client.stop();
      if (socket.current === client) socket.current = null;
      store.clear();
    };
  }, [enabled, identity, path, store]);

  const send = useCallback((frame: RealtimeFrame) => socket.current?.send(frame) ?? false, []);
  const live = connected && enabled;
  const value = useMemo<RealtimeValue>(() => ({ connected: live, pollMs, kind, store, send }), [live, pollMs, kind, store, send]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeValue {
  return useContext(RealtimeContext);
}

/** A screen's polling interval: as given without a realtime connection, only a slow safety net while connected. */
export function useRealtimeInterval<T extends number | false>(ms: T): T | number {
  const { connected, pollMs } = useRealtime();
  return connected && ms !== false ? Math.max(ms, pollMs) : ms;
}

const noSubscribe = () => () => {};

/** The name of whoever on `who`'s side is typing in the conversation, or null. */
export function useTyping(conversationId: string, who: Side): string | null {
  const { store } = useRealtime();
  return useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    () => store?.typingName(conversationId, who) ?? null,
    () => null,
  );
}

/** When `by`'s side last read the conversation (from a read event), or null. */
export function useReadAt(conversationId: string, by: Side): string | null {
  const { store } = useRealtime();
  return useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    () => store?.readAt(conversationId, by) ?? null,
    () => null,
  );
}

/* Two members answering the same customer at once (the team's side only).

   Every staff screen that has a conversation open says so every 15 seconds, and writing in it says so at once. What
   comes back is the rest of the team doing the same, so a member about to answer can see that somebody is already on
   it. Nothing is blocked and nothing is claimed: this is a room people can see into, not a lock. Presence lives only
   in the open sockets, so a shut laptop stops saying it within half a minute without having to tell anybody. */

const HERE_BEAT_MS = 15000;

/** Says "I have this conversation open" while the tab is in front. Staff pages only. */
export function useViewing(conversationId: string) {
  const { connected, send } = useRealtime();
  useEffect(() => {
    if (!connected || !conversationId) return;
    const beat = () => {
      if (document.visibilityState === 'visible') send({ type: 'viewing', conversation_id: conversationId });
    };
    beat();
    const timer = setInterval(beat, HERE_BEAT_MS);
    document.addEventListener('visibilitychange', beat);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', beat);
    };
  }, [connected, send, conversationId]);
}

/** The colleagues who have this conversation open, never the reader themselves. */
export function useHere(conversationId: string, meId: string): Colleague[] {
  const { store } = useRealtime();
  const all = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    () => store?.hereIn(conversationId) ?? NOBODY,
    () => NOBODY,
  );
  return useMemo(() => {
    const others = all.filter((c) => c.id !== meId);
    return others.length ? others : NOBODY;
  }, [all, meId]);
}

/** Call with the composer's text as it changes: tells the other side "typing", at most once every 3 seconds, and only
    while there is text. Only for replies the customer will see (never from the staff internal note). */
export function useTypingNotifier(conversationId: string) {
  const { connected, send } = useRealtime();
  const last = useRef(0);
  return useCallback(
    (text: string) => {
      if (!connected || !text.trim()) return;
      const now = Date.now();
      if (now - last.current < TYPING_THROTTLE_MS) return;
      if (send({ type: 'typing', conversation_id: conversationId })) last.current = now;
    },
    [connected, send, conversationId],
  );
}
