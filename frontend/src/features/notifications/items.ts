'use client';

import type { ConversationSummary } from '@/features/inbox/types';
import { needsReply } from '@/features/inbox/hooks';
import { clockTime, dayLabel, formatDuration, overdue, plainText } from '@/lib/format';
import { channelIcons } from '@/lib/labels';
import { useApi } from '@/lib/query';
import { useStaffAlerts, useStaffTickets } from '@/lib/session';
import type { StaffAlerts, TicketSummary } from '@/lib/types';
import type { NotificationItem, NotificationKind } from './types';

export const notificationKinds: Record<NotificationKind, { label: string; icon: string }> = {
  me: { label: 'ถึงคุณ', icon: 'at' },
  ticket: { label: 'เคสบริการ', icon: 'ticket' },
  inbox: { label: 'กล่องข้อความ', icon: 'inbox' },
};

/** "10:32 น." today, "เมื่อวาน 10:32 น." or the date before that. */
function sinceText(at: string) {
  const day = dayLabel(new Date(at));
  return `${day === 'วันนี้' ? '' : day + ' '}${clockTime(at)} น.`;
}

export type NotificationSource = {
  alerts?: StaffAlerts | null;
  tickets?: TicketSummary[] | null;
  conversations?: ConversationSummary[] | null;
};

/* One list, newest first. A case that is past its SLA or still unassigned needs someone; a conversation whose
   last message came from the customer is waiting for a reply; and what is addressed to you: a case escalated to
   you, a follow-up reminder that is due, a colleague who @mentioned you or raised their hand for help. */
export function notificationItems({ alerts, tickets, conversations }: NotificationSource): NotificationItem[] {
  const items: NotificationItem[] = [];
  const now = Date.now();
  for (const c of alerts?.channels ?? [])
    items.push({
      kind: 'me',
      tone: 'late',
      icon: channelIcons[c.kind] || 'inbox',
      title: `${c.name} รับส่งข้อความไม่ได้ตั้งแต่ ${sinceText(c.since)}`,
      detail: c.error,
      at: c.since,
      href: `/settings?tab=${c.kind}`,
    });
  for (const e of alerts?.escalations ?? [])
    items.push({ kind: 'me', tone: 'late', icon: 'bolt', title: `BD-${e.number} ยกระดับมาหาคุณ`, detail: e.subject, at: e.escalated_at, href: `/tickets/${e.ticket_id}` });
  for (const f of alerts?.forecasts ?? [])
    items.push({
      kind: 'me',
      tone: 'waiting',
      icon: 'clock',
      title: `BD-${f.number} น่าจะเกิน SLA`,
      detail: `คาดว่า${f.kind === 'response' ? 'ตอบครั้งแรก' : 'ปิดเคส'}ช้าราว ${formatDuration(f.late_minutes)} · ${f.subject}`,
      at: f.alerted_at,
      href: `/tickets/${f.ticket_id}`,
    });
  for (const f of alerts?.followups ?? [])
    if (new Date(f.due_at).getTime() <= now)
      items.push({ kind: 'me', tone: 'waiting', icon: 'clock', title: `ถึงเวลาติดตาม BD-${f.number}`, detail: f.note, at: f.due_at, href: `/tickets/${f.ticket_id}` });
  // ยกมือขอช่วย: a colleague stuck on a case this member can see, or who is coming to their own.
  for (const h of alerts?.hands ?? [])
    items.push(
      h.kind === 'ask'
        ? { kind: 'me', tone: 'waiting', icon: 'hand', title: `${h.raised_name} ยกมือขอช่วย BD-${h.number}`, detail: h.note || h.subject, at: h.raised_at, href: `/tickets/${h.ticket_id}` }
        : { kind: 'me', tone: 'new', icon: 'hand', title: `${h.helper_name} กำลังมาช่วยเคส BD-${h.number}`, detail: h.subject, at: h.raised_at, href: `/tickets/${h.ticket_id}` },
    );
  for (const m of alerts?.mentions ?? [])
    items.push({
      kind: 'me',
      tone: 'new',
      icon: 'at',
      title: `${m.author_name} กล่าวถึงคุณ`,
      detail: plainText(m.body).slice(0, 120),
      at: m.created_at,
      href: m.ticket_id ? `/tickets/${m.ticket_id}` : `/inbox/${m.conversation_id}`,
    });
  for (const t of tickets ?? []) {
    if (overdue(t)) items.push({ kind: 'ticket', tone: 'late', icon: 'clock', title: `BD-${t.number} เกินกำหนด SLA`, detail: t.subject, at: t.updated_at, href: `/tickets/${t.id}` });
    else if (t.status === 'new' && !t.assignee_id)
      items.push({ kind: 'ticket', tone: 'new', icon: 'ticket', title: `BD-${t.number} ยังไม่มีผู้รับผิดชอบ`, detail: t.subject, at: t.created_at, href: `/tickets/${t.id}` });
  }
  for (const c of conversations ?? [])
    if (needsReply(c))
      items.push({
        kind: 'inbox',
        tone: 'waiting',
        icon: channelIcons[c.channel] || 'chat',
        title: `${c.contact_name} รอคำตอบ`,
        detail: c.subject,
        at: c.updated_at,
        href: `/inbox/${c.id}`,
      });
  return items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

export const CONVERSATIONS_PATH = '/api/conversations';

/** The conversation list as last loaded (inbox, notifications, the bell); not fetched just for this. */
export function useCachedConversations(fetch = false) {
  return useApi<{ conversations: ConversationSummary[] }>(CONVERSATIONS_PATH, { enabled: fetch });
}

/** What is waiting for the team, from the cases, the member's alerts and the conversations already loaded. */
export function useNotificationItems(fetchConversations = false): NotificationItem[] {
  const alerts = useStaffAlerts().data;
  const tickets = useStaffTickets().data?.tickets;
  const conversations = useCachedConversations(fetchConversations).data?.conversations;
  return notificationItems({ alerts, tickets, conversations });
}

/** The number on the bell. */
export function useNotificationCount(): number {
  return useNotificationItems().length;
}
