'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/ui/Toast';
import { useRunAction } from '@/components/ui/actions';
import { useInvalidate } from '@/lib/query';
import { getAiJob, requestAiDraft, waitForAiJob } from '../api';
import type { AiDraftResult, AiJob } from '../types';
import { AiCitations } from './AiCitations';
import { useWorkspaceAi } from './AiControls';

/* "AI ช่วยร่าง" in the reply composer: the agent keeps typing while the AI reads the conversation and the knowledge
   base; the draft appears above the text box with its sources and is put into the box only when the agent says so.
   Markup: modules/ai/ai-draft-button, ai-drafting, ai-draft-queued, ai-draft-error, ai-draft-result. */

export type AiDraftView =
  | { kind: 'idle' }
  | { kind: 'drafting' }
  | { kind: 'queued'; jobId: string }
  | { kind: 'failed'; message: string }
  | { kind: 'result'; job: AiJob }
  /** A request that failed outright: its reason as plain text (the old panel.textContent). */
  | { kind: 'text'; message: string };

export type AiDraft = ReturnType<typeof useAiDraft>;

/** The draft of one conversation's composer: start(), check(jobId), dismiss(), and what the panel shows. */
export function useAiDraft(conversationId: string) {
  const [view, setView] = useState<AiDraftView>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const toast = useToast();
  const refresh = useInvalidate();
  const run = useRunAction();

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const show = useCallback((job: AiJob) => {
    if (['pending', 'running'].includes(job.status)) setView({ kind: 'queued', jobId: job.id });
    else if (job.status !== 'done') setView({ kind: 'failed', message: job.error || 'ร่างคำตอบไม่สำเร็จ กรุณาลองใหม่' });
    else setView({ kind: 'result', job });
  }, []);

  const start = useCallback(async () => {
    setBusy(true);
    setView({ kind: 'drafting' });
    try {
      const queued = await requestAiDraft(conversationId);
      // Asking for a draft stops the bot in this conversation: the header's AI state changes.
      await refresh('/api/conversations', '/api/tickets');
      const job = await waitForAiJob(queued.id, () => alive.current);
      if (alive.current) show(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (alive.current) setView({ kind: 'text', message });
      toast(message, true);
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [conversationId, refresh, show, toast]);

  const check = useCallback((jobId: string) => run(async () => show(await getAiJob(jobId))), [run, show]);
  const dismiss = useCallback(() => setView({ kind: 'idle' }), []);

  return { conversationId, view, busy, start, check, dismiss };
}

/** The composer's "AI ช่วยร่าง" button: off until an admin turns on drafts and saves an API key. */
export function AiDraftButton({ draft }: { draft: AiDraft }) {
  const ai = useWorkspaceAi();
  const enabled = Boolean(ai.drafts_enabled && ai.key_configured);
  return (
    <button
      type="button"
      className="tool-btn ai-draft-btn"
      data-id={draft.conversationId}
      disabled={!enabled || draft.busy}
      aria-label="AI ช่วยร่างคำตอบ"
      title={enabled ? 'ร่างและตรวจแหล่งอ้างอิงก่อนส่ง' : 'ให้ผู้ดูแลองค์กรเปิด AI ในหน้าตั้งค่าองค์กร'}
      onClick={() => void draft.start()}
    >
      <Icon name="sparkle" />
      <span>AI ช่วยร่าง</span>
    </button>
  );
}

/** Where the draft shows, above the text box. `onUse` receives the answer to put in the box. */
export function AiDraftPanel({ draft, onUse }: { draft: AiDraft; onUse: (answer: string) => void }) {
  const toast = useToast();
  const run = useRunAction();
  const { view } = draft;
  return (
    <div data-ai-panel={draft.conversationId} aria-live="polite">
      {view.kind === 'drafting' && <div className="notice">AI กำลังอ่านบทสนทนาและค้นความรู้… คุณพิมพ์ข้อความต่อได้</div>}
      {view.kind === 'queued' && (
        <div className="notice">
          งานยังอยู่ในคิว{' '}
          <button type="button" className="btn subtle" onClick={() => void draft.check(view.jobId)}>
            ตรวจผลอีกครั้ง
          </button>
        </div>
      )}
      {view.kind === 'failed' && <div className="notice warning">{view.message}</div>}
      {view.kind === 'text' && view.message}
      {view.kind === 'result' && (
        <DraftResult
          job={view.job}
          onDismiss={draft.dismiss}
          onUse={() =>
            run(async () => {
              // The conversation may have moved on since the draft was made; the server says so.
              const job = await getAiJob(view.job.id);
              const result = job.result as Partial<AiDraftResult>;
              if (job.status !== 'done' || !result.answer) throw new Error(job.error || 'บทสนทนาเปลี่ยนไป กรุณาร่างใหม่');
              onUse(result.answer);
              toast('ใส่ร่างแล้ว ตรวจทานและกดส่งเมื่อพร้อม');
            })
          }
        />
      )}
    </div>
  );
}

/* One message per state: no draft (why, in one line), or the draft itself first, then who it is for and its sources. */
function DraftResult({ job, onDismiss, onUse }: { job: AiJob; onDismiss: () => void; onUse: () => void }) {
  const r = job.result as Partial<AiDraftResult>;
  const close = (
    <button type="button" className="icon-btn ai-result-close" aria-label="ปิดร่าง AI" onClick={onDismiss}>
      <Icon name="close" />
    </button>
  );
  if (!r.answer)
    return (
      <div className="ai-result ai-result-empty">
        <Icon name="sparkle" />
        <div className="grow">
          <strong>AI ร่างคำตอบเรื่องนี้ไม่ได้</strong>
          <p>ยังไม่มีบทความในคลังความรู้ที่ตอบเรื่องนี้ เพิ่มบทความแล้ว AI จะร่างเรื่องแบบนี้ได้</p>
          {/* The server's own "no knowledge" summary says the same; a summary from the AI says what to check. */}
          {r.summary && !r.summary.startsWith('ไม่พบความรู้') && <p>สำหรับเจ้าหน้าที่: {r.summary}</p>}
        </div>
        {close}
      </div>
    );
  return (
    <div className="ai-result">
      <div className="ai-result-head">
        <strong>
          <Icon name="sparkle" />
          ร่างจาก AI
        </strong>
        <span className="muted">ยังไม่ได้ส่ง · ตรวจก่อนใช้</span>
        {close}
      </div>
      {r.needs_human && <p className="ai-result-warn">AI ไม่แน่ใจคำตอบนี้ ตรวจข้อมูลกับเคสจริงก่อนส่ง</p>}
      <div className="ai-result-answer">{r.answer}</div>
      {r.summary && (
        <p className="ai-result-summary">
          <span>สำหรับเจ้าหน้าที่:</span> {r.summary}
        </p>
      )}
      <div className="ai-result-actions">
        <button className="btn primary sm" type="button" onClick={onUse}>
          ใช้ร่างนี้
        </button>
        <AiCitations citations={r.citations} />
      </div>
    </div>
  );
}
