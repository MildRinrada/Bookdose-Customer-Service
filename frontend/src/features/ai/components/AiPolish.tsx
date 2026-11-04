'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { requestPolish, waitForAiJob, type PolishStyle } from '../api';
import { useWorkspaceAi } from './AiControls';
import { AiNotReady } from './AiNotReady';

/* "เกลาข้อความ" in the reply composer (backend ai/polish.py): the member picks how - more polite, shorter or typos
   fixed - and the AI rewrites only what they typed. The result shows above the text box and replaces the text only
   when the member says so; nothing is sent from here. Markup: the draft's ai-result, plus ai-polish-*
   (pages/inbox-calm.css). */

export const POLISH_STYLES: Array<[PolishStyle, string]> = [
  ['polite', 'สุภาพขึ้น'],
  ['short', 'สั้นลง'],
  ['fix', 'แก้คำผิด'],
];
const styleLabel = (style: PolishStyle) => POLISH_STYLES.find(([key]) => key === style)?.[1] ?? '';

/* Each choice's icon and one line on what it does, as the AI is told to (POLISH_INSTRUCTIONS in
   backend/extensions/openai_client.py). The line is the button's description, so a screen reader hears it too. */
const STYLE_LOOK: Record<PolishStyle, { icon: IconName; hint: string }> = {
  polite: { icon: 'smile', hint: 'สุภาพและอบอุ่นขึ้น ใจความเดิม' },
  short: { icon: 'shrink', hint: 'สั้นและชัดขึ้น ข้อมูลยังครบ' },
  fix: { icon: 'check', hint: 'แก้เฉพาะคำผิดและวรรคตอน' },
};

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
  const hintId = useId();
  const { view } = polish;
  if (view.kind === 'idle') return null;
  const ready = Boolean(ai.drafts_enabled && ai.key_configured);
  const close = (
    <button type="button" className="icon-btn ai-result-close" aria-label="ปิดการเกลาข้อความ" onClick={polish.close}>
      <Icon name="close" />
    </button>
  );
  // The first choice: each way as a card with its icon and what it does. After a result: the other two, small.
  const choices = (current?: PolishStyle) => (
    <div className={current ? 'ai-polish-styles again' : 'ai-polish-styles'} role="group" aria-label="ปรับข้อความแบบไหน">
      {POLISH_STYLES.filter(([key]) => key !== current).map(([key, label]) =>
        current ? (
          <button key={key} type="button" className="btn sm ai-polish-again" onClick={() => void polish.polish(key)}>
            <Icon name={STYLE_LOOK[key].icon} />
            {`ลองแบบ${label}`}
          </button>
        ) : (
          <button
            key={key}
            type="button"
            className="ai-polish-option"
            aria-describedby={`${hintId}-${key}`}
            onClick={() => void polish.polish(key)}
          >
            <span className="ai-polish-option-icon">
              <Icon name={STYLE_LOOK[key].icon} />
            </span>
            <span className="ai-polish-option-label">{label}</span>
            <span className="ai-polish-option-hint" id={`${hintId}-${key}`}>
              {STYLE_LOOK[key].hint}
            </span>
          </button>
        ),
      )}
    </div>
  );
  return (
    <div className={`ai-result ai-polish is-${view.kind}`} aria-live="polite">
      <div className="ai-result-head">
        <span className="ai-polish-mark" aria-hidden="true">
          <Icon name="sparkle" />
        </span>
        <strong>{view.kind === 'result' ? `เกลาแล้ว: ${styleLabel(view.style)}` : 'เกลาข้อความ'}</strong>
        {view.kind === 'result' && <span className="muted">ยังไม่ได้ส่ง ตรวจก่อนใช้</span>}
        {close}
      </div>
      {!ready ? (
        <AiNotReady ai={ai} />
      ) : view.kind === 'choosing' ? (
        choices()
      ) : view.kind === 'working' ? (
        <p className="ai-polish-note" role="status">
          <Icon name={STYLE_LOOK[view.style].icon} />
          <span>AI กำลังปรับให้{styleLabel(view.style)}…</span>
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
