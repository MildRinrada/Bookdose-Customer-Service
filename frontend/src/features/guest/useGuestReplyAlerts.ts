'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { showPopup } from '@/components/ui/Popups';
import type { Message } from '@/features/inbox/types';
import { playSound } from '@/features/staff-account/alerts';
import { unreadCount } from './labels';
import type { GuestConversation } from './types';

/* A visitor without an account hears the team answer (docs/features/support-page-and-guest-chat.md): a short sound
   when a reply lands in the chat on screen - also from another tab, which is when it matters while they wait - and a
   pop-up with the sound when one lands in another chat of this browser (on the page itself only; inside a website's
   frame only the sound, and only while the panel is open). Only what arrives after the page opened. The sound can be
   turned off from the chat's menu; this browser remembers it. */

const SOUND_KEY = 'bookdose.guest-sound';
const listeners = new Set<() => void>();
let muted: boolean | null = null;

function readMuted(): boolean {
  if (muted === null) {
    try {
      muted = localStorage.getItem(SOUND_KEY) === 'off';
    } catch {
      muted = false;
    }
  }
  return muted;
}

/** [sound on, turn it on or off]: remembered by this browser (for this page only when it refuses storage). */
export function useGuestSound(): [boolean, (on: boolean) => void] {
  const off = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readMuted,
    () => false,
  );
  const set = useCallback((on: boolean) => {
    muted = !on;
    try {
      if (on) localStorage.removeItem(SOUND_KEY);
      else localStorage.setItem(SOUND_KEY, 'off');
    } catch {
      /* Still holds for this page. */
    }
    listeners.forEach((listener) => listener());
  }, []);
  return [!off, set];
}

export function useGuestReplyAlerts({
  orgName,
  list,
  current,
  shown,
  embed,
  panelOpen,
  onOpen,
}: {
  orgName: string;
  list: GuestConversation[];
  current: string | null;
  /** The chat whose messages are on screen, as its session answered (it may still be the one before `current`). */
  shown: { id: string; messages: Message[] } | undefined;
  embed: boolean;
  panelOpen: boolean;
  onOpen: (id: string) => void;
}) {
  const [sound] = useGuestSound();

  // The chat on screen: its newest reply, taken in silently whenever another chat's messages arrive.
  const lastReply = useRef<{ chat: string | null; id: string | null }>({ chat: null, id: null });
  useEffect(() => {
    if (!shown) return;
    const newest = [...shown.messages].reverse().find((m) => m.kind === 'reply')?.id ?? null;
    const seen = lastReply.current;
    const fresh = seen.chat === shown.id && newest !== null && newest !== seen.id;
    lastReply.current = { chat: shown.id, id: newest };
    if (fresh && sound && (!embed || panelOpen)) playSound('message');
  }, [shown, sound, embed, panelOpen]);

  // The other chats of this browser: a reply not read yet, announced once.
  const seen = useRef(new Set<string>());
  const seeded = useRef(false);
  useEffect(() => {
    const first = !seeded.current;
    seeded.current = true;
    const fresh: GuestConversation[] = [];
    for (const c of list) {
      if (!unreadCount(c)) continue;
      const key = `reply:${c.id}:${c.updated_at}`;
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      if (!first && c.id !== current) fresh.push(c);
    }
    if (!fresh.length || embed || document.visibilityState !== 'visible') return;
    if (sound) playSound('message');
    for (const c of fresh.slice(-3))
      showPopup({ key: `guest:${c.id}:${c.updated_at}`, kind: 'message', label: `${orgName} ตอบแล้ว`, title: c.subject, body: 'กดเพื่ออ่านคำตอบ', href: '', open: () => onOpen(c.id) });
  }, [list, current, embed, sound, orgName, onOpen]);
}
