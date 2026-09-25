'use client';

import { Icon } from '@/components/Icon';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import { useWork } from '@/lib/session';
import { saveQuietClose, WORKSPACE_PATH, type QuietClose } from '../api';

/* ปิดเคสเมื่อลูกค้าเงียบ (ตั้งค่า → ภาพรวมและบริการ): a case waiting for the customer that hears nothing is asked once,
   then closed, instead of sitting in the lists for ever (backend automation/quiet.py). Markup: pages/settings
   (hours-switches, quiet-days). */

const TOKEN = '{วัน}';
const DEFAULT: QuietClose = {
  enabled: false,
  remind_days: 3,
  close_days: 2,
  remind_message: `หากยังต้องการความช่วยเหลือเรื่องนี้ ตอบกลับข้อความนี้ได้เลย หากไม่ได้รับข้อความเพิ่มเติม ระบบจะปิดเรื่องนี้ใน ${TOKEN} วัน`,
  close_message: 'ปิดเรื่องนี้แล้ว เพราะยังไม่ได้รับข้อความเพิ่มเติม หากยังต้องการความช่วยเหลือ ตอบกลับข้อความนี้ได้เลย เรื่องจะเปิดขึ้นอีกครั้ง',
};

function saved(raw: unknown): QuietClose {
  try {
    const value = typeof raw === 'string' && raw ? (JSON.parse(raw) as Partial<QuietClose>) : null;
    return value ? { ...DEFAULT, ...value } : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function QuietCloseCard() {
  const work = useWork();
  const toast = useToast();
  const refresh = useInvalidate();
  const initial = saved(work.settings.quiet_close);
  return (
    <section className="card" id="quiet-close">
      <div className="card-header">
        <div>
          <h2>ปิดเคสเมื่อลูกค้าเงียบ</h2>
          <p>เคสที่อยู่ในสถานะ &ldquo;รอลูกค้า&rdquo; แล้วลูกค้าไม่ตอบกลับ ระบบจะถามลูกค้าอีกครั้งก่อน ถ้ายังเงียบจึงปิดเคส ลูกค้าตอบกลับเมื่อไรเคสจะเปิดขึ้นอีกครั้ง</p>
        </div>
      </div>
      <Form
        className="card-body"
        onSubmit={async (values, form) => {
          await saveQuietClose({
            enabled: (form.elements.namedItem('enabled') as HTMLInputElement).checked,
            remind_days: Number(values.remind_days),
            close_days: Number(values.close_days),
            remind_message: values.remind_message ?? '',
            close_message: values.close_message ?? '',
          });
          toast('บันทึกการปิดเคสอัตโนมัติแล้ว');
          await refresh(WORKSPACE_PATH);
        }}
      >
        <div className="hours-switches">
          <label className="check">
            <input type="checkbox" className="switch" name="enabled" defaultChecked={initial.enabled} />
            <span>
              ถามลูกค้าที่เงียบไป แล้วปิดเคสเมื่อยังไม่ตอบ
              <small className="tiny muted">ส่งทางช่องทางเดิมของเคส (แชทบนเว็บ LINE อีเมล Facebook) · เคสที่พักไว้จะเริ่มนับเมื่อครบเวลาพัก</small>
            </span>
          </label>
        </div>
        <div className="quiet-days">
          <label>
            ลูกค้าเงียบ
            <input type="number" name="remind_days" min={1} max={30} step={1} required defaultValue={initial.remind_days} aria-label="จำนวนวันที่ลูกค้าเงียบก่อนถาม" />
            วัน ส่งข้อความถาม
          </label>
          <label>
            ถามแล้วยังเงียบ
            <input type="number" name="close_days" min={1} max={30} step={1} required defaultValue={initial.close_days} aria-label="จำนวนวันหลังถามก่อนปิดเคส" />
            วัน ปิดเคส
          </label>
        </div>
        <div className="field">
          <label htmlFor="quiet-remind">ข้อความถามลูกค้า</label>
          <textarea id="quiet-remind" name="remind_message" rows={3} maxLength={500} required defaultValue={initial.remind_message} />
          <p className="tiny muted">ใส่ {TOKEN} ตรงที่ต้องการให้ระบบเติมจำนวนวันก่อนปิดเคส</p>
        </div>
        <div className="field">
          <label htmlFor="quiet-close-message">ข้อความตอนปิดเคส</label>
          <textarea id="quiet-close-message" name="close_message" rows={3} maxLength={500} required defaultValue={initial.close_message} />
        </div>
        <button className="btn primary mt" type="submit">
          <Icon name="check" />
          บันทึกการปิดเคสอัตโนมัติ
        </button>
      </Form>
    </section>
  );
}
