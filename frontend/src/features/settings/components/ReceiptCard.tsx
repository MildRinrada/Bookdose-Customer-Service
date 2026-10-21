'use client';

import { Icon } from '@/components/Icon';
import { Form } from '@/components/ui/Form';
import { InfoHint } from '@/components/ui/InfoHint';
import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import { useWork } from '@/lib/session';
import { saveReceipt, WORKSPACE_PATH, type ChannelReceipt } from '../api';

/* ข้อความรับเรื่อง (ตั้งค่า → ภาพรวมและบริการ): a customer who starts a new matter on LINE, Facebook or Instagram
   reads at once that it arrived and about how long the team will take, with buttons to see their place in the queue
   now or say ไม่รีบ - what the web chat's queue card tells them (backend channels/receipt.py). Markup: pages/settings
   (hours-switches). */

const TOKEN = '{เวลารอ}';
const DEFAULT: ChannelReceipt = { enabled: false, message: `ได้รับข้อความแล้ว ทีมงานจะตอบกลับ${TOKEN}` };

function saved(raw: unknown): ChannelReceipt {
  try {
    const value = typeof raw === 'string' && raw ? (JSON.parse(raw) as Partial<ChannelReceipt>) : null;
    return value ? { ...DEFAULT, ...value } : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function ReceiptCard() {
  const work = useWork();
  const toast = useToast();
  const refresh = useInvalidate();
  const initial = saved(work.settings.channel_receipt);
  return (
    <section className="card" id="receipt">
      <div className="card-header">
        <div>
          <h2>
            ข้อความรับเรื่องทาง LINE และ Facebook
            <InfoHint>ลูกค้าที่เริ่มเรื่องใหม่รู้ทันทีว่าข้อความถึงแล้ว และทีมจะตอบราวเมื่อไร ข้อความทาง LINE นับรวมในโควตารายเดือนของบัญชี LINE องค์กร</InfoHint>
          </h2>
        </div>
      </div>
      <Form
        className="card-body"
        onSubmit={async (values, form) => {
          await saveReceipt({ enabled: (form.elements.namedItem('enabled') as HTMLInputElement).checked, message: values.message ?? '' });
          toast('บันทึกข้อความรับเรื่องแล้ว');
          await refresh(WORKSPACE_PATH);
        }}
      >
        <div className="hours-switches">
          {/* Label text and (i) sit straight in the label: a <span> here is a grid (hours-switches) and would put the (i) on a line of its own. */}
          <label className="check">
            <input type="checkbox" className="switch" name="enabled" defaultChecked={initial.enabled} />
            ส่งข้อความรับเรื่องเมื่อลูกค้าเริ่มเรื่องใหม่
            <InfoHint>ส่งครั้งเดียวต่อเรื่องทาง LINE (แชทส่วนตัว) Facebook และ Instagram พร้อมปุ่มดูลำดับคิว นอกเวลาทำการส่งข้อความนอกเวลาแทน และไม่ส่งในแชทที่ Chatbot ตอบอยู่</InfoHint>
          </label>
        </div>
        <div className="field">
          <label htmlFor="receipt-message">
            ข้อความรับเรื่อง
            <InfoHint>ใส่ {TOKEN} ตรงที่ต้องการ ระบบจะเติมเวลารอให้ เช่น “ภายในประมาณ 10 นาที” หรือ “โดยเร็วที่สุด” เมื่อยังไม่มีทีมงานที่พร้อมตอบ</InfoHint>
          </label>
          <textarea id="receipt-message" name="message" rows={3} maxLength={500} required defaultValue={initial.message} />
          <p className="tiny muted">{TOKEN} = เวลารอโดยประมาณ</p>
        </div>
        <button className="btn primary mt" type="submit">
          <Icon name="check" />
          บันทึกข้อความรับเรื่อง
        </button>
      </Form>
    </section>
  );
}
