'use client';

import { SelectField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { saveSmsSettings, SMS_PATH } from '@/features/guest/api';
import type { SmsSettings } from '@/features/guest/types';
import { useApi, useInvalidate } from '@/lib/query';

/* Platform console → ภาพรวมระบบ: the SMS sender for chat follow links (GET/POST /api/platform/sms). There is no SMS
   vendor yet: "off" hides the SMS option from visitors, "log" writes each text to the server log for testing. */

export function SmsSettingsCard() {
  const { data, error } = useApi<SmsSettings>(SMS_PATH);
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <section className="card system-section">
      <div className="card-header">
        <div>
          <h2>SMS สำหรับลิงก์ติดตามแชท</h2>
          <p>ผู้เยี่ยมชมที่ไม่มีอีเมลขอลิงก์กลับมาที่แชททาง SMS ได้เมื่อเปิดผู้ให้บริการ SMS</p>
        </div>
      </div>
      <div className="card-body">
        {error ? (
          <p className="notice warning">{error.message}</p>
        ) : !data ? (
          <p className="muted">กำลังโหลด…</p>
        ) : (
          <Form
            key={data.provider}
            className="guest-inline sms-settings"
            onSubmit={async (values) => {
              await saveSmsSettings(values.provider ?? 'off');
              toast(values.provider === 'log' ? 'เปิด SMS แบบทดสอบแล้ว' : 'ปิดการส่ง SMS แล้ว');
              await refresh(SMS_PATH);
            }}
          >
            <SelectField label="ผู้ให้บริการ SMS" name="provider" id="sms-provider" defaultValue={data.provider === 'log' ? 'log' : 'off'}>
              <option value="off">ปิด</option>
              <option value="log">ทดสอบ: แสดงข้อความใน log ของเซิร์ฟเวอร์</option>
            </SelectField>
            <button className="btn primary" type="submit">
              บันทึก
            </button>
          </Form>
        )}
        <p className="tiny muted mt">ข้อความ SMS มีเฉพาะชื่อองค์กรและลิงก์ ไม่มีเนื้อหาแชท · โหมดทดสอบไม่ได้ส่งถึงโทรศัพท์จริง</p>
      </div>
    </section>
  );
}
