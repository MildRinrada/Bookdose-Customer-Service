'use client';

import { useEffect, useRef } from 'react';
import { showPopup } from '@/components/ui/Popups';
import { playSound } from '@/features/staff-account/alerts';
import { customerUnread } from '@/lib/customer-session';
import { plainText } from '@/lib/format';
import { useApi } from '@/lib/query';
import { useRealtimeInterval } from '@/lib/realtime-provider';
import { NOTIFY_SETTINGS_PATH, OVERVIEW_PATH } from './api';
import type { CustomerChat, NotificationSettings, OverviewData } from './types';

/* The customer frame's pop-up and sound (ตั้งค่าบัญชี → การแจ้งเตือน → ขณะเปิดหน้าเว็บนี้อยู่): when the team answers in
   one of their chats while the page is open, a card at the bottom right (components/ui/Popups) that opens the chat.
   Only what arrives after the page opened, never for the chat already on screen, and nothing while the page is in
   another tab (email and LINE are for that). */

export function useReplyPopups() {
  const page = useApi<NotificationSettings>(NOTIFY_SETTINGS_PATH).data?.page;
  const popup = page?.popup !== false;
  const sound = page?.sound !== false;
  const interval = useRealtimeInterval(30000);
  const chats = useApi<OverviewData>(OVERVIEW_PATH, { refetchInterval: interval }).data?.conversations;
  // What was already there is never announced: the first list is taken in silently.
  const seen = useRef(new Set<string>());
  const seeded = useRef(false);

  useEffect(() => {
    if (!chats) return;
    const first = !seeded.current;
    seeded.current = true;
    const visible = document.visibilityState === 'visible';
    const path = window.location.pathname;
    const fresh: { c: CustomerChat; key: string; href: string }[] = [];
    for (const c of chats) {
      if (!customerUnread(c)) continue;
      const key = `reply:${c.id}:${c.updated_at}`;
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      const href = `/customer/chats/${c.org_slug}/${c.id}`;
      if (!first && visible && path !== href) fresh.push({ c, key, href });
    }
    if (!fresh.length || !popup) return;
    if (sound) playSound('message');
    for (const { c, key, href } of fresh.slice(-3))
      showPopup({ key, kind: 'message', label: `${c.org_name} ตอบแล้ว`, title: c.subject, body: plainText(c.last_body ?? '').slice(0, 120), href });
  }, [chats, popup, sound]);
}
