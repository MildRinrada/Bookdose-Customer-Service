'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/ui/Toast';
import { requestCallback } from '../api';
import type { CallbackRequest, CallbackState } from '../types';

/* ขอให้ติดต่อกลับ in a chat (the signed-in customer's and the visitor's; backend portal/callback.py): how - by phone or
   the organization's LINE (only once linked) - and a time from the ones offered. The team gets it as a follow-up
   reminder on the chat's case. A request waiting is shown with its time and can be called off or changed. In a dialog:
   inside the chat, whose height is the window's, the form had no room. Markup: styles/pages/chat-answers.css (callback-*). */

const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** A slot's day in words: วันนี้, พรุ่งนี้, or วันพุธที่ 1 ต.ค. (the day is already Thai time). */
function dayWords(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 31 * 3600_000).toISOString().slice(0, 10);
  if (day === today) return 'วันนี้';
  if (day === tomorrow) return 'พรุ่งนี้';
  return `วัน${DAYS[date.getUTCDay()]}ที่ ${d} ${MONTHS[m - 1]}`;
}

/** The time of a request in Thai time: "วันพุธที่ 1 ต.ค. 09:00-12:00 น.". */
export function callbackWhen(request: Pick<CallbackRequest, 'start' | 'end'>): string {
  const thai = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString();
  const start = thai(request.start);
  return `${dayWords(start.slice(0, 10))} ${start.slice(11, 16)}-${thai(request.end).slice(11, 16)} น.`;
}

export function CallbackButton({ waiting, onOpen }: { waiting: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      className={`icon-btn conv-callback${waiting ? ' waiting' : ''}`}
      aria-haspopup="dialog"
      aria-label={waiting ? 'ดูคำขอให้ติดต่อกลับ' : 'ขอให้ติดต่อกลับ'}
      title={waiting ? 'ดูคำขอให้ติดต่อกลับ' : 'ขอให้ทีมงานโทรหรือส่ง LINE กลับในเวลาที่สะดวก'}
      onClick={onOpen}
    >
      <Icon name="phone" />
    </button>
  );
}

const SHORT_DAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const PHONE = /^(?:0\d{8,9}|\+\d{9,14})$/;

/** A day on its button: วันนี้, พรุ่งนี้, or พ. 1 ต.ค. */
function dayChip(day: string): string {
  const words = dayWords(day);
  if (!words.startsWith('วัน')) return words;
  const [y, m, d] = day.split('-').map(Number);
  return `${SHORT_DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}

type Problems = { phone?: string; slot?: string; form?: string };

/** Which field a refusal from the server is about, so it shows under that field. */
function placeProblem(message: string): Problems {
  if (message.includes('เบอร์')) return { phone: message };
  if (message.includes('ช่วงเวลา')) return { slot: message };
  return { form: message };
}

export function CallbackPanel({
  base,
  conversationId,
  state,
  onDone,
  onClose,
}: {
  /** /api/public/<org> for a signed-in customer, …/guest for a visitor. */
  base: string;
  conversationId: string;
  state: CallbackState;
  onDone: () => Promise<unknown> | void;
  onClose: () => void;
}) {
  const toast = useToast();
  const waiting = state.waiting;
  const [editing, setEditing] = useState(!waiting);
  const [method, setMethod] = useState<'phone' | 'line'>('phone');
  const [phone, setPhone] = useState(state.phone);
  const days = [...new Set(state.slots.map((s) => s.day))];
  const [day, setDay] = useState(days[0] ?? '');
  const [start, setStart] = useState(state.slots[0]?.start ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<Problems>({});
  const id = (part: string) => `callback-${part}-${conversationId}`;

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setProblems({});
    try {
      const result = await requestCallback(base, conversationId, body);
      await onDone();
      toast(result.waiting ? `ขอให้ติดต่อกลับแล้ว ${callbackWhen(result.waiting)}` : 'ยกเลิกคำขอให้ติดต่อกลับแล้ว');
      onClose();
    } catch (error) {
      setProblems(placeProblem(error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(false);
    }
  };

  if (waiting && !editing)
    return (
      <section className="callback-form" aria-label="คำขอให้ติดต่อกลับ">
        {problems.form && <p className="notice warning callback-problem">{problems.form}</p>}
        <div className="callback-waiting">
          <Icon name="phone" />
          <p>
            <strong>{waiting.method === 'phone' ? `โทรหา ${waiting.phone}` : 'ส่งข้อความทาง LINE'}</strong>
            <span>{callbackWhen(waiting)}</span>
            {waiting.note && <span className="muted">{waiting.note}</span>}
          </p>
        </div>
        <div className="form-actions">
          <button type="button" className="btn danger" disabled={busy} onClick={() => void send({ cancel: true })}>
            ยกเลิกคำขอ
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => setEditing(true)}>
            เปลี่ยนเวลา
          </button>
        </div>
      </section>
    );

  if (!state.slots.length)
    return (
      <section className="callback-form" aria-label="ขอให้ติดต่อกลับ">
        <p className="callback-intro">ตอนนี้ไม่มีช่วงเวลาให้เลือกใน 7 วันข้างหน้า พิมพ์ถึงทีมงานในแชทนี้ได้เลย</p>
      </section>
    );

  const slots = state.slots.filter((s) => s.day === day);
  return (
    <form
      className="callback-form"
      aria-label="ขอให้ติดต่อกลับ"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const digits = phone.replace(/[\s()-]/g, '');
        if (method === 'phone' && !PHONE.test(digits)) {
          setProblems({ phone: digits ? 'เบอร์โทรไม่ถูกต้อง กรอก 9 หรือ 10 หลัก' : 'กรอกเบอร์โทรที่ให้ทีมงานโทรกลับ' });
          document.getElementById(id('phone'))?.focus();
          return;
        }
        void send({ method, phone: digits, start, note });
      }}
    >
      {problems.form && <p className="notice warning callback-problem">{problems.form}</p>}
      {/* A choice only when there is one: without a linked LINE it is by phone. */}
      {state.line_ready && (
        <fieldset className="callback-group">
          <legend>ติดต่อกลับทาง</legend>
          <div className="choice-chips">
            {(
              [
                ['phone', 'โทรศัพท์'],
                ['line', 'LINE'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="choice-chip">
                <input className="sr-only" type="radio" name="method" checked={method === key} onChange={() => setMethod(key)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {method === 'phone' && (
        <div className="field callback-phone">
          <label htmlFor={id('phone')}>เบอร์โทร</label>
          <input
            id={id('phone')}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={20}
            value={phone}
            aria-invalid={Boolean(problems.phone)}
            aria-describedby={problems.phone ? id('phone-problem') : undefined}
            onChange={(e) => {
              setPhone(e.target.value);
              if (problems.phone) setProblems((p) => ({ ...p, phone: undefined }));
            }}
          />
          {problems.phone && (
            <p className="field-error" id={id('phone-problem')} role="alert">
              {problems.phone}
            </p>
          )}
        </div>
      )}
      <fieldset className="callback-group">
        <legend>วันที่สะดวก</legend>
        <div className="choice-chips">
          {days.map((d) => (
            <label key={d} className="choice-chip">
              <input
                className="sr-only"
                type="radio"
                name="day"
                checked={day === d}
                onChange={() => {
                  setDay(d);
                  setStart(state.slots.find((s) => s.day === d)?.start ?? '');
                }}
              />
              {dayChip(d)}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="callback-group">
        <legend>ช่วงเวลา</legend>
        <div className="choice-chips">
          {slots.map((s) => (
            <label key={s.start} className="choice-chip">
              <input className="sr-only" type="radio" name="start" checked={start === s.start} onChange={() => setStart(s.start)} />
              {s.label} น.
            </label>
          ))}
        </div>
        {problems.slot && (
          <p className="field-error" role="alert">
            {problems.slot}
          </p>
        )}
      </fieldset>
      <div className="field">
        <label htmlFor={id('note')}>รายละเอียดเพิ่มเติม (ไม่บังคับ)</label>
        <input id={id('note')} maxLength={300} autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="form-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => (waiting ? setEditing(false) : onClose())}>
          {waiting ? 'ไม่เปลี่ยน' : 'ยกเลิก'}
        </button>
        <button type="submit" className="btn primary" disabled={busy}>
          ขอให้ติดต่อกลับ
        </button>
      </div>
    </form>
  );
}
