'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { customerLoginVerify, staffLoginVerify } from '../api';
import { LockNotice, useSignInLock } from './SignInLock';

/* The second step of a sign-in (a customer's, or a staff account's with `kind="staff"`): the password was right, and
   the account asks for the code from its authenticator app (or one of the printed recovery codes). Nothing is signed in until this passes; the waiting
   sign-in lives in a short cookie the page never sees. Wrong codes count towards the account's sign-in lock: while
   it lasts the step shows the countdown and waits. Markup: pages/security.css. */

export function TwoFactorStep({ methods, onDone, kind = 'customer' }: { methods: string[]; onDone: () => void; kind?: 'staff' | 'customer' }) {
  const [recovery, setRecovery] = useState(false);
  const canRecover = methods.includes('recovery');
  const lock = useSignInLock();
  return (
    <Form
      className="auth-form two-factor"
      data-form={kind === 'staff' ? 'staff-2fa' : 'customer-2fa'}
      onSubmit={async (values) => {
        if (lock.locked) return;
        try {
          const body = recovery ? { recovery_code: values.recovery_code } : { code: values.code };
          await (kind === 'staff' ? staffLoginVerify(body) : customerLoginVerify(body));
        } catch (error) {
          if (lock.catchLock(error)) return;
          throw error;
        }
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
      <LockNotice
        lock={lock}
        help={
          <>
            {kind === 'staff' ? (
              'ทำโทรศัพท์และรหัสสำรองหาย? ติดต่อผู้ดูแลระบบให้รีเซ็ตการยืนยันสองขั้นตอน'
            ) : (
              <>
                จำรหัสผ่านไม่ได้?{' '}
                <Link className="btn subtle" href="/customer/forgot">
                  ลืมรหัสผ่าน
                </Link>
              </>
            )}
          </>
        }
      />
      {/* Keyed by the lock: the form re-enables its buttons after submitting, which must not undo the lock. */}
      <button key={lock.locked ? 'locked' : 'open'} className="btn primary" type="submit" disabled={lock.locked}>
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
