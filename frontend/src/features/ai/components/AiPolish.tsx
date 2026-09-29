'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { requestPolish, waitForAiJob, type PolishStyle } from '../api';
import { useWorkspaceAi } from './AiControls';

/* "เกลาข้อความ" in the reply composer (backend ai/polish.py): the member picks how - more polite, shorter or typos
   fixed - and the AI rewrites only what they typed. The result shows above the text box and replaces the text only
   when the member says so; nothing is sent from here. Markup: the draft's ai-result, plus ai-polish-*. */

export const POLISH_STYLES: Array<[PolishStyle, string]> = [
  ['polite', 'สุภาพขึ้น'],
  ['short', 'สั้นลง'],
  ['fix', 'แก้คำผิด'],
];
const styleLabel = (style: PolishStyle) => POLISH_STYLES.find(([key]) => key === style)?.[1] ?? '';

type PolishView =
  | { kind: 'idle' }
  | { kind: 'choosing' }
  | { kind: 'working'; style: PolishStyle }
  | { kind: 'result'; style: PolishStyle; text: string }
  | { kind: 'failed'; message: string };

export type Polish = ReturnType<typeof usePolish>;

/** The polish of one composer. `read` gives what is in the text box now. */
export function usePolish(read: () => string) {
  const [view, setView] = useState<PolishView>({ kind: 'idle' });
  const alive = useRef(true);
  // Only the newest request's answer is shown: asking again while one is on its way replaces it.
  const latest = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const polish = useCallback(
    async (style: PolishStyle) => {
      const text = read().trim();
      if (!text) {
        setView({ kind: 'failed', message: 'พิมพ์ข้อความก่อน แล้วค่อยให้ AI ช่วยเกลา' });
        return;
      }
      const ticket = ++latest.current;
      const current = () => alive.current && latest.current === ticket;
      setView({ kind: 'working', style });
      try {
        const queued = await requestPolish(style, text);
        const job = await waitForAiJob(queued.id, current);
        if (!current()) return;
        const result = job.result as { text?: string };
        if (job.status === 'done' && result.text) setView({ kind: 'result', style, text: result.text });
        else setView({ kind: 'failed', message: job.status === 'running' ? 'AI ใช้เวลานานเกินไป ลองอีกครั้ง' : job.error || 'เกลาข้อความไม่สำเร็จ ลองอีกครั้ง' });
      } catch (error) {
        if (current()) setView({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
      }
    },
    [read],
  );

  const toggle = useCallback(() => setView((v) => (v.kind === 'idle' ? { kind: 'choosing' } : { kind: 'idle' })), []);
  const close = useCallback(() => {
    latest.current++;
    setView({ kind: 'idle' });
  }, []);
  return { view, polish, toggle, close };
}

/** The composer's "เกลาข้อความ" button: opens the choice of how, above the text box. */
export function PolishButton({ polish }: { polish: Polish }) {
  const open = polish.view.kind !== 'idle';
  return (
    <button
      type="button"
      className={`tool-btn${open ? ' active' : ''}`}
      aria-expanded={open}
      aria-label="ให้ AI เกลาข้อความ"
      title="ให้ AI ช่วยให้สุภาพขึ้น สั้นลง หรือแก้คำผิด ก่อนส่ง"
      onClick={polish.toggle}
    >
      <Icon name="edit" />
      <span>เกลาข้อความ</span>
    </button>
  );
}

/** Above the text box: how to polish, the AI at work, or the result to use. `onUse` puts the text in the box. */
export function PolishPanel({ polish, onUse }: { polish: Polish; onUse: (text: string) => void }) {
  const ai = useWorkspaceAi();
  const { view } = polish;
  if (view.kind === 'idle') return null;
  const ready = Boolean(ai.drafts_enabled && ai.key_configured);
  const close = (
    <button type="button" className="icon-btn ai-result-close" aria-label="ปิดการเกลาข้อความ" onClick={polish.close}>
      <Icon name="close" />
    </button>
  );
  const choices = (current?: PolishStyle) => (
    <div className="ai-polish-styles" role="group" aria-label="ปรับข้อความแบบไหน">
      {POLISH_STYLES.filter(([key]) => key !== current).map(([key, label]) => (
        <button key={key} type="button" className="btn sm" onClick={() => void polish.polish(key)}>
          {current ? `ลองแบบ${label}` : label}
        </button>
      ))}
    </div>
  );
  return (
    <div className="ai-result ai-polish" aria-live="polite">
      <div className="ai-result-head">
        <strong>
          <Icon name="edit" />
          {view.kind === 'result' ? `เกลาแล้ว: ${styleLabel(view.style)}` : 'เกลาข้อความ'}
        </strong>
        {view.kind === 'result' && <span className="muted">ยังไม่ได้ส่ง ตรวจก่อนใช้</span>}
        {close}
      </div>
      {!ready ? (
        <p className="ai-polish-note">ใช้ได้เมื่อเจ้าขององค์กรเชื่อม AI และเปิด “AI ช่วยเจ้าหน้าที่” ในตั้งค่าองค์กร → AI Assistant</p>
      ) : view.kind === 'choosing' ? (
        <>
          <p className="ai-polish-note">AI ปรับเฉพาะข้อความที่คุณพิมพ์ไว้ อีเมลและเบอร์โทรในข้อความไม่ถูกส่งไป</p>
          {choices()}
        </>
      ) : view.kind === 'working' ? (
        <p className="ai-polish-note" role="status">
          AI กำลังปรับให้{styleLabel(view.style)}…
        </p>
      ) : view.kind === 'failed' ? (
        <>
          <p className="ai-result-warn">{view.message}</p>
          {choices()}
        </>
      ) : (
        <>
          <div className="ai-result-answer">{view.text}</div>
          <div className="ai-result-actions">
            <button type="button" className="btn primary sm" onClick={() => onUse(view.text)}>
              ใช้ข้อความนี้
            </button>
            {choices(view.style)}
          </div>
        </>
      )}
    </div>
  );
}
