'use client';

import { useEffect, useRef } from 'react';
import { needsReply } from '@/features/inbox/hooks';
import type { ConversationSummary } from '@/features/inbox/types';
import { isDone, overdue, plainText } from '@/lib/format';
import { useApi } from '@/lib/query';
import { useRealtimeInterval } from '@/lib/realtime-provider';
import { useStaffAlerts, useStaffTickets } from '@/lib/session';
import { playSound, showDesktop } from './alerts';
import { usePreferences, type NotifyEvent } from './prefs';

/* The desktop notification and sound of ตั้งค่าบัญชี → การแจ้งเตือน, run by the staff frame while a workspace is open.
   It watches what the page already loads (the cases, the member's alerts, and - when customer answers are wanted -
   the conversation list) and speaks up only about something new since the page opened: a case now assigned to the
   member or escalated to them, their case past its SLA, a customer answering on their case. */

/** urgent: escalated to the member, past its SLA or an urgent case - it gets the firmer sound. */
type WorkEvent = { key: string; event: NotifyEvent; title: string; body: string; href: string; urgent?: boolean };

export function useWorkAlerts(userId: string, enabled: boolean) {
  const notify = usePreferences(enabled).data?.preferences.notify;
  const active = Boolean(enabled && notify && (notify.desktop || notify.sound));
  const tickets = useStaffTickets().data?.tickets;
  const alerts = useStaffAlerts().data;
  const interval = useRealtimeInterval(30000);
  const conversations = useApi<{ conversations: ConversationSummary[] }>('/api/conversations', {
    enabled: Boolean(active && notify?.events.customer_reply),
    refetchInterval: interval,
  }).data?.conversations;
  // What was already there is never announced: each source is taken in silently the first time it arrives.
  const seen = useRef(new Set<string>());
  const seeded = useRef({ tickets: false, conversations: false });

  useEffect(() => {
    if (!active || !notify || !tickets) return;
    const found: WorkEvent[] = [];
    const ticketEvents: WorkEvent[] = [];
    for (const t of tickets) {
      if (t.assignee_id !== userId || isDone(t)) continue;
      ticketEvents.push({ key: `assigned:${t.id}`, event: 'assigned', title: `เคส BD-${t.number} มอบหมายให้คุณ`, body: t.subject, href: `/tickets/${t.id}`, urgent: t.priority === 'urgent' });
      if (overdue(t)) ticketEvents.push({ key: `sla:${t.id}`, event: 'sla', title: `เคส BD-${t.number} เกินกำหนด SLA`, body: t.subject, href: `/tickets/${t.id}`, urgent: true });
    }
    for (const e of alerts?.escalations ?? [])
      ticketEvents.push({ key: `escalated:${e.ticket_id}`, event: 'assigned', title: `เคส BD-${e.number} ยกระดับมาหาคุณ`, body: e.subject, href: `/tickets/${e.ticket_id}`, urgent: true });
    // Every waiting message is taken in, whoever owns it: a case handed over later is "assigned", not a new answer.
    const conversationEvents: (WorkEvent & { mine: boolean })[] = [];
    if (conversations) {
      const owner = new Map(tickets.map((t) => [t.id, t.assignee_id]));
      for (const c of conversations)
        if (needsReply(c))
          conversationEvents.push({
            key: `reply:${c.id}:${c.updated_at}`,
            event: 'customer_reply',
            title: `${c.contact_name} ตอบกลับในเคสของคุณ`,
            body: plainText(c.preview || c.subject).slice(0, 120),
            href: `/inbox/${c.id}`,
            mine: Boolean(c.ticket_id && owner.get(c.ticket_id) === userId),
          });
    }
    for (const [source, events] of [
      ['tickets', ticketEvents.map((item) => ({ ...item, mine: true }))],
      ['conversations', conversationEvents],
    ] as const) {
      if (source === 'conversations' && !conversations) continue;
      const first = !seeded.current[source];
      seeded.current[source] = true;
      for (const item of events) {
        if (seen.current.has(item.key)) continue;
        seen.current.add(item.key);
        if (!first && item.mine && notify.events[item.event]) found.push(item);
      }
    }
    if (!found.length) return;
    if (notify.sound) playSound(found.some((item) => item.urgent) ? 'urgent' : 'alert');
    if (notify.desktop) for (const item of found.slice(0, 3)) showDesktop(item.title, item.body, item.href, item.key);
  }, [active, notify, tickets, alerts, conversations, userId]);
}
