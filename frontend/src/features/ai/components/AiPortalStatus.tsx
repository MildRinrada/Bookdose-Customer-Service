'use client';

import { Icon } from '@/components/Icon';
import { useToast } from '@/components/ui/Toast';
import { useRunAction } from '@/components/ui/actions';
import { useInvalidate } from '@/lib/query';
import { portalHandoff } from '../api';
import type { AiState } from '../types';

/* The line above a customer's chat: served by the AI chatbot (with "คุยกับเจ้าหน้าที่") or by a person.
   Put it inside <div className="notice customer-ai-status" id="customer-ai-status">. Markup: modules/ai/ai-portal-status. */

export function AiPortalStatus({
  ai,
  slug,
  onHandedOff,
}: {
  /** session.ai of GET /api/public/<slug>/session */
  ai: AiState | null | undefined;
  /** The organization of the open chat. */
  slug: string;
  /** After asking for a person (the customer chat refreshes itself; /api/public/<slug> is refreshed here too). */
  onHandedOff?: () => unknown | Promise<unknown>;
}) {
  const toast = useToast();
  const refresh = useInvalidate();
  const run = useRunAction();
  const bot = ai?.mode === 'bot';
  return (
    <div className="flex between wrap">
      <span>
        {bot ? <Icon name="sparkle" /> : <Icon name="users" />}{' '}
        {bot ? (
          <>
            {ai?.pending ? 'AI กำลังตรวจข้อมูลและเตรียมคำตอบ…' : 'คุณกำลังรับบริการจาก AI Chatbot'}
            <span className="tiny muted"> · ตรวจแหล่งอ้างอิงประกอบคำตอบได้</span>
          </>
        ) : (
          'เจ้าหน้าที่ดูแลเรื่องนี้อยู่'
        )}
      </span>
      {bot && (
        <button
          type="button"
          className="btn sm"
          onClick={() =>
            run(async () => {
              await portalHandoff(slug);
              await refresh(`/api/public/${slug}`);
              await onHandedOff?.();
              toast('ส่งเรื่องให้เจ้าหน้าที่แล้ว');
            })
          }
        >
          คุยกับเจ้าหน้าที่
        </button>
      )}
    </div>
  );
}
