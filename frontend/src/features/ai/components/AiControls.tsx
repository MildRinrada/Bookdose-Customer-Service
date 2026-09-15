'use client';

import { Icon } from '@/components/Icon';
import { useToast } from '@/components/ui/Toast';
import type { WorkspaceChannels } from '@/features/channels/types';
import { useRunAction } from '@/components/ui/actions';
import { useInvalidate } from '@/lib/query';
import { useWork } from '@/lib/session';
import { setAiMode } from '../api';
import type { AiConversation } from '../types';

/* Who answers the customer in this conversation: "AI ดูแลอยู่" with "รับช่วงดูแล", or "ให้ AI ดูแล" when the
   chatbot is on for the channel. Only web, LINE and Email chats have a chatbot. Markup: modules/ai/ai-controls. */

type WorkspaceAi = { drafts_enabled?: boolean; chatbot_enabled?: boolean; key_configured?: boolean };

/** The organization's AI switches, from the workspace. */
export function useWorkspaceAi(): WorkspaceAi {
  return useWork().ai as WorkspaceAi;
}

export function AiControls({ conversation }: { conversation: AiConversation | null | undefined }) {
  const work = useWork();
  const ai = work.ai as WorkspaceAi;
  const channels = (work.channels ?? {}) as WorkspaceChannels;
  const toast = useToast();
  const refresh = useInvalidate();
  const run = useRunAction();
  const conv = conversation;
  if (!conv || !['web', 'line', 'email'].includes(conv.channel)) return null;
  const state = conv.ai ?? { mode: 'human' };
  const bot = state.mode === 'bot';
  const chatbotOn = conv.channel === 'web' ? ai.chatbot_enabled : channels[conv.channel]?.enabled && channels[conv.channel]?.chatbot_enabled;
  const canHandToBot = !bot && chatbotOn && ai.key_configured && conv.status === 'open';

  const change = (mode: 'human' | 'bot') =>
    run(async () => {
      await setAiMode(conv.id, mode);
      await refresh('/api/conversations', '/api/tickets');
      toast(mode === 'human' ? 'เจ้าหน้าที่รับช่วงดูแลแล้ว' : 'AI จะดูแลข้อความใหม่จากลูกค้า');
    });

  return (
    <>
      {bot && (
        <>
          <span className="badge new ai-state" title="AI กำลังตอบลูกค้าในบทสนทนานี้">
            <Icon name="sparkle" />
            {state.pending ? 'AI กำลังเตรียมคำตอบ' : 'AI ดูแลอยู่'}
          </span>
          <button type="button" className="btn sm" title="ให้เจ้าหน้าที่ตอบเอง และหยุด AI ในบทสนทนานี้" onClick={() => change('human')}>
            รับช่วงดูแล
          </button>
        </>
      )}
      {canHandToBot && (
        <button
          type="button"
          className="btn sm ai-handoff"
          aria-label="ให้ AI ดูแลข้อความถัดไป"
          title="ตอนนี้เจ้าหน้าที่ดูแลอยู่ · ให้ AI ตอบข้อความถัดไปของลูกค้า"
          onClick={() => change('bot')}
        >
          <Icon name="sparkle" />
          ให้ AI ดูแล
        </button>
      )}
    </>
  );
}
