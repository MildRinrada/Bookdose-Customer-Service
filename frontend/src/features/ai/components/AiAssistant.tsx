'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Icon } from '@/components/Icon';
import { useBoot, useWork } from '@/lib/session';
import { askAssistant, waitForAiJob } from '../api';
import type { AiCitation } from '../types';
import { AiCitations } from './AiCitations';
import { useWorkspaceAi } from './AiControls';

/* ผู้ช่วย AI: the floating button at the bottom right of every staff page. A member of the team asks anything about
   their work; the answer comes from the organization's AI (n8n or OpenAI) with the knowledge articles it quotes.
   The chat is kept for this browser tab only (sessionStorage), and the last turns go with each question.
   Markup: pages/ai-assistant.css. */

/** local: written by the page itself (the tips), never sent to the AI as part of the chat. fresh: just arrived, so it
    slides in and an answer's words appear as if being written (never saved). */
type Turn = { role: 'user' | 'assistant'; text: string; citations?: AiCitation[]; failed?: boolean; local?: boolean; fresh?: boolean };

const prefersStill = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A fresh answer appears a few letters at a time (about a second whatever its length), then says it is done. */
function RevealText({ text, animate, onGrow, onDone }: { text: string; animate: boolean; onGrow: () => void; onDone: () => void }) {
  const [letters] = useState(() => Array.from(text));
  const [shown, setShown] = useState(() => (animate && !prefersStill() ? 0 : letters.length));
  useEffect(() => {
    if (shown >= letters.length) {
      if (animate) onDone();
      return;
    }
    const step = Math.max(2, Math.ceil(letters.length / 55));
    const timer = window.setTimeout(() => setShown((n) => Math.min(n + step, letters.length)), 18);
    onGrow();
    return () => window.clearTimeout(timer);
  }, [shown, letters, animate, onGrow, onDone]);
  return <>{shown >= letters.length ? text : letters.slice(0, shown).join('')}</>;
}

const SUGGESTIONS = [
  'ช่วยเขียนข้อความขอโทษลูกค้าที่รอคำตอบนาน',
  'คลังความรู้เขียนเรื่องรีเซ็ตรหัสผ่านไว้ว่าอย่างไร',
  'สรุปขั้นตอนการยืมหนังสือให้ลูกค้าเข้าใจง่าย',
];
const HISTORY_SENT = 12;
/** What the assistant says when "เคล็ดลับถามให้ได้คำตอบที่ดี" is pressed (written here, not asked of the AI). */
const TIPS_MESSAGE = [
  'เคล็ดลับถามให้ได้คำตอบที่ดีครับ',
  '',
  '1. บอกให้ชัดว่าอยากได้อะไร เช่น เขียนข้อความตอบลูกค้า สรุปขั้นตอน หรือหาบทความ',
  '2. ใส่รายละเอียดของเรื่อง เช่น บริการที่ลูกค้าใช้ และสิ่งที่ลูกค้าเจอ',
  '3. บอกน้ำเสียงหรือความยาวที่ต้องการ เช่น สุภาพ สั้น ๆ ไม่เกิน 3 บรรทัด',
  '4. ถ้าคำตอบยังไม่ตรง ถามต่อในแชทนี้ได้เลย ผมจำข้อความก่อนหน้าไว้',
  '',
  'ผมตอบจากคลังความรู้ขององค์กร ถ้ายังไม่มีบทความเรื่องนั้น คำตอบอาจไม่ครบนะครับ',
].join('\n');

/** The empty box's placeholder writes an example question letter by letter, holds it, rubs it out and writes the
    next, like someone typing (only while the box is empty; one still example when the person asks for less motion). */
function useTypingPlaceholder(phrases: string[], running: boolean): string {
  const [shown, setShown] = useState('');
  const [still] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (!running || still) return;
    let phrase = 0;
    let length = 0;
    let deleting = false;
    let timer = 0;
    const tick = () => {
      const letters = Array.from(phrases[phrase] ?? '');
      if (!deleting) {
        length += 1;
        if (length >= letters.length) {
          length = letters.length;
          deleting = true;
          setShown(letters.join(''));
          timer = window.setTimeout(tick, 1800);
          return;
        }
      } else {
        length -= 1;
        if (length <= 0) {
          length = 0;
          deleting = false;
          phrase = (phrase + 1) % phrases.length;
          setShown('');
          timer = window.setTimeout(tick, 450);
          return;
        }
      }
      setShown(letters.slice(0, length).join(''));
      timer = window.setTimeout(tick, deleting ? 28 : 65);
    };
    timer = window.setTimeout(tick, 500);
    return () => {
      window.clearTimeout(timer);
      setShown('');
    };
  }, [phrases, running, still]);
  if (!running) return '';
  return still ? (phrases[0] ?? '') : shown;
}

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
  const userName = useBoot().data?.user?.name ?? '';
  const ai = useWorkspaceAi();
  const ready = Boolean(ai.drafts_enabled && ai.key_configured);
  const key = `bd-assistant:${work.tenant.id}`;
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  // leaving: the first screen fading out; thinking: the dots before the tips (written here) appear.
  const [leaving, setLeaving] = useState(false);
  const [thinking, setThinking] = useState(false);
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
      sessionStorage.setItem(key, JSON.stringify(turns.slice(-40).map((t) => ({ ...t, fresh: undefined }))));
    } catch {
      // Private windows may refuse storage: the chat still works until the page closes.
    }
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [key, turns, busy, thinking]);

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
    const history = turns.filter((t) => !t.failed && !t.local).slice(-HISTORY_SENT).map(({ role, text: t }) => ({ role, text: t }));
    setTurns((all) => [...all, { role: 'user', text: q, fresh: true }]);
    setText('');
    setBusy(true);
    try {
      const queued = await askAssistant(q, history);
      const job = await waitForAiJob(queued.id, () => alive.current);
      const result = job.result as { answer?: string; citations?: AiCitation[] };
      const answer =
        job.status === 'done' && result.answer
          ? { role: 'assistant' as const, text: result.answer, citations: result.citations, fresh: true }
          : {
              role: 'assistant' as const,
              failed: true,
              fresh: true,
              text: job.status === 'running' || job.status === 'pending' ? 'AI ยังตอบไม่เสร็จ ลองถามใหม่อีกครั้งภายหลัง' : job.error || 'AI ตอบไม่สำเร็จ ลองใหม่อีกครั้ง',
            };
      if (alive.current) setTurns((all) => [...all, answer]);
    } catch (error) {
      if (alive.current) setTurns((all) => [...all, { role: 'assistant', failed: true, text: error instanceof Error ? error.message : String(error) }]);
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  // Before the first question: a greeting and the question box in the middle of the panel.
  const welcome = ready && turns.length === 0 && !thinking;
  const typed = useTypingPlaceholder(SUGGESTIONS, open && welcome && !leaving && !text);

  // From the first screen into the chat: the screen fades up and away, then the chat comes in under it.
  const leaveWelcome = (then: () => void) => {
    if (!welcome || prefersStill()) return then();
    setLeaving(true);
    window.setTimeout(() => {
      if (!alive.current) return;
      setLeaving(false);
      then();
    }, 200);
  };
  const send = (question: string) => {
    if (!question.trim() || busy || leaving) return;
    leaveWelcome(() => void ask(question));
  };
  // The tips come from the assistant, as its message: the dots first, then the words.
  const showTips = () =>
    leaveWelcome(() => {
      setThinking(true);
      window.setTimeout(() => {
        if (!alive.current) return;
        setThinking(false);
        setTurns((all) => [...all, { role: 'assistant', text: TIPS_MESSAGE, local: true, fresh: true }]);
      }, 700);
    });
  const settle = useCallback((index: number) => setTurns((all) => all.map((t, i) => (i === index && t.fresh ? { ...t, fresh: false } : t))), []);
  const toBottom = useCallback(() => log.current?.scrollTo({ top: log.current.scrollHeight }), []);
  // The question box grows with what is typed, up to about four lines, in every browser (CSSOM: the CSP refuses
  // style attributes); past that it scrolls without a bar.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.setProperty('height', 'auto');
    el.style.setProperty('height', `${Math.min(el.scrollHeight, 120)}px`);
    el.style.setProperty('overflow-y', el.scrollHeight > 120 ? 'auto' : 'hidden');
  }, [text, open, welcome]);
  // The box moves from the middle to the bottom when the chat starts: the typing goes on there.
  useEffect(() => {
    if (open && !welcome) input.current?.focus();
  }, [open, welcome]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send(text);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(text);
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
              <button type="button" className="icon-btn" aria-label="เริ่มแชทใหม่" title="เริ่มแชทใหม่" disabled={busy || thinking} onClick={() => setTurns([])}>
                <Icon name="trash" />
              </button>
            )}
            <button type="button" className="icon-btn" aria-label="ปิดผู้ช่วย AI" onClick={() => setOpen(false)}>
              <Icon name="close" />
            </button>
          </header>
          {welcome ? (
            <div className={`assistant-welcome${leaving ? ' leaving' : ''}`}>
              <div className="assistant-hello">
                <h2>สวัสดี{userName ? ` คุณ${userName}` : ''}</h2>
                <p>วันนี้ให้ช่วยเรื่องอะไรดี</p>
              </div>
              <form className="assistant-ask" onSubmit={submit}>
                <label className="sr-only" htmlFor="assistant-input">
                  คำถามถึงผู้ช่วย AI
                </label>
                <textarea
                  id="assistant-input"
                  ref={input}
                  rows={1}
                  maxLength={2000}
                  value={text}
                  placeholder={typed}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onKeyDown}
                />
                <button type="submit" className="assistant-ask-send" aria-label="ส่งคำถาม" disabled={busy || !text.trim()}>
                  <Icon name="send" />
                </button>
              </form>
              <div className="assistant-suggestions" role="group" aria-label="ลองถาม">
                <span className="assistant-suggestions-title">ลองถาม</span>
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="assistant-suggestion" onClick={() => send(s)}>
                    <Icon name="arrow" />
                    <span>{s}</span>
                  </button>
                ))}
              </div>
              <p className="assistant-welcome-note">
                AI อาจตอบผิด ตรวจก่อนส่งให้ลูกค้า ·{' '}
                <button type="button" className="assistant-tips-link" onClick={showTips}>
                  เคล็ดลับการถาม
                </button>
              </p>
            </div>
          ) : (
            <>
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
                ) : (
                  turns.map((t, i) => (
                    <div key={i} className={`assistant-turn ${t.role}${t.failed ? ' failed' : ''}${t.fresh ? ' fresh' : ''}`}>
                      <div className="assistant-bubble">
                        {t.role === 'assistant' ? <RevealText text={t.text} animate={Boolean(t.fresh)} onGrow={toBottom} onDone={() => settle(i)} /> : t.text}
                      </div>
                      {t.role === 'assistant' && !t.failed && !t.local && !t.fresh && (
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
                {(busy || thinking) && (
                  <div className="assistant-turn assistant fresh">
                    <div className="assistant-bubble assistant-typing" aria-label="AI กำลังตอบ">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                )}
              </div>
              {/* The same box as on the first screen, now at the bottom. */}
              <div className="assistant-form">
                <form className="assistant-ask" onSubmit={submit}>
                  <label className="sr-only" htmlFor="assistant-input">
                    คำถามถึงผู้ช่วย AI
                  </label>
                  <textarea
                    id="assistant-input"
                    ref={input}
                    rows={1}
                    maxLength={2000}
                    value={text}
                    disabled={!ready}
                    placeholder={ready ? 'ถามต่อได้เลย…' : 'ยังไม่เปิดใช้'}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={onKeyDown}
                  />
                  <button type="submit" className="assistant-ask-send" aria-label="ส่งคำถาม" disabled={!ready || busy || !text.trim()}>
                    <Icon name="send" />
                  </button>
                </form>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
