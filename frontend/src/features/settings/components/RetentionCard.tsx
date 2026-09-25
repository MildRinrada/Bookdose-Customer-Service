'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { useToast } from '@/components/ui/Toast';
import { useApi, useInvalidate } from '@/lib/query';
import { RETENTION_PATH, saveRetention, type Retention } from '../api';

/* ระยะเวลาเก็บข้อมูล (ตั้งค่า → ข้อมูลและการสำรอง): conversations quiet for longer than the chosen time lose their
   content - text, attachments, the AI's readings - while case numbers, times and reports stay (backend organization/
   retention.py). Nothing goes until a week after it is turned on; each choice says what it would clear today.
   Markup: pages/settings (retention-*). */

const LABELS: Record<number, string> = { 6: '6 เดือน', 12: '1 ปี', 24: '2 ปี', 36: '3 ปี', 60: '5 ปี' };

const size = (bytes: number) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

const day = (iso: string) => new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' });

function RetentionForm({ state }: { state: Retention }) {
  const { confirm } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const [months, setMonths] = useState(state.months);
  const would = state.preview[String(months)] ?? { conversations: 0, files: 0, bytes: 0 };
  const whatGoes = `${would.conversations.toLocaleString('th-TH')} บทสนทนา${would.files ? ` และไฟล์แนบ ${would.files.toLocaleString('th-TH')} ไฟล์ (${size(would.bytes)})` : ''}`;
  const save = (enabled: boolean, message: string) => async () => {
    await saveRetention({ enabled, months });
    await refresh(RETENTION_PATH);
    toast(message);
  };
  const turnOn = () =>
    confirm({
      title: `เก็บบทสนทนา ${LABELS[months]} แล้วลบเนื้อหา`,
      tone: 'danger',
      confirmLabel: 'เปิดการลบตามระยะเวลา',
      message: (
        <>
          <p>
            ถ้าใช้ค่านี้ตอนนี้ ระบบจะลบเนื้อหา <strong>{whatGoes}</strong> ที่เงียบมาเกิน {LABELS[months]} ลบแล้วกู้คืนไม่ได้
          </p>
          <p className="muted">ระบบจะเริ่มลบจริงหลังจากนี้ {state.wait_days} วัน เปลี่ยนใจได้โดยกดปิดก่อนถึงวันนั้น</p>
        </>
      ),
      run: save(true, `เปิดแล้ว ระบบจะเริ่มลบหลังจากนี้ ${state.wait_days} วัน`),
    });
  const changed = state.enabled && months !== state.months;
  return (
    <div className="card-body">
      <div className="team-security-state">
        <span className={`settings-status ${state.enabled ? 'on' : 'off'}`}>{state.enabled ? `เก็บ ${LABELS[state.months]}` : 'เก็บไว้ตลอด'}</span>
        <span className="grow">
          {!state.enabled
            ? 'ตอนนี้ระบบเก็บบทสนทนาทุกเรื่องไว้ตลอด'
            : state.starts_at && new Date(state.starts_at) > new Date()
              ? `เริ่มลบครั้งแรกวันที่ ${day(state.starts_at)}`
              : state.cleared.conversations
                ? `ลบเนื้อหาไปแล้ว ${state.cleared.conversations.toLocaleString('th-TH')} บทสนทนา ไฟล์แนบ ${state.cleared.files.toLocaleString('th-TH')} ไฟล์`
                : 'ยังไม่มีบทสนทนาที่เก่าถึงกำหนด'}
        </span>
      </div>
      <div className="retention-choices" role="radiogroup" aria-label="เก็บบทสนทนาไว้นานเท่าไร">
        {state.months_choices.map((m) => (
          <label key={m} className={`retention-choice${m === months ? ' selected' : ''}`}>
            <input type="radio" name="retention-months" checked={m === months} onChange={() => setMonths(m)} />
            <strong>{LABELS[m]}</strong>
            <small>ลบ {(state.preview[String(m)]?.conversations ?? 0).toLocaleString('th-TH')} บทสนทนา</small>
          </label>
        ))}
      </div>
      <p className="retention-what">
        <strong>ถ้าเลือก {LABELS[months]} ตอนนี้จะลบเนื้อหา {whatGoes}</strong>
        <span className="tiny muted">
          ลบเฉพาะบทสนทนาที่ไม่มีข้อความใหม่เกิน {LABELS[months]} และไม่มีเคสที่ยังทำอยู่ · ที่ถูกลบ: ข้อความทุกข้อความรวมบันทึกภายใน ไฟล์แนบ
          สรุปและการอ่านอารมณ์ของ AI หัวข้อ และความเห็นในแบบสอบถาม · ที่เก็บไว้: เลขเคส วันเวลา สถานะ คะแนน และตัวเลขในรายงาน รวมถึงข้อมูลลูกค้า
        </span>
      </p>
      <div className="settings-row-actions">
        {!state.enabled ? (
          <button type="button" className="btn danger" onClick={turnOn}>
            <Icon name="clock" />
            เปิดการลบตามระยะเวลา
          </button>
        ) : (
          <>
            {changed && (
              <button
                type="button"
                className="btn primary"
                onClick={() =>
                  months < state.months
                    ? turnOn()
                    : void save(true, `เปลี่ยนเป็นเก็บ ${LABELS[months]} แล้ว`)().catch((error: Error) => toast(error.message, true))
                }
              >
                <Icon name="check" />
                บันทึกเป็น {LABELS[months]}
              </button>
            )}
            <button
              type="button"
              className="btn"
              onClick={() => void save(false, 'ปิดแล้ว ระบบจะเก็บบทสนทนาไว้ตลอด')().catch((error: Error) => toast(error.message, true))}
            >
              <Icon name="close" />
              ปิด เก็บไว้ตลอด
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function RetentionCard() {
  const state = useApi<Retention>(RETENTION_PATH);
  return (
    <section className="card" id="data-retention">
      <div className="card-header">
        <div>
          <h2>ระยะเวลาเก็บข้อมูล</h2>
          <p>ลบเนื้อหาบทสนทนาเก่าอัตโนมัติ ลดข้อมูลส่วนบุคคลที่ไม่จำเป็นตาม PDPA และคืนพื้นที่จัดเก็บ</p>
        </div>
      </div>
      {state.isPending ? (
        <PageLoading />
      ) : state.error ? (
        <ErrorState title="โหลดการตั้งค่าไม่สำเร็จ" error={state.error} onRetry={() => void state.refetch()} />
      ) : (
        <RetentionForm key={`${state.data.enabled}-${state.data.months}`} state={state.data} />
      )}
    </section>
  );
}
