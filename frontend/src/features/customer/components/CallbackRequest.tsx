'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { requestCallback } from '../api';
import type { CallbackRequest, CallbackState } from '../types';

/* ขอให้ติดต่อกลับ in a chat (the signed-in customer's and the visitor's; backend portal/callback.py): how - by phone or
   the organization's LINE (only once linked) - and a time from the ones offered. The team gets it as a follow-up
   reminder on the chat's case. A request waiting is shown with its time and can be called off or changed.
   Markup: styles/pages/chat-answers.css (callback-*). */

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

export function CallbackButton({ open, waiting, onToggle }: { open: boolean; waiting: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`icon-btn conv-callback${waiting ? ' waiting' : ''}`}
      aria-expanded={open}
      aria-label={waiting ? 'ดูคำขอให้ติดต่อกลับ' : 'ขอให้ติดต่อกลับ'}
      title={waiting ? 'ดูคำขอให้ติดต่อกลับ' : 'ขอให้ทีมงานโทรหรือส่ง LINE กลับในเวลาที่สะดวก'}
      onClick={onToggle}
    >
      <Icon name="phone" />
    </button>
  );
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
  const waiting = state.waiting;
  const [editing, setEditing] = useState(!waiting);
  const [method, setMethod] = useState<'phone' | 'line'>('phone');
  const [day, setDay] = useState(state.slots[0]?.day ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const days = [...new Set(state.slots.map((s) => s.day))];

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setProblem('');
    try {
      const result = await requestCallback(base, conversationId, body);
      await onDone();
      if (result.waiting) setEditing(false);
      else onClose();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const close = (
    <button type="button" className="icon-btn callback-close" aria-label="ปิด" onClick={onClose}>
      <Icon name="close" />
    </button>
  );

  if (waiting && !editing)
    return (
      <section className="callback-panel" aria-label="คำขอให้ติดต่อกลับ">
        <div className="callback-head">
          <strong>
            <Icon name="phone" />
            ขอให้ติดต่อกลับแล้ว
          </strong>
          {close}
        </div>
        <p className="callback-summary">
          {waiting.method === 'phone' ? `โทรหา ${waiting.phone}` : 'ส่งข้อความทาง LINE'} {callbackWhen(waiting)}
          {waiting.note && <span className="muted"> ({waiting.note})</span>}
        </p>
        <div className="callback-actions">
          <button type="button" className="btn sm" disabled={busy} onClick={() => setEditing(true)}>
            เปลี่ยนเวลา
          </button>
          <button type="button" className="btn sm danger" disabled={busy} onClick={() => void send({ cancel: true })}>
            ยกเลิกคำขอ
          </button>
        </div>
        {problem && <p className="error-text">{problem}</p>}
      </section>
    );

  if (!state.slots.length)
    return (
      <section className="callback-panel" aria-label="ขอให้ติดต่อกลับ">
        <div className="callback-head">
          <strong>
            <Icon name="phone" />
            ขอให้ติดต่อกลับ
          </strong>
          {close}
        </div>
        <p className="callback-summary">ตอนนี้ไม่มีช่วงเวลาให้เลือกใน 7 วันข้างหน้า พิมพ์ถึงทีมงานในแชทนี้ได้เลย</p>
      </section>
    );

  return (
    <form
      className="callback-panel"
      aria-label="ขอให้ติดต่อกลับ"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void send({
          method,
          phone: String(data.get('phone') ?? ''),
          start: String(data.get('start') ?? ''),
          note: String(data.get('note') ?? ''),
        });
      }}
    >
      <div className="callback-head">
        <strong>
          <Icon name="phone" />
          ขอให้ติดต่อกลับ
        </strong>
        {close}
      </div>
      <p className="callback-summary muted">เลือกช่องทางและเวลาที่สะดวก ทีมงานจะติดต่อกลับในช่วงเวลานั้น</p>
      <div className="callback-methods" role="radiogroup" aria-label="ให้ติดต่อกลับทาง">
        <label className="check">
          <input type="radio" name="method" checked={method === 'phone'} onChange={() => setMethod('phone')} />
          โทรศัพท์
        </label>
        {state.line_ready && (
          <label className="check">
            <input type="radio" name="method" checked={method === 'line'} onChange={() => setMethod('line')} />
            LINE
          </label>
        )}
      </div>
      {method === 'phone' && (
        <div className="field">
          <label htmlFor={`callback-phone-${conversationId}`}>เบอร์โทร</label>
          <input
            id={`callback-phone-${conversationId}`}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={20}
            defaultValue={state.phone}
            required
          />
        </div>
      )}
      <div className="field">
        <label htmlFor={`callback-day-${conversationId}`}>วัน</label>
        <select id={`callback-day-${conversationId}`} value={day} onChange={(e) => setDay(e.target.value)}>
          {days.map((d) => (
            <option key={d} value={d}>
              {dayWords(d)}
            </option>
          ))}
        </select>
      </div>
      <div className="callback-slots" role="radiogroup" aria-label="ช่วงเวลา">
        {state.slots
          .filter((s) => s.day === day)
          .map((s, i) => (
            <label key={s.start} className="callback-slot">
              <input type="radio" name="start" value={s.start} defaultChecked={i === 0} />
              <span>{s.label} น.</span>
            </label>
          ))}
      </div>
      <div className="field">
        <label htmlFor={`callback-note-${conversationId}`}>รายละเอียดเพิ่มเติม (ไม่บังคับ)</label>
        <input id={`callback-note-${conversationId}`} name="note" maxLength={300} autoComplete="off" />
      </div>
      <div className="callback-actions">
        <button type="submit" className="btn primary sm" disabled={busy}>
          ขอให้ติดต่อกลับ
        </button>
        {waiting && (
          <button type="button" className="btn sm" disabled={busy} onClick={() => setEditing(false)}>
            ไม่เปลี่ยน
          </button>
        )}
      </div>
      {problem && <p className="error-text">{problem}</p>}
    </form>
  );
}
