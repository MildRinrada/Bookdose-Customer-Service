'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import { useWork } from '@/lib/session';
import { saveBusinessHours, WORKSPACE_PATH, type BusinessHours, type Holiday } from '../api';

/* เวลาทำการ (ตั้งค่า → ภาพรวมและบริการ): the hours the organization answers and its holidays. They decide what a
   customer who writes while it is closed reads - on the web chat, LINE, email and Facebook, once until the next
   closing - and, when chosen, a new case's SLA clock runs only while it is open (backend organization/hours.py).
   Markup: pages/settings (hours-*). */

const DAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
const TOKEN = '{เวลาเปิด}';
const DEFAULT: BusinessHours = {
  enabled: false,
  sla: false,
  days: [...Array(5).fill(['09:00', '18:00']), null, null],
  holidays: [],
  message: `ขณะนี้อยู่นอกเวลาทำการ ได้รับข้อความของคุณแล้ว ทีมงานจะตอบกลับ${TOKEN}`,
};

export function savedHours(raw: unknown): BusinessHours {
  try {
    const value = typeof raw === 'string' && raw ? (JSON.parse(raw) as Partial<BusinessHours>) : null;
    return value && Array.isArray(value.days) && value.days.length === 7 ? { ...DEFAULT, ...value } : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

/** Today in Thai time as YYYY-MM-DD: the earliest holiday worth adding. */
function thaiToday() {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

function holidayDate(date: string) {
  return new Date(`${date}T00:00:00+07:00`).toLocaleDateString('th-TH', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Bangkok',
  });
}

export function BusinessHoursCard() {
  const work = useWork();
  const toast = useToast();
  const refresh = useInvalidate();
  const initial = savedHours(work.settings.business_hours);
  // Which days are open: a closed day shows no times and sends none.
  const [open, setOpen] = useState<boolean[]>(() => initial.days.map(Boolean));
  const today = thaiToday();
  const [holidays, setHolidays] = useState<Holiday[]>(() => initial.holidays.filter((h) => h.date >= today));
  const [adding, setAdding] = useState<Holiday>({ date: '', name: '' });
  const [dateInput, setDateInput] = useState<HTMLInputElement | null>(null);
  const add = () => {
    // No date yet: the date box is where to start.
    if (!adding.date || adding.date < today) return dateInput?.focus();
    setHolidays((all) => [...all.filter((h) => h.date !== adding.date), { date: adding.date, name: adding.name.trim() }].sort((a, b) => a.date.localeCompare(b.date)));
    setAdding({ date: '', name: '' });
  };
  return (
    <section className="card" id="business-hours">
      <div className="card-header">
        <div>
          <h2>เวลาทำการ</h2>
          <p>ใช้ตอบลูกค้าที่ทักมาตอนปิด และใช้นับเวลา SLA ถ้าเลือกไว้ · เวลาประเทศไทย</p>
        </div>
      </div>
      <Form
        className="card-body"
        onSubmit={async (values, form) => {
          const time = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value;
          const checked = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).checked;
          await saveBusinessHours({
            enabled: checked('enabled'),
            sla: checked('sla'),
            days: open.map((on, index) => (on ? [time(`open-${index}`), time(`close-${index}`)] : null)),
            holidays,
            message: values.message ?? '',
          });
          toast('บันทึกเวลาทำการแล้ว');
          await refresh(WORKSPACE_PATH);
        }}
      >
        <div className="hours-switches">
          <label className="check">
            <input type="checkbox" className="switch" name="enabled" defaultChecked={initial.enabled} />
            <span>
              ตอบลูกค้าอัตโนมัติเมื่ออยู่นอกเวลาทำการ
              <small className="tiny muted">ทางแชทบนเว็บ LINE อีเมล และ Facebook ส่งครั้งเดียวต่อช่วงที่ปิด ไม่ส่งซ้ำทุกข้อความ</small>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" className="switch" name="sla" defaultChecked={initial.sla} />
            <span>
              นับเวลา SLA เฉพาะในเวลาทำการ
              <small className="tiny muted">กลางคืน วันที่ปิด และวันหยุดพิเศษไม่นับ ลูกค้าทักคืนวันศุกร์ เคสจะไม่เลยกำหนดตั้งแต่เช้าวันจันทร์ · ใช้กับเคสที่เปิดใหม่</small>
            </span>
          </label>
        </div>
        <div className="hours-days" role="group" aria-label="เวลาทำการแต่ละวัน">
          {DAYS.map((day, index) => {
            const hours = initial.days[index] ?? ['09:00', '18:00'];
            return (
              <div key={day} className={`hours-day${open[index] ? '' : ' closed'}`}>
                <label className="day-check">
                  <input
                    type="checkbox"
                    checked={open[index]}
                    onChange={(e) => setOpen((all) => all.map((on, i) => (i === index ? e.target.checked : on)))}
                  />
                  <span>{day}</span>
                </label>
                {open[index] ? (
                  <>
                    <input type="time" name={`open-${index}`} aria-label={`วัน${day} เปิด`} defaultValue={hours[0]} required />
                    <span className="hours-to">ถึง</span>
                    <input type="time" name={`close-${index}`} aria-label={`วัน${day} ปิด`} defaultValue={hours[1]} required />
                  </>
                ) : (
                  <span className="hours-off">ปิดทั้งวัน</span>
                )}
              </div>
            );
          })}
        </div>
        <div className="hours-holidays">
          <h3>วันหยุดพิเศษ</h3>
          <p className="tiny muted">ปิดทั้งวัน ลูกค้าที่ทักมาจะได้ข้อความนอกเวลา และไม่นับเวลา SLA · วันที่ผ่านไปแล้วระบบลบออกให้เอง</p>
          {holidays.length > 0 && (
            <ul className="hours-holiday-list">
              {holidays.map((h) => (
                <li key={h.date}>
                  <Icon name="calendar" />
                  <strong>{holidayDate(h.date)}</strong>
                  {h.name && <span>{h.name}</span>}
                  <button
                    type="button"
                    className="icon-btn sm"
                    aria-label={`ลบวันหยุด ${holidayDate(h.date)}`}
                    title="ลบวันหยุดนี้"
                    onClick={() => setHolidays((all) => all.filter((x) => x.date !== h.date))}
                  >
                    <Icon name="trash" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="hours-holiday-add">
            <input
              ref={setDateInput}
              type="date"
              aria-label="วันที่หยุด"
              min={today}
              value={adding.date}
              onChange={(e) => setAdding((a) => ({ ...a, date: e.target.value }))}
            />
            <input
              type="text"
              aria-label="ชื่อวันหยุด"
              placeholder="ชื่อวันหยุด (ไม่ใส่ก็ได้)"
              maxLength={60}
              value={adding.name}
              onChange={(e) => setAdding((a) => ({ ...a, name: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <button type="button" className="btn" onClick={add}>
              <Icon name="plus" />
              เพิ่มวันหยุด
            </button>
          </div>
        </div>
        <div className="field">
          <label htmlFor="hours-message">ข้อความที่ลูกค้าได้รับนอกเวลาทำการ</label>
          <textarea id="hours-message" name="message" maxLength={500} required defaultValue={initial.message} />
          <p className="tiny muted">
            ใส่ {TOKEN} ตรงที่ต้องการให้ระบบเติมเวลาเปิดครั้งถัดไป เช่น &ldquo;พรุ่งนี้ 09:00&rdquo; หรือ &ldquo;วันจันทร์ 09:00&rdquo;
          </p>
        </div>
        <button className="btn primary" type="submit">
          <Icon name="check" />
          บันทึกเวลาทำการ
        </button>
      </Form>
    </section>
  );
}
