'use client';

import { Icon } from '@/components/Icon';
import { useRunAction } from '@/components/ui/actions';
import { api } from '@/lib/api/client';
import { relative } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { useUiState } from '@/lib/ui-state';
import { useWorkspaceAi } from './AiControls';

/* สรุปบทสนทนา: what a member taking a conversation over needs instead of reading all of it - what the customer wants,
   what was tried, what is still open (backend/modules/ai/summary.py). The kept summary shows at once; "อัปเดตสรุป"
   appears only when something was written since, and sends the AI only that. While an update is on its way the
   kept one stays readable. Shown where the organization has AI for staff help (the same switch as reply drafts).
   Markup: modules/ai (conv-summary). */

type Summary = { wants: string[]; tried: string[]; pending: string[]; covered: number; skipped: number; updated_at: string };
type SummaryState = { summary: Summary | null; new_messages: number; working: boolean; error: string };

// Shorter than this it reads faster than a summary does: no panel until it grows or one was already made.
const WORTH_SUMMARIZING = 4;
const POLL_MS = 2000;

const PARTS: Array<[keyof Pick<Summary, 'wants' | 'tried' | 'pending'>, string, string]> = [
  ['wants', 'ลูกค้าต้องการ', 'help'],
  ['tried', 'ทำไปแล้ว', 'check'],
  ['pending', 'ยังค้างอยู่', 'clock'],
];

export function ConversationSummary({ conversationId, messageCount }: { conversationId: string; messageCount: number }) {
  const ai = useWorkspaceAi();
  const available = Boolean(ai?.drafts_enabled && ai?.key_configured);
  const path = `/api/conversations/${conversationId}/summary`;
  // Asked again every two seconds only while a summary is on its way.
  const state = useApi<SummaryState>(available ? path : null, {
    refetchInterval: (last) => ((last as SummaryState | undefined)?.working ? POLL_MS : false),
  });
  const [open, setOpen] = useUiState('conv-summary:open', true);
  const refresh = useInvalidate();
  const run = useRunAction();
  const data = state.data;
  const working = Boolean(data?.working);
  if (!available || !data || (!data.summary && !working && messageCount < WORTH_SUMMARIZING)) return null;
  const s = data.summary;

  const ask = () =>
    run(async () => {
      await api<SummaryState>(path, {});
      await refresh(path);
    });

  return (
    <section className={`conv-summary${open ? '' : ' closed'}`} aria-label="สรุปบทสนทนาโดย AI">
      <div className="conv-summary-head">
        <button type="button" className="conv-summary-toggle" aria-expanded={open} onClick={() => setOpen(!open)} disabled={!s}>
          <Icon name="sparkle" />
          <strong>สรุปบทสนทนา</strong>
          {s && (
            <span className="tiny muted">
              จาก {s.covered} ข้อความ · {relative(s.updated_at)}
            </span>
          )}
        </button>
        {working ? (
          <span className="conv-summary-working" role="status">
            <span className="conv-summary-pulse" aria-hidden="true" />
            {s ? 'กำลังอัปเดต อ่านสรุปเดิมไปก่อนได้' : 'AI กำลังสรุป…'}
          </span>
        ) : !s ? (
          <button type="button" className="btn sm" onClick={ask}>
            <Icon name="sparkle" />
            สรุปด้วย AI
          </button>
        ) : data.new_messages > 0 ? (
          <button type="button" className="btn sm" onClick={ask} title="ส่งให้ AI เฉพาะข้อความใหม่ พร้อมสรุปเดิม">
            <Icon name="sparkle" />
            อัปเดตสรุป (+{data.new_messages} ข้อความใหม่)
          </button>
        ) : (
          <span className="tiny muted">สรุปถึงข้อความล่าสุดแล้ว</span>
        )}
      </div>
      {data.error && !working && <p className="conv-summary-error">{data.error}</p>}
      {s && open && (
        <div className="conv-summary-grid">
          {PARTS.map(([key, label, icon]) => (
            <div key={key} className={`conv-summary-part ${key}`}>
              <h4>
                <Icon name={icon} />
                {label}
              </h4>
              {s[key].length ? (
                <ul>
                  {s[key].map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              ) : (
                <p className="tiny muted">ไม่มี</p>
              )}
            </div>
          ))}
          {s.skipped > 0 && <p className="tiny muted conv-summary-note">ข้อความเก่า {s.skipped} ข้อความยาวเกินส่งให้ AI ครั้งเดียว สรุปอาจไม่ครอบคลุมช่วงนั้น</p>}
        </div>
      )}
    </section>
  );
}
