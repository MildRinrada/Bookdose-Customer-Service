'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import type { StaffAlerts } from '@/lib/types';
import { markMentionsRead } from './api';
import type { ConversationSummary } from './types';

/** The customer spoke last and the conversation is still open. */
export function needsReply(c: Pick<ConversationSummary, 'last_public_kind' | 'status'>): boolean {
  return c.last_public_kind === 'customer' && c.status === 'open';
}

/** "⌘+Enter" on Apple devices, "Ctrl+Enter" elsewhere. */
export const SEND_SHORTCUT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘+Enter' : 'Ctrl+Enter';

const SINGLE_PANE = '(max-width:1000px)';

function subscribeSinglePane(onChange: () => void) {
  const query = window.matchMedia(SINGLE_PANE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** Below 1000 px the inbox (and the customer's chats) show one pane at a time: the list, or the conversation with a
    back button. */
export function useSinglePane(): boolean {
  return useSyncExternalStore(
    subscribeSinglePane,
    () => window.matchMedia(SINGLE_PANE).matches,
    () => false,
  );
}

function subscribeModal(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  const attach = () => {
    const modal = document.getElementById('modal');
    if (modal) observer.observe(modal, { attributes: true, attributeFilter: ['open'] });
  };
  attach();
  return () => observer.disconnect();
}

/** Whether the big dialog is open. Polling waits while it is (the old pollStaffMessages skipped a round then). */
export function useModalOpen(): boolean {
  return useSyncExternalStore(
    subscribeModal,
    () => Boolean((document.getElementById('modal') as HTMLDialogElement | null)?.open),
    () => false,
  );
}

/** Opening a conversation (or the case holding it) where someone @mentioned the member counts as reading the
    mention: the bell's count drops at once and the server is told (the old markMentionsSeen). */
export function useMarkMentionsSeen(conversationIds: string[]) {
  const client = useQueryClient();
  const key = conversationIds.join(',');
  useEffect(() => {
    const open = key ? key.split(',') : [];
    const alerts = client.getQueryData<StaffAlerts>(['/api/automation/alerts']);
    if (!alerts || !open.length) return;
    const seen = [...new Set(alerts.mentions.filter((m) => open.includes(m.conversation_id)).map((m) => m.conversation_id))];
    if (!seen.length) return;
    client.setQueryData<StaffAlerts>(['/api/automation/alerts'], {
      ...alerts,
      mentions: alerts.mentions.filter((m) => !seen.includes(m.conversation_id)),
    });
    seen.forEach((id) => void markMentionsRead(id).catch(() => {}));
  }, [key, client]);
}
