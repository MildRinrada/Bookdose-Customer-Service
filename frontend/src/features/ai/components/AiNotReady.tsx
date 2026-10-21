'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { useWork } from '@/lib/session';

/* Where an AI feature cannot be used yet: the organization's admin is the one who can change that, so they get the
   way to the setting itself; anybody else is told who can, rather than pointed at a page they cannot open.
   Markup: pages/ai-assistant.css (ai-not-ready). */

type Ai = { key_configured?: boolean; drafts_enabled?: boolean };

export function AiNotReady({ ai, onGo }: { ai: Ai; /** Called on the way to the setting (to close a panel). */ onGo?: () => void }) {
  const work = useWork();
  const admin = work.role === 'admin' && !work.read_only;
  const connected = Boolean(ai.key_configured);
  return (
    <div className="ai-not-ready">
      <strong>{connected ? 'ยังไม่ได้เปิด AI ช่วยเจ้าหน้าที่' : 'ยังไม่ได้เชื่อม AI'}</strong>
      <span>
        {!admin
          ? 'ผู้ดูแลองค์กรยังไม่ได้ตั้งค่า ติดต่อผู้ดูแลเพื่อเปิดใช้'
          : connected
            ? 'เปิดได้ในหน้าตั้งค่า AI แล้วใช้ได้ทันที'
            : 'เชื่อม OpenAI, Gemini หรือ n8n แล้วใช้ได้ทันที'}
      </span>
      {admin && (
        <Link className="btn small" href="/settings?tab=ai" onClick={onGo}>
          ตั้งค่า AI
          <Icon name="arrow" />
        </Link>
      )}
    </div>
  );
}
