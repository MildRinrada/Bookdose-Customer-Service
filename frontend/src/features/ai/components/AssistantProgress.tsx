'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import type { AiJob, AssistantGathered } from '../types';

/* While the assistant works (AiAssistant.tsx): what it is doing right now, step by step, from what the server says -
   what was read for the question, the jobs ahead of it, how long the AI has been thinking, the most that may take -
   and whether the page is still hearing from the server. A wait that says what is happening is not taken for a hang.
   Nothing here is made up: a step is done when the server says so, and times come from the server's answers.
   After the answer the same steps fold under it (AssistantTrace). Markup: pages/ai-assistant.css (assistant-progress). */

/** Where the wait stands, built from the POST's answer and each check of the job (afterCheck). */
export type AssistantWait = {
  started: number;
  phase: 'reading' | 'queued' | 'thinking';
  /** The question's job, once queued (หยุดรอ needs it), and whether หยุดรอ was pressed. */
  job?: string;
  stopping?: boolean;
  gathered?: AssistantGathered;
  /** When the question was queued (the POST answered), and when the AI took it, by this browser's clock. */
  queuedAt?: number;
  thinkingSince?: number;
  ahead?: number;
  provider?: string;
  limit?: number;
  lastCheck?: number;
  /** Checks in a row that could not reach the server, and how many are tried before giving up. */
  offline?: number;
  offlineMost?: number;
};

/** How the answer came about, kept with it (AssistantTrace). Seconds. */
export type AssistantTraceData = { seconds: number; queued: number | null; thinking: number | null; gathered?: AssistantGathered; provider?: string };

const PROVIDERS: Record<string, string> = { openai: 'OpenAI', gemini: 'Gemini', n8n: 'n8n ขององค์กร' };

/** The wait after one check of the job: the AI took it (the thinking started that long ago, by the server), or it is
    still in line behind `ahead` jobs. */
export function afterCheck(wait: AssistantWait, job: AiJob): AssistantWait {
  const p = job.progress;
  const now = Date.now();
  const next: AssistantWait = { ...wait, lastCheck: now, offline: 0, provider: p?.provider || wait.provider, limit: p?.limit_seconds || wait.limit };
  // Never before the question was queued: the server's whole seconds must not make the thinking longer than the wait.
  const since = wait.thinkingSince ?? Math.max(wait.queuedAt ?? wait.started, now - (p?.running_seconds ?? 0) * 1000);
  if (job.status === 'running') return { ...next, phase: 'thinking', ahead: 0, thinkingSince: since };
  if (job.status === 'pending') return { ...next, phase: 'queued', ahead: p?.ahead ?? 0 };
  return next;
}

export function traceOf(wait: AssistantWait, now = Date.now()): AssistantTraceData {
  const seconds = (from?: number, to = now) => (from ? Math.max(0, Math.round((to - from) / 1000)) : null);
  return {
    seconds: seconds(wait.started) ?? 0,
    queued: wait.queuedAt && wait.thinkingSince ? seconds(wait.queuedAt, wait.thinkingSince) : null,
    thinking: seconds(wait.thinkingSince),
    gathered: wait.gathered,
    provider: wait.provider,
  };
}

/** "8 วินาที", "2 นาที 5 วินาที". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s} วินาที` : `${Math.floor(s / 60)} นาที${s % 60 ? ` ${s % 60} วินาที` : ''}`;
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** What was read for the question, as short pieces. */
function gatheredParts(g: AssistantGathered): string[] {
  return [
    g.cases_not_listed ? `${g.cases} จาก ${g.cases + g.cases_not_listed} เคส` : `${g.cases} เคส`,
    g.articles ? `บทความที่ตรง ${g.articles} บทความ` : 'ไม่พบบทความที่ตรง',
    g.current === 'chat' ? 'แชทที่คุณเปิดอยู่' : g.current ? `${g.current} ที่คุณเปิดอยู่` : '',
    g.customers ? 'เคสของลูกค้าที่คุณพูดถึง' : '',
    `ทีมงาน ${g.members} คน`,
    'สถานะช่องทาง การแจกเคส และ AI',
    g.history ? `แชทก่อนหน้า ${g.history} ข้อความ` : '',
  ].filter(Boolean);
}

function Gathered({ gathered }: { gathered: AssistantGathered }) {
  return (
    <span className="assistant-gathered">
      {gatheredParts(gathered).map((part) => (
        <span key={part}>{part}</span>
      ))}
    </span>
  );
}

type Step = { key: string; state: 'done' | 'active' | 'todo'; label: string; detail?: ReactNode };

function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="assistant-steps">
      {steps.map((step) => (
        <li key={step.key} className={step.state}>
          <span className="assistant-step-mark" aria-hidden="true">
            {step.state === 'done' ? <Icon name="check" /> : step.state === 'active' ? <span className="assistant-spinner" /> : null}
          </span>
          <div>
            <span className="assistant-step-label">{step.label}</span>
            {step.detail && step.state !== 'todo' && <div className="assistant-step-detail">{step.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The clock of the wait, a tick a second while it is on screen. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function AssistantProgress({ wait, onStop }: { wait: AssistantWait; onStop: () => void }) {
  const now = useNow();
  const provider = PROVIDERS[wait.provider ?? ''] ?? 'AI';
  const phase = wait.phase;
  const thinking = wait.thinkingSince ? (now - wait.thinkingSince) / 1000 : 0;
  const order = ['reading', 'queued', 'thinking'];
  const at = (step: string): Step['state'] => (order.indexOf(step) < order.indexOf(phase) ? 'done' : step === phase ? 'active' : 'todo');
  const hint =
    wait.provider === 'n8n' && thinking >= 40
      ? 'n8n ที่ใช้โมเดลบนเครื่องอาจใช้เวลาหลายนาที ยังทำงานอยู่ตามปกติ'
      : thinking >= 15
        ? 'คำถามที่ต้องดูหลายเคส หรือเสนอหลายรายการ ใช้เวลานานขึ้น ยังทำงานอยู่ตามปกติ'
        : '';
  const steps: Step[] = [
    {
      key: 'reading',
      state: at('reading'),
      label: phase === 'reading' ? 'กำลังอ่านข้อมูลที่เกี่ยวข้อง' : 'อ่านข้อมูลที่เกี่ยวข้องแล้ว',
      detail: wait.gathered ? <Gathered gathered={wait.gathered} /> : 'ส่งคำถาม และรวบรวมเคส บทความ และสถานะระบบที่คุณมีสิทธิ์เห็น',
    },
    {
      key: 'queued',
      state: at('queued'),
      label: phase === 'thinking' ? `${provider} รับงานแล้ว` : 'รอคิว AI',
      detail:
        phase === 'queued'
          ? wait.ahead
            ? `มีงาน AI ขององค์กรทำอยู่ก่อน ${wait.ahead} งาน ระบบทำทีละงาน`
            : 'กำลังส่งงานให้ AI'
          : wait.queuedAt && wait.thinkingSince && wait.thinkingSince - wait.queuedAt >= 3000
            ? `รอคิว ${duration((wait.thinkingSince - wait.queuedAt) / 1000)}`
            : '',
    },
    {
      key: 'thinking',
      state: at('thinking'),
      label: phase === 'thinking' ? `${provider} กำลังคิดคำตอบ` : 'AI คิดคำตอบ',
      detail: (
        <>
          <span>คิดมาแล้ว {duration(thinking)}</span>
          {hint && <span>{hint}</span>}
          {wait.limit ? <span>รอได้นานสุด {duration(wait.limit)} ถ้าเกินระบบจะหยุดรอและแจ้งให้ทราบ</span> : null}
        </>
      ),
    },
    { key: 'checking', state: 'todo', label: 'ตรวจคำตอบและรายการที่เสนอกับเคสและสิทธิ์ของคุณ' },
  ];
  const current = steps.find((s) => s.state === 'active') ?? steps[0];
  const stepNo = steps.indexOf(current) + 1;
  // Whether the page still hears from the server: the proof that nothing hangs, or the honest word that it does not.
  // The clock ticks once a second, so a check may be newer than it: never "-1 วินาทีที่แล้ว".
  const since = wait.lastCheck ? Math.max(0, Math.floor((now - wait.lastCheck) / 1000)) : null;
  const pulse = wait.offline
    ? { tone: 'warn', text: `เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กำลังลองใหม่ (ครั้งที่ ${wait.offline} จาก ${wait.offlineMost ?? 5}) งานของ AI ยังทำต่อที่เซิร์ฟเวอร์` }
    : since !== null && since >= 8
      ? { tone: 'warn', text: `ไม่ได้รับสถานะจากเซิร์ฟเวอร์มา ${duration(since)}` }
      : since !== null
        ? { tone: 'live', text: `เชื่อมต่ออยู่ อัปเดตสถานะล่าสุด ${since} วินาทีที่แล้ว` }
        : { tone: 'live', text: 'กำลังส่งคำถาม' };

  return (
    <div className="assistant-turn assistant fresh">
      <div className="assistant-progress">
        <div className="assistant-progress-head">
          <span className="assistant-spinner" aria-hidden="true" />
          <strong>
            ผู้ช่วยกำลังทำงาน ขั้นที่ {stepNo} จาก {steps.length}
          </strong>
          <span className="assistant-progress-clock" aria-label={`ใช้เวลาแล้ว ${duration((now - wait.started) / 1000)}`}>
            {clock(now - wait.started)}
          </span>
        </div>
        {/* Read out when the step changes, not every second. */}
        <span className="sr-only" role="status">
          {current.label}
        </span>
        <StepList steps={steps} />
        <div className="assistant-progress-foot">
          <p className={`assistant-progress-pulse ${pulse.tone}`}>
            <span aria-hidden="true" />
            {pulse.text}
          </p>
          {/* From the moment there is a question to stop (the server has queued it). */}
          {wait.job && (
            <button type="button" className="btn sm" disabled={wait.stopping} onClick={onStop}>
              <Icon name="close" />
              {wait.stopping ? 'กำลังหยุด…' : 'หยุดรอ'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** How the answer came about, folded under it: the same steps, all done, with their times. */
export function AssistantTrace({ trace, citations, actions, dropped }: { trace: AssistantTraceData; citations: number; actions: number; dropped: number }) {
  const provider = PROVIDERS[trace.provider ?? ''] ?? 'AI';
  const checked = [citations ? `อ้างอิง ${citations} บทความ` : '', actions ? `เสนอ ${actions} รายการ` : 'ไม่มีรายการที่ต้องทำ', dropped ? `ข้าม ${dropped} รายการ` : '']
    .filter(Boolean)
    .join(' ');
  const steps: Step[] = [
    { key: 'reading', state: 'done', label: 'อ่านข้อมูลที่เกี่ยวข้อง', detail: trace.gathered ? <Gathered gathered={trace.gathered} /> : undefined },
    { key: 'queued', state: 'done', label: trace.queued ? `รอคิว ${duration(trace.queued)}` : 'AI รับงานทันที' },
    { key: 'thinking', state: 'done', label: trace.thinking !== null ? `${provider} คิด ${duration(trace.thinking)}` : `${provider} ตอบแล้ว` },
    { key: 'checking', state: 'done', label: 'ตรวจคำตอบแล้ว', detail: checked },
  ];
  return (
    <details className="assistant-trace">
      <summary>ใช้เวลา {duration(trace.seconds)}</summary>
      <StepList steps={steps} />
    </details>
  );
}
