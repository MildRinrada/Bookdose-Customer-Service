'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { customerLoginVerify } from '../api';

/* The second step of a customer sign-in: the password was right, and the account asks for the code from its
   authenticator app (or one of the printed recovery codes). Nothing is signed in until this passes; the waiting
   sign-in lives in a short cookie the page never sees. Markup: pages/security.css. */

export function TwoFactorStep({ methods, onDone }: { methods: string[]; onDone: () => void }) {
  const [recovery, setRecovery] = useState(false);
  const canRecover = methods.includes('recovery');
  return (
    <Form
      className="auth-form two-factor"
      data-form="customer-2fa"
      onSubmit={async (values) => {
        await customerLoginVerify(recovery ? { recovery_code: values.recovery_code } : { code: values.code });
        onDone();
      }}
    >
      <div className="eyebrow">ONE MORE STEP</div>
      <h2>ยืนยันอีกขั้นตอน</h2>
      {recovery ? (
        <>
          <p>กรอกรหัสสำรองหนึ่งรหัสที่คุณเก็บไว้ตอนเปิดการยืนยันสองขั้นตอน แต่ละรหัสใช้ได้ครั้งเดียว</p>
          <TextField
            key="recovery"
            label="รหัสสำรอง"
            name="recovery_code"
            max={20}
            autoFocus
            autoComplete="one-time-code"
            spellCheck={false}
            placeholder="เช่น ABCDE-FGHJK"
          />
        </>
      ) : (
        <>
          <p>เปิดแอปยืนยันตัวตนของคุณ แล้วกรอกตัวเลข 6 หลักที่แสดงอยู่ตอนนี้</p>
          <TextField
            key="code"
            label="รหัส 6 หลัก"
            name="code"
            max={10}
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
          />
        </>
      )}
      <button className="btn primary" type="submit">
        เข้าสู่ระบบ <Icon name="arrow" />
      </button>
      {canRecover && (
        <button className="btn subtle" type="button" onClick={() => setRecovery(!recovery)}>
          {recovery ? 'กลับไปใช้รหัสจากแอป' : 'ใช้รหัสสำรองแทน'}
        </button>
      )}
      <div className="auth-foot">
        <Icon name="shield" /> รหัสนี้ใช้ได้ครั้งเดียวและมีอายุสั้น หากกรอกผิดหลายครั้งให้เข้าสู่ระบบใหม่
      </div>
    </Form>
  );
}
