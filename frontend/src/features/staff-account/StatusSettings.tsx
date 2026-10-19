'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useRunAction } from '@/components/ui/actions';
import { PageLoading } from '@/components/ui/display';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import type { WorkStatus } from '@/lib/types';
import { PREFS_PATH, savePreferences, setWorkStatus, usePreferences, type PreferencesView, type StaffPreferences } from './prefs';

/* ตั้งค่าบัญชี → สถานะการทำงาน: whether the member takes new cases now, their working hours and their leave. A
   routing rule gives no new case to someone on a break, busy, away, off shift or on leave (the case waits for the
   team), and an SLA escalation goes to a lead who is available. Choosing an owner by hand still works. Markup:
   pages/account-settings.css (.work-status). */

export function StatusSettings() {
  const view = usePreferences();
  if (!view.data) return <PageLoading />;
  return (
    <div className="account-section">
      <StatusCard view={view.data} />
      <HoursCard key={JSON.stringify(view.data.preferences.hours)} view={view.data} />
      <LeaveCard key={JSON.stringify(view.data.preferences.leave)} view={view.data} />
    </div>
  );
}

export function useSaveStatus() {
  const refresh = useInvalidate();
  const toast = useToast();
  return async (status: WorkStatus, statuses: Record<WorkStatus, string>) => {
    await setWorkStatus(status);
    await refresh(PREFS_PATH, '/api/workspace');
    toast(`เปลี่ยนสถานะเป็น “${statuses[status]}” แล้ว`);
  };
}

function StatusCard({ view }: { view: PreferencesView }) {
  const run = useRunAction();
  const save = useSaveStatus();
  const now = view.availability;
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>สถานะตอนนี้</h2>
        </div>
        <span className={`work-status-pill status-${now.available ? 'online' : now.status}`}>
          <span className="status-dot" aria-hidden="true" />
          {now.available ? 'พร้อมรับเรื่องใหม่' : `ไม่รับเรื่องใหม่ ${now.reason}`}
        </span>
      </div>
      <div className="card-body">
        <div className="work-status" role="radiogroup" aria-label="สถานะการทำงาน">
          {(Object.keys(view.statuses) as WorkStatus[]).map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={view.preferences.status === key}
              className={`work-status-option status-${key}${view.preferences.status === key ? ' selected' : ''}`}
              onClick={() => run(() => save(key, view.statuses))}
            >
              <span className="status-dot" aria-hidden="true" />
              <strong>{view.statuses[key]}</strong>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function HoursCard({ view }: { view: PreferencesView }) {
  const toast = useToast();
  const refresh = useInvalidate();
  const hours = view.preferences.hours;
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>เวลาทำงาน</h2>
        </div>
      </div>
      <Form
        className="card-body"
        data-form="work-hours"
        onSubmit={async (values, form) => {
          const days = new FormData(form).getAll('days').map(Number);
          await savePreferences({ hours: { enabled: values.enabled === 'on', days, start: values.start ?? '', end: values.end ?? '' } });
          await refresh(PREFS_PATH, '/api/workspace');
          toast('บันทึกเวลาทำงานแล้ว');
        }}
      >
        <label className="check">
          <input type="checkbox" className="switch" name="enabled" defaultChecked={hours.enabled} />
          ใช้เวลาทำงาน
        </label>
        <fieldset className="work-days">
          <legend>วันทำงาน</legend>
          {view.days.map((label, index) => (
            <label key={label} className="day-check">
              <input type="checkbox" name="days" value={index} defaultChecked={hours.days.includes(index)} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <div className="work-time">
          <label className="field">
            <span>เข้างาน</span>
            <input type="time" name="start" defaultValue={hours.start} required />
          </label>
          <label className="field">
            <span>เลิกงาน</span>
            <input type="time" name="end" defaultValue={hours.end} required />
          </label>
        </div>
        <div className="settings-save">
          <button className="btn primary" type="submit">
            <Icon name="check" />
            บันทึกเวลาทำงาน
          </button>
        </div>
      </Form>
    </section>
  );
}

function LeaveCard({ view }: { view: PreferencesView }) {
  const toast = useToast();
  const refresh = useInvalidate();
  const run = useRunAction();
  const [leave, setLeave] = useState<StaffPreferences['leave']>(view.preferences.leave);
  const store = async (next: StaffPreferences['leave'], message: string) => {
    await savePreferences({ leave: next });
    setLeave(next);
    await refresh(PREFS_PATH, '/api/workspace');
    toast(message);
  };
  // The browser's own date (leave is kept in Thai dates; staff work in Thailand).
  const today = new Date().toLocaleDateString('sv-SE');
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>วันลา</h2>
        </div>
      </div>
      <div className="card-body">
        {leave.length ? (
          <ul className="security-list leave-list">
            {leave.map((item, index) => (
              <li key={`${item.from}-${item.to}-${index}`}>
                <span className="security-list-icon">
                  <Icon name="calendar" />
                </span>
                <span className="grow">
                  <strong>{item.from === item.to ? item.from : `${item.from} ถึง ${item.to}`}</strong>
                  <span className="muted">{item.to < today ? 'ผ่านไปแล้ว' : item.from <= today ? 'กำลังลาอยู่' : 'ลาล่วงหน้า'}{item.note ? ` ${item.note}` : ''}</span>
                </span>
                <button
                  className="btn sm danger"
                  type="button"
                  onClick={() => run(() => store(leave.filter((_, i) => i !== index), 'ลบวันลาแล้ว'))}
                >
                  <Icon name="trash" />
                  ลบ
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">ยังไม่มีวันลา</p>
        )}
        <Form
          className="leave-form"
          data-form="leave"
          onSubmit={async (values, form) => {
            await store([...leave, { from: values.from ?? '', to: values.to || values.from || '', note: values.note ?? '' }], 'บันทึกวันลาแล้ว');
            form.reset();
          }}
        >
          <label className="field">
            <span>ตั้งแต่วันที่</span>
            <input type="date" name="from" required min={today} />
          </label>
          <label className="field">
            <span>ถึงวันที่</span>
            <input type="date" name="to" min={today} />
          </label>
          <label className="field grow">
            <span>หมายเหตุ (ไม่บังคับ)</span>
            <input name="note" maxLength={100} placeholder="เช่น ลาพักร้อน" />
          </label>
          <button className="btn" type="submit">
            <Icon name="plus" />
            เพิ่มวันลา
          </button>
        </Form>
      </div>
    </section>
  );
}
