'use client';

import { useEffect, useState } from 'react';
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

   Neither belongs on ภาพรวมระบบ: that screen is what an admin reads while working out what is broken, and a form
   for writing to customers has no business sitting on top of it the rest of the time. */

type Notice = { state: string; text: string; updated_at: string; updated_by: string } | null;

const STATES: [string, string][] = [
  ['watching', 'กำลังตรวจสอบ'],
  ['partial', 'ใช้งานได้บางส่วน'],
  ['down', 'ขัดข้อง'],
  ['maintenance', 'ปิดปรับปรุงตามแผน'],
];
// ปิดปรับปรุง closes changes for every organization until the notice is taken down (backend platform/maintenance.py).

export function AnnouncementsScreen() {
  const toast = useToast();
  const run = useRunAction();
  const [current, setCurrent] = useState<Notice>(null);
  const [loaded, setLoaded] = useState(false);
  const announcement = useApi<{ announcement: Announcement | null }>(ANNOUNCEMENT_PATH);

  const read = async () => {
    const answer = await fetch('/api/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    setCurrent((answer as { notice?: Notice } | null)?.notice ?? null);
    setLoaded(true);
  };

  useEffect(() => {
    void read();
  }, []);

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>ประกาศ</h1>
        </div>
      </div>

      <div className="announce-split">
        <div className="announce-column">
      {loaded && current ? (
        <section className="card status-live">
          <div className="card-body">
            <Icon name="bolt" />
            <div className="grow">
              <strong>ประกาศอยู่ตอนนี้ {STATES.find(([key]) => key === current.state)?.[1] ?? current.state}</strong>
              <p>{current.text}</p>
              <span className="tiny muted">
                โดย {current.updated_by} เมื่อ {date(current.updated_at, true)}
              </span>
            </div>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void run(async () => {
                  await clearStatusNotice();
                  toast('เอาประกาศออกแล้ว หน้าสถานะระบบกลับไปบอกผลตรวจตามปกติ');
                  await read();
                })
              }
            >
              <Icon name="close" />
              เอาประกาศออก
            </button>
          </div>
        </section>
      ) : (
        <p className="tiny muted announce-quiet">ตอนนี้ไม่มีประกาศ</p>
      )}

      <section className="card">
        <div className="card-header">
          <div>
            <h2>เหตุขัดข้องตอนนี้</h2>
            <p>
              <a href="/status" target="_blank" rel="noopener">
                หน้าสถานะระบบ
              </a>
            </p>
          </div>
          <Icon name="bolt" />
        </div>
        <div className="card-body">
          <Form
            key={current?.updated_at ?? 'none'}
            data-form="status-notice"
            onSubmit={async (values) => {
              await saveStatusNotice(values.state ?? 'watching', values.text ?? '');
              toast(
                values.state === 'maintenance'
                  ? 'ปิดปรับปรุงแล้ว ทุกองค์กรบันทึกข้อมูลไม่ได้จนกว่าจะเอาประกาศออก'
                  : 'ประกาศแล้ว ขึ้นบนหน้าสถานะระบบภายในไม่กี่วินาที',
              );
              await read();
            }}
          >
            <div className="field">
              <label htmlFor="status-state">สถานะ</label>
              <select id="status-state" name="state" defaultValue={current?.state ?? 'watching'}>
                {STATES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
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
        </div>
      </section>
        </div>
        <div className="announce-column">
          <AnnouncementCard current={announcement.data?.announcement ?? null} />
        </div>
      </div>
    </>
  );
}
