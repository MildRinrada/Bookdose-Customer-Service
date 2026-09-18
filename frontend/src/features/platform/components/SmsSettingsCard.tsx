'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { SelectField, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { saveSmsSettings, sendTestSms, SMS_PATH } from '@/features/guest/api';
import type { SmsProvider, SmsSettings } from '@/features/guest/types';
import { useApi, useInvalidate } from '@/lib/query';

/* Platform console → ภาพรวมระบบ: the SMS sender for chat follow links and a guest's notices (GET/POST
   /api/platform/sms, backend/extensions/sms.py). ThaiBulkSMS for Thai numbers, Twilio for any country; "log" writes
   each text to the server log for testing. Credentials are sealed on the server and never shown again: leaving the
   boxes empty keeps what was saved. A test message checks the whole setup with a real phone. */

const providerLabels: Record<SmsProvider, string> = {
  off: 'ปิด',
  log: 'ทดสอบ: แสดงข้อความใน log ของเซิร์ฟเวอร์',
  thaibulksms: 'ThaiBulkSMS (เบอร์ในประเทศไทย)',
  twilio: 'Twilio (ทุกประเทศ)',
};

export function SmsSettingsCard() {
  const { data, error } = useApi<SmsSettings>(SMS_PATH);
  return (
    <section className="card system-section">
      <div className="card-header">
        <div>
          <h2>SMS สำหรับลิงก์ติดตามแชท</h2>
          <p>ผู้เยี่ยมชมที่ไม่มีอีเมลขอลิงก์กลับมาที่แชททาง SMS ได้ และได้รับ SMS แจ้งเมื่อมีคำตอบใหม่</p>
        </div>
      </div>
      <div className="card-body">
        {error ? (
          <p className="notice warning">{error.message}</p>
        ) : !data ? (
          <p className="muted">กำลังโหลด…</p>
        ) : (
          <SmsForm key={`${data.provider}:${data.sender}:${data.account}`} data={data} />
        )}
        <p className="tiny muted mt">
          ข้อความ SMS มีเฉพาะชื่อองค์กรและลิงก์ ไม่มีเนื้อหาแชท · API Key, Secret และ Auth Token ถูกเข้ารหัสเก็บบนเซิร์ฟเวอร์ และไม่แสดงซ้ำ
        </p>
      </div>
    </section>
  );
}

function SmsForm({ data }: { data: SmsSettings }) {
  const toast = useToast();
  const refresh = useInvalidate();
  const [provider, setProvider] = useState<SmsProvider>(data.provider);
  const saved = provider === 'thaibulksms' || provider === 'twilio' ? data.configured[provider] : false;
  const keep = saved ? 'เว้นว่างไว้เพื่อใช้ค่าที่บันทึกไว้' : undefined;
  const inUse = data.provider === provider;

  return (
    <>
      <Form
        className="stack sms-settings"
        onSubmit={async (values) => {
          await saveSmsSettings({
            provider,
            sender: values.sender ?? '',
            account: values.account ?? '',
            key: values.key ?? '',
            secret: values.secret ?? '',
          });
          toast(provider === 'off' ? 'ปิดการส่ง SMS แล้ว' : provider === 'log' ? 'เปิด SMS แบบทดสอบแล้ว' : `บันทึกการตั้งค่า ${providerLabels[provider]} แล้ว`);
          await refresh(SMS_PATH);
        }}
      >
        <SelectField
          label="ผู้ให้บริการ SMS"
          name="provider"
          id="sms-provider"
          value={provider}
          onChange={(event) => setProvider(event.currentTarget.value as SmsProvider)}
        >
          {(Object.keys(providerLabels) as SmsProvider[]).map((key) => (
            <option key={key} value={key}>
              {providerLabels[key]}
            </option>
          ))}
        </SelectField>
        {provider === 'thaibulksms' && (
          <div className="form-grid">
            <TextField
              id="sms-sender"
              label="ชื่อผู้ส่ง (Sender name)"
              name="sender"
              max={11}
              defaultValue={data.provider === 'thaibulksms' ? data.sender : ''}
              hint="ชื่อที่ลงทะเบียนและได้รับอนุมัติใน ThaiBulkSMS แล้ว ภาษาอังกฤษไม่เกิน 11 ตัว"
            />
            <span />
            <TextField id="sms-key" label="API Key" name="key" type="password" max={200} required={!saved} hint={keep} autoComplete="off" />
            <TextField id="sms-secret" label="API Secret" name="secret" type="password" max={200} required={!saved} hint={keep} autoComplete="off" />
          </div>
        )}
        {provider === 'twilio' && (
          <div className="form-grid">
            <TextField
              id="sms-account"
              label="Account SID"
              name="account"
              max={34}
              defaultValue={data.account}
              hint="ขึ้นต้นด้วย AC จากหน้า Console ของ Twilio"
            />
            <TextField
              id="sms-sender"
              label="ผู้ส่ง"
              name="sender"
              max={40}
              defaultValue={data.provider === 'twilio' ? data.sender : ''}
              hint="เบอร์ Twilio แบบสากล เช่น +15551234567 หรือ Messaging Service SID (MG…)"
            />
            <TextField id="sms-secret" label="Auth Token" name="secret" type="password" max={64} required={!saved} hint={keep} autoComplete="off" />
          </div>
        )}
        {provider === 'log' && <p className="notice warning">โหมดทดสอบไม่ได้ส่งถึงโทรศัพท์จริง ข้อความจะอยู่ใน log ของเซิร์ฟเวอร์เท่านั้น</p>}
        <div>
          <button className="btn primary" type="submit">
            บันทึก
          </button>
        </div>
      </Form>
      {inUse && data.provider !== 'off' && (
        <Form
          className="guest-inline sms-test mt"
          onSubmit={async (values, form) => {
            const answer = await sendTestSms(values.to ?? '');
            toast(`ส่ง SMS ทดสอบถึง ${answer.to_masked} แล้ว กรุณาตรวจที่โทรศัพท์`);
            form.reset();
          }}
        >
          <TextField id="sms-test-to" label="ส่ง SMS ทดสอบไปที่เบอร์" name="to" type="tel" max={20} placeholder="08x-xxx-xxxx" />
          <button className="btn" type="submit">
            <Icon name="send" />
            ส่งทดสอบ
          </button>
        </Form>
      )}
    </>
  );
}
