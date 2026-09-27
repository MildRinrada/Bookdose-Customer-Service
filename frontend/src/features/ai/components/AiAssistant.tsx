'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Icon } from '@/components/Icon';
import { usePreferences } from '@/features/staff-account/prefs';
import { useBoot, useWork } from '@/lib/session';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api/client';
import { askAssistant, stopAssistant, waitForAiJob } from '../api';
import type { AiCitation, AssistantFeedback, AssistantResult } from '../types';
import { AiCitations } from './AiCitations';
import { useWorkspaceAi } from './AiControls';
import { AnswerRating } from './AnswerRating';
import { AssistantActions } from './AssistantActions';
import { afterCheck, AssistantProgress, AssistantTrace, traceOf, type AssistantTraceData, type AssistantWait } from './AssistantProgress';
import { PersonaPicker, personaLabels } from './PersonaPicker';

/* ผู้ช่วย AI: the floating button at the bottom right of every staff page. A member of the team asks anything about
   their work, asks it to find or summarize cases, tells it what to do with cases, or asks why something does not
   work; the answer comes from the organization's AI (n8n, OpenAI or Gemini) with the knowledge articles it quotes and
   what it proposes to do, which the member confirms (AssistantActions). The case or chat open on the page goes with
   each question ("this case"). The chat is kept for this browser tab only (sessionStorage), and the last turns go with
   each question. Markup: pages/ai-assistant.css. */

/** local: written by the page itself (the tips), never sent to the AI as part of the chat. fresh: just arrived, so it
    slides in and an answer's words appear as if being written (never saved). job and result: the answer's job, what it
    proposes to do and the cases it names (the server's, AssistantResult). */
type Turn = {
  role: 'user' | 'assistant';
  text: string;
  citations?: AiCitation[];
  failed?: boolean;
  local?: boolean;
  fresh?: boolean;
  job?: string;
  result?: Pick<AssistantResult, 'actions' | 'dropped' | 'cases' | 'ran'>;
  /** How the answer came about: what was read, the wait, the thinking (folded under it). */
  trace?: AssistantTraceData;
  /** What the member thought of the answer (ถูกใจ / ไม่ถูกใจ). */
  feedback?: AssistantFeedback;
};

/** The case or chat open on the page: /tickets/<id> or /inbox/<id>. */
function pageOf(pathname: string | null): { ticket_id?: string; conversation_id?: string } | null {
  const found = /^\/(tickets|inbox)\/([a-f0-9]{32})(?:\/|$)/.exec(pathname ?? '');
  if (!found) return null;
  return found[1] === 'tickets' ? { ticket_id: found[2] } : { conversation_id: found[2] };
}

/** What the AI reads of an earlier answer: its words, and whether what it proposed was done. */
function historyText(turn: Turn): string {
  const actions = turn.result?.actions?.length ?? 0;
  const ran = turn.result?.ran;
  if (ran) return `${turn.text}\n(กดทำเลยแล้ว สำเร็จ ${ran.results.filter((r) => r.ok).length} จาก ${ran.results.length} รายการ)`;
  return actions ? `${turn.text}\n(เสนอไว้ ${actions} รายการ ยังไม่ได้กดทำเลย)` : turn.text;
}

/** The answer with each case it names (BD-12) as a link to the case, when the member may open it. */
function LinkedText({ text, cases, onOpen }: { text: string; cases?: Record<string, string>; onOpen: () => void }) {
  if (!cases || !Object.keys(cases).length) return <>{text}</>;
  return (
    <>
      {text.split(/(BD-\d+)/gi).map((part, i) => {
        const id = cases[part.toUpperCase()];
        return id ? (
          <Link key={i} className="assistant-case-link" href={`/tickets/${id}`} onClick={onOpen}>
            {part}
          </Link>
        ) : (
          part
        );
      })}
    </>
  );
}

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
  'เคสไหนค้างนานที่สุด สรุปให้หน่อย',
  'เคสที่ยังไม่มีคนรับ ช่วยแจกให้คนในทีม',
  'ทำไมเคสใหม่ไม่ถูกแจกอัตโนมัติ',
  'ช่วยเขียนข้อความขอโทษลูกค้าที่รอคำตอบนาน',
];
const HISTORY_SENT = 12;
/** What the assistant says when "เคล็ดลับถามให้ได้คำตอบที่ดี" is pressed (written here, not asked of the AI). */
const TIPS_MESSAGE = [
  'เคล็ดลับการใช้ผู้ช่วยครับ',
  '',
  '1. บอกให้ชัดว่าอยากได้อะไร เช่น เขียนข้อความตอบลูกค้า สรุปเคส หรือหาบทความ',
  '2. สั่งงานได้เลย เช่น ปิดเคสนี้ มอบหมายเคสให้เพื่อนในทีม ติดป้าย หรือพักเคสไว้ถึงพรุ่งนี้ ผมจะสรุปรายการให้ตรวจก่อน แล้วคุณกด ทำเลย',
  '3. เปิดหน้าเคสไว้แล้วพิมพ์ว่า "เคสนี้" ได้ ผมรู้ว่าคุณดูเคสไหนอยู่',
  '4. ถ้ามีอะไรไม่ทำงาน ถามว่า "ทำไม..." ผมจะตรวจการตั้งค่าและช่องทางให้ และเสนอวิธีแก้',
  '5. ถ้าคำตอบยังไม่ตรง ถามต่อในแชทนี้ได้เลย ผมจำข้อความก่อนหน้าไว้',
  '',
  'ผมเห็นและทำได้เฉพาะเคสที่คุณมีสิทธิ์ และทำด้วยสิทธิ์ของคุณเท่านั้นครับ',
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
  const pathname = usePathname();
  const ai = useWorkspaceAi();
  const ready = Boolean(ai.drafts_enabled && ai.key_configured);
  const key = `bd-assistant:${work.tenant.id}`;
  const [open, setOpen] = useState(false);
  // Grown to most of the screen, for a long answer; remembered on this browser.
  const [large, setLarge] = useState(() => {
    try {
      return localStorage.getItem('bd-assistant:large') === '1';
    } catch {
      return false;
    }
  });
  const [turns, setTurns] = useState<Turn[]>([]);
  // Whose chat `turns` holds: nothing is saved before this tab's chat was read, or the empty start would be written
  // over it (as it was on every reload in development, where effects run twice).
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState<AssistantWait | null>(null);
  // The wait as the latest check left it (read by the checks and by หยุดรอ), and the question the member stopped.
  const waitRef = useRef<AssistantWait | null>(null);
  const stopRef = useRef<{ job: string; started: boolean | null } | null>(null);
  const stoppedMark = (job: string) => (stopRef.current?.job === job ? stopRef.current : null);
  const toast = useToast();
  // leaving: the first screen fading out; thinking: the dots before the tips (written here) appear.
  const [leaving, setLeaving] = useState(false);
  const [thinking, setThinking] = useState(false);
  // The assistant's personality, chosen by the member before the first question and changed from the heading.
  const prefs = usePreferences(open && ready);
  const persona = prefs.data?.preferences.assistant ?? null;
  const [choosing, setChoosing] = useState(false);
  const picking = ready && open && (choosing || (persona !== null && !persona.persona));
  const alive = useRef(true);
  const showWait = (next: AssistantWait | null) => {
    waitRef.current = next;
    if (alive.current) setWait(next);
  };
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    alive.current = true;
    setTurns(load(key));
    setLoadedKey(key);
    return () => {
      alive.current = false;
    };
  }, [key]);

  useEffect(() => {
    if (loadedKey !== key) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(turns.slice(-40).map((t) => ({ ...t, fresh: undefined }))));
    } catch {
      // Private windows may refuse storage: the chat still works until the page closes.
    }
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [key, loadedKey, turns, busy, thinking, wait?.phase]);

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
    const history = turns.filter((t) => !t.failed && !t.local).slice(-HISTORY_SENT).map((t) => ({ role: t.role, text: historyText(t) }));
    setTurns((all) => [...all, { role: 'user', text: q, fresh: true }]);
    setText('');
    setBusy(true);
    stopRef.current = null;
    // Every step of the wait is shown as the server reports it (AssistantProgress).
    const current = () => waitRef.current as AssistantWait;
    showWait({ started: Date.now(), phase: 'reading' });
    try {
      const queued = await askAssistant(q, history, pageOf(pathname));
      showWait({ ...current(), phase: 'queued', job: queued.id, gathered: queued.gathered, queuedAt: Date.now(), lastCheck: Date.now() });
      const job = await waitForAiJob(queued.id, () => alive.current, {
        onCheck: (checked) => showWait(afterCheck(current(), checked)),
        onOffline: (failures, most) => showWait({ ...current(), offline: failures, offlineMost: most }),
      });
      const stop = stoppedMark(job.id);
      if (job.status === 'cancelled' && stop) {
        // Stopped by the member: a plain note, and the question leaves what the AI reads of this chat next time.
        const note = stop.started
          ? 'หยุดรอแล้ว AI เริ่มคิดไปแล้ว จึงยังนับเป็นการใช้งาน AI ของวันนี้ และคำตอบนั้นจะไม่แสดง ถามใหม่ได้เลย'
          : stop.started === false
            ? 'หยุดรอแล้ว AI ยังไม่ได้เริ่มคิดคำถามนี้ ถามใหม่ได้เลย'
            : 'หยุดรอแล้ว ถามใหม่ได้เลย';
        if (alive.current)
          setTurns((all) => [
            ...all.map((t, i) => (i === all.length - 1 && t.role === 'user' ? { ...t, local: true } : t)),
            { role: 'assistant', text: note, local: true, fresh: true },
          ]);
        return;
      }
      const result = job.result as Partial<AssistantResult>;
      const answer: Turn =
        job.status === 'done' && result.answer
          ? {
              role: 'assistant' as const,
              text: result.answer,
              citations: result.citations,
              fresh: true,
              job: job.id,
              result: { actions: result.actions ?? [], dropped: result.dropped ?? 0, cases: result.cases ?? {} },
              trace: traceOf(current()),
            }
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
      if (alive.current) {
        setBusy(false);
        showWait(null);
      }
    }
  };

  // หยุดรอ: marked before the server is asked, so a check that sees the job stopped first still reads as the member's
  // doing. A question that finished meanwhile (409) simply shows its answer; any other failure says why and keeps waiting.
  const stopWaiting = async () => {
    const w = waitRef.current;
    if (!w?.job || w.stopping) return;
    stopRef.current = { job: w.job, started: null };
    showWait({ ...w, stopping: true });
    try {
      const done = await stopAssistant(w.job);
      if (stopRef.current?.job === w.job) stopRef.current = { job: w.job, started: done.started };
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) return;
      stopRef.current = null;
      toast(error instanceof Error ? error.message : String(error), true);
      const again = waitRef.current;
      if (again) showWait({ ...again, stopping: false });
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
  // What ทำเลย did stays with the answer (and in this tab's saved chat), so the list is never offered twice.
  const markRan = (index: number, ran: NonNullable<AssistantResult['ran']>) =>
    setTurns((all) => all.map((t, i) => (i === index && t.result ? { ...t, result: { ...t.result, ran } } : t)));
  const markRated = (index: number, feedback: AssistantFeedback) => setTurns((all) => all.map((t, i) => (i === index ? { ...t, feedback } : t)));
  // On a phone the chat covers the page: following a case link gets it out of the way.
  const openedCase = () => {
    if (window.matchMedia('(max-width: 600px)').matches) setOpen(false);
  };
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
        <section id="ai-assistant" className={`assistant-panel${large ? ' large' : ''}`} role="dialog" aria-modal="false" aria-label="ผู้ช่วย AI">
          <header className="assistant-head">
            <span className="assistant-mark" aria-hidden="true">
              <Icon name="sparkle" />
            </span>
            <div className="grow">
              <strong>ผู้ช่วย AI</strong>
              <span>ถามหรือสั่งงานได้เลย</span>
            </div>
            {ready && persona?.persona && !picking && (
              <button
                type="button"
                className="assistant-persona"
                title={persona.persona === 'custom' ? persona.custom : 'เปลี่ยนบุคลิกของผู้ช่วย'}
                onClick={() => setChoosing(true)}
              >
                {personaLabels[persona.persona]}
              </button>
            )}
            {turns.length > 0 && (
              <button type="button" className="icon-btn" aria-label="เริ่มแชทใหม่" title="เริ่มแชทใหม่" disabled={busy || thinking} onClick={() => setTurns([])}>
                <Icon name="trash" />
              </button>
            )}
            <button
              type="button"
              className="icon-btn assistant-size"
              aria-pressed={large}
              aria-label={large ? 'ย่อหน้าต่าง' : 'ขยายหน้าต่าง'}
              title={large ? 'ย่อหน้าต่าง' : 'ขยายหน้าต่าง'}
              onClick={() => {
                const next = !large;
                setLarge(next);
                try {
                  localStorage.setItem('bd-assistant:large', next ? '1' : '0');
                } catch {
                  // Private windows may refuse storage.
                }
              }}
            >
              <Icon name={large ? 'shrink' : 'expand'} />
            </button>
            <button type="button" className="icon-btn" aria-label="ปิดผู้ช่วย AI" onClick={() => setOpen(false)}>
              <Icon name="close" />
            </button>
          </header>
          {picking ? (
            <PersonaPicker current={persona} onDone={() => setChoosing(false)} />
          ) : welcome ? (
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
                        {t.role === 'user' ? (
                          t.text
                        ) : t.fresh ? (
                          <RevealText text={t.text} animate onGrow={toBottom} onDone={() => settle(i)} />
                        ) : (
                          <LinkedText text={t.text} cases={t.result?.cases} onOpen={openedCase} />
                        )}
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
                          {t.job && <AnswerRating jobId={t.job} value={t.feedback} onChange={(feedback) => markRated(i, feedback)} />}
                          <AiCitations citations={t.citations} />
                          {t.trace && (
                            <AssistantTrace
                              trace={t.trace}
                              citations={t.citations?.length ?? 0}
                              actions={t.result?.actions?.length ?? 0}
                              dropped={t.result?.dropped ?? 0}
                            />
                          )}
                        </div>
                      )}
                      {t.job && t.result?.actions?.length && !t.fresh ? (
                        <AssistantActions jobId={t.job} result={t.result} onRan={(ran) => markRan(i, ran)} onOpenCase={openedCase} />
                      ) : null}
                    </div>
                  ))
                )}
                {busy && wait ? (
                  <AssistantProgress wait={wait} onStop={() => void stopWaiting()} />
                ) : (
                  (busy || thinking) && (
                    <div className="assistant-turn assistant fresh">
                      <div className="assistant-bubble assistant-typing" aria-label="AI กำลังตอบ">
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                  )
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
