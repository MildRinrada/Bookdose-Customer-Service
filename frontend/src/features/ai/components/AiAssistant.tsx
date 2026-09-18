'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Icon } from '@/components/Icon';
import { useWork } from '@/lib/session';
import { askAssistant, waitForAiJob } from '../api';
import type { AiCitation } from '../types';
import { AiCitations } from './AiCitations';
import { useWorkspaceAi } from './AiControls';

/* ผู้ช่วย AI: the floating button at the bottom right of every staff page. A member of the team asks anything about
   their work; the answer comes from the organization's AI (n8n or OpenAI) with the knowledge articles it quotes.
   The chat is kept for this browser tab only (sessionStorage), and the last turns go with each question.
   Markup: pages/ai-assistant.css. */

type Turn = { role: 'user' | 'assistant'; text: string; citations?: AiCitation[]; failed?: boolean };

const SUGGESTIONS = [
  'ช่วยเขียนข้อความขอโทษลูกค้าที่รอคำตอบนาน',
  'คลังความรู้เขียนเรื่องรีเซ็ตรหัสผ่านไว้ว่าอย่างไร',
  'สรุปขั้นตอนการยืมหนังสือให้ลูกค้าเข้าใจง่าย',
];
const HISTORY_SENT = 12;

function load(key: string): Turn[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? '[]');
    return Array.isArray(saved) ? saved.slice(-40) : [];
  } catch {
    return [];
  }
}

export function AiAssistant() {
  const work = useWork();
  const ai = useWorkspaceAi();
  const ready = Boolean(ai.drafts_enabled && ai.key_configured);
  const key = `bd-assistant:${work.tenant.id}`;
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    alive.current = true;
    setTurns(load(key));
    return () => {
      alive.current = false;
    };
  }, [key]);

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(turns.slice(-40)));
    } catch {
      // Private windows may refuse storage: the chat still works until the page closes.
    }
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [key, turns, busy]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    const history = turns.filter((t) => !t.failed).slice(-HISTORY_SENT).map(({ role, text: t }) => ({ role, text: t }));
    setTurns((all) => [...all, { role: 'user', text: q }]);
    setText('');
    setBusy(true);
    try {
      const queued = await askAssistant(q, history);
      const job = await waitForAiJob(queued.id, () => alive.current);
      const result = job.result as { answer?: string; citations?: AiCitation[] };
      const answer =
        job.status === 'done' && result.answer
          ? { role: 'assistant' as const, text: result.answer, citations: result.citations }
          : {
              role: 'assistant' as const,
              failed: true,
              text: job.status === 'running' || job.status === 'pending' ? 'AI ยังตอบไม่เสร็จ ลองถามใหม่อีกครั้งภายหลัง' : job.error || 'AI ตอบไม่สำเร็จ ลองใหม่อีกครั้ง',
            };
      if (alive.current) setTurns((all) => [...all, answer]);
    } catch (error) {
      if (alive.current) setTurns((all) => [...all, { role: 'assistant', failed: true, text: error instanceof Error ? error.message : String(error) }]);
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(text);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void ask(text);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`assistant-fab${open ? ' open' : ''}`}
        aria-expanded={open}
        aria-controls="ai-assistant"
        aria-label={open ? 'ปิดผู้ช่วย AI' : 'เปิดผู้ช่วย AI'}
        data-tip="ผู้ช่วย AI"
        onClick={() => setOpen(!open)}
      >
        <Icon name={open ? 'close' : 'sparkle'} />
      </button>
      {open && (
        <section id="ai-assistant" className="assistant-panel" role="dialog" aria-modal="false" aria-label="ผู้ช่วย AI">
          <header className="assistant-head">
            <span className="assistant-mark" aria-hidden="true">
              <Icon name="sparkle" />
            </span>
            <div className="grow">
              <strong>ผู้ช่วย AI</strong>
              <span>ตอบจากคลังความรู้ของ {work.tenant.name}</span>
            </div>
            {turns.length > 0 && (
              <button type="button" className="icon-btn" aria-label="เริ่มแชทใหม่" title="เริ่มแชทใหม่" disabled={busy} onClick={() => setTurns([])}>
                <Icon name="trash" />
              </button>
            )}
            <button type="button" className="icon-btn" aria-label="ปิดผู้ช่วย AI" onClick={() => setOpen(false)}>
              <Icon name="close" />
            </button>
          </header>
          <div className="assistant-log" ref={log} aria-live="polite">
            {!ready ? (
              <div className="assistant-empty">
                <p>ผู้ช่วย AI ยังไม่เปิดใช้ในองค์กรนี้</p>
                {work.role === 'admin' ? (
                  <Link className="btn subtle small" href="/settings?tab=ai" onClick={() => setOpen(false)}>
                    ไปที่ตั้งค่า AI
                  </Link>
                ) : (
                  <p className="muted">ให้เจ้าขององค์กรเปิด “AI ช่วยเจ้าหน้าที่” ในหน้าตั้งค่าองค์กร</p>
                )}
              </div>
            ) : turns.length === 0 ? (
              <div className="assistant-empty">
                <p>ถามเรื่องงานได้เลย เช่น</p>
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="assistant-suggestion" onClick={() => void ask(s)}>
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              turns.map((t, i) => (
                <div key={i} className={`assistant-turn ${t.role}${t.failed ? ' failed' : ''}`}>
                  <div className="assistant-bubble">{t.text}</div>
                  {t.role === 'assistant' && !t.failed && (
                    <div className="assistant-tools">
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => {
                          void navigator.clipboard?.writeText(t.text).catch(() => undefined);
                        }}
                      >
                        คัดลอก
                      </button>
                      <AiCitations citations={t.citations} />
                    </div>
                  )}
                </div>
              ))
            )}
            {busy && (
              <div className="assistant-turn assistant">
                <div className="assistant-bubble assistant-typing" aria-label="AI กำลังตอบ">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>
          <form className="assistant-form" onSubmit={submit}>
            <label className="sr-only" htmlFor="assistant-input">
              คำถามถึงผู้ช่วย AI
            </label>
            <textarea
              id="assistant-input"
              ref={input}
              rows={2}
              maxLength={2000}
              value={text}
              disabled={!ready}
              placeholder={ready ? 'พิมพ์คำถาม… (Enter ส่ง, Shift+Enter ขึ้นบรรทัด)' : 'ยังไม่เปิดใช้'}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button type="submit" className="btn primary" aria-label="ส่งคำถาม" disabled={!ready || busy || !text.trim()}>
              <Icon name="send" />
            </button>
          </form>
        </section>
      )}
    </>
  );
}
