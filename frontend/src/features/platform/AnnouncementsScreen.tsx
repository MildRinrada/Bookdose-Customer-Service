'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useRunAction } from '@/components/ui/actions';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { date } from '@/lib/format';
import { useApi } from '@/lib/query';
import { AnnouncementCard } from './components/HealthCards';
import { ANNOUNCEMENT_PATH, clearStatusNotice, saveStatusNotice } from './api';
import type { Announcement } from './types';

/* Platform console, ประกาศ — everything the platform says out loud, on one screen of its own.

   Two kinds, and they are not the same thing, which is why they sit side by side here rather than scattered:

     ประกาศสถานะระบบ   for an incident happening now. Goes to the public /status page, which anyone can open
                       without signing in - including somebody who cannot sign in because of the incident.
     ประกาศถึงทุกองค์กร  planned and in advance ("ปิดปรับปรุง คืนวันเสาร์"). Shows as a bar inside the app to the
                       staff of every organization, and to their customers when chosen, until it ends.

   Each is one card built the same way: what it is and who sees it, whether one is up now, the form, and its button
   at the foot. Neither belongs on ภาพรวมระบบ: that screen is what an admin reads while working out what is broken,
   and a form for writing to customers has no business sitting on top of it the rest of the time.
   Markup: pages/platform.css (announce-). */

type Notice = { state: string; text: string; updated_at: string; updated_by: string } | null;

const STATES: [string, string][] = [
  ['watching', 'กำลังตรวจสอบ'],
  ['partial', 'ใช้งานได้บางส่วน'],
  ['down', 'ขัดข้อง'],
  ['maintenance', 'ปิดปรับปรุงตามแผน'],
];
const stateLabel = (state: string) => STATES.find(([key]) => key === state)?.[1] ?? state;

export function AnnouncementsScreen() {
  // The public status page's own answer: the notice is what anyone opening /status reads now.
  const status = useApi<{ notice?: Notice }>('/api/status');
  const current = status.data?.notice ?? null;
  const loaded = Boolean(status.data);
  const read = async () => {
    await status.refetch();
  };
  const announcement = useApi<{ announcement: Announcement | null }>(ANNOUNCEMENT_PATH);

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>ประกาศ</h1>
          <p>แจ้งเหตุขัดข้องบนหน้าสถานะระบบ หรือประกาศเรื่องที่รู้ล่วงหน้าถึงทุกองค์กร</p>
        </div>
      </div>

      <div className="announce-split">
        <StatusNoticeCard key={current?.updated_at ?? (loaded ? 'none' : 'loading')} current={current} loaded={loaded} onChanged={read} />
        {/* Drawn again from what was saved, once it is saved (the form holds what is being typed). */}
        <AnnouncementCard key={JSON.stringify(announcement.data?.announcement ?? null)} current={announcement.data?.announcement ?? null} />
      </div>
    </>
  );
}

/** เหตุขัดข้องตอนนี้: the notice on the public /status page, the one up now, and writing or updating it. */
function StatusNoticeCard({ current, loaded, onChanged }: { current: Notice; loaded: boolean; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const run = useRunAction();
  const [state, setState] = useState(current?.state ?? 'watching');
  const tone = current?.state === 'down' ? 'health-error' : 'health-warning';

  return (
    <section className="card announce-card" aria-labelledby="status-notice-title">
      <div className="card-header announce-head">
        <span className="announce-mark">
          <Icon name="bolt" />
        </span>
        <div className="grow">
          <h2 id="status-notice-title">เหตุขัดข้องตอนนี้</h2>
          <p>
            ขึ้นที่{' '}
            <a href="/status" target="_blank" rel="noopener">
              หน้าสถานะระบบ
            </a>{' '}
            ทุกคนเปิดดูได้โดยไม่ต้องเข้าสู่ระบบ ใช้บอกเรื่องที่กำลังเกิดขึ้น
          </p>
        </div>
        {loaded && <span className={`health-pill ${current ? tone : 'announce-none'}`}>{current ? stateLabel(current.state) : 'ไม่มีประกาศ'}</span>}
      </div>

      {current && (
        <div className="announce-live" role="status">
          <div className="grow">
            <strong>ประกาศอยู่ตอนนี้</strong>
            <p>{current.text}</p>
            <span className="tiny muted">
              โดย {current.updated_by} เมื่อ {date(current.updated_at, true)}
            </span>
          </div>
          <button
            type="button"
            className="btn sm"
            onClick={() =>
              void run(async () => {
                await clearStatusNotice();
                toast('เอาประกาศออกแล้ว หน้าสถานะระบบกลับไปบอกผลตรวจตามปกติ');
                await onChanged();
              })
            }
          >
            <Icon name="close" />
            เอาประกาศออก
          </button>
        </div>
      )}

      <Form
        className="card-body stack announce-form"
        data-form="status-notice"
        onSubmit={async (values) => {
          await saveStatusNotice(values.state ?? 'watching', values.text ?? '');
          toast(
            values.state === 'maintenance'
              ? 'ปิดปรับปรุงแล้ว ทุกองค์กรบันทึกข้อมูลไม่ได้จนกว่าจะเอาประกาศออก'
              : 'ประกาศแล้ว ขึ้นบนหน้าสถานะระบบภายในไม่กี่วินาที',
          );
          await onChanged();
        }}
      >
        <div className="field">
          <label htmlFor="status-state">สถานะ</label>
          <select id="status-state" name="state" value={state} onChange={(e) => setState(e.target.value)}>
            {STATES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {/* Said before it is pressed, not only in the toast after: it stops every organization saving
            (backend platform/maintenance.py). */}
        {state === 'maintenance' && (
          <p className="notice announce-warning">
            <Icon name="lock" />
            <span>ระหว่างที่ประกาศนี้ขึ้นอยู่ ทุกองค์กรบันทึกหรือแก้ข้อมูลไม่ได้ จนกว่าจะกดเอาประกาศออก</span>
          </p>
        )}
        <div className="field">
          <label htmlFor="status-text">สิ่งที่เกิดขึ้น</label>
          <textarea
            id="status-text"
            name="text"
            rows={4}
            maxLength={500}
            required
            defaultValue={current?.text ?? ''}
            placeholder="เช่น ข้อความที่ส่งออกทาง LINE ล่าช้าประมาณ 10 นาที ทีมงานกำลังแก้ไข ไม่มีข้อความสูญหาย"
          />
        </div>
        <div className="form-actions">
          <button type="submit" className="btn primary">
            <Icon name="send" />
            {current ? 'อัปเดตประกาศ' : 'ประกาศ'}
          </button>
        </div>
      </Form>
    </section>
  );
}
