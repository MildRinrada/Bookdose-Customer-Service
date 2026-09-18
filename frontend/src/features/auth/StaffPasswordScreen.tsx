'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { HoneypotField, honeypotValue } from '@/components/ui/HoneypotField';
import { useToast } from '@/components/ui/Toast';
import { staffForgotPassword, staffResetPassword } from './api';
import { SinglePage } from './components/Frames';

/* /forgot-password and /reset-password: a staff member or platform admin who cannot sign in gets back in on their own
   (backend auth.forgot_password / auth.reset_password). Setting a new password also lifts the lock from repeated wrong
   passwords, so nobody has to wait it out or ask an admin. The link itself signs nobody in: the new password (and the
   second step, where the account has one) is still asked for on the sign-in page. */

export function StaffPasswordScreen({ kind, token = '' }: { kind: 'forgot' | 'reset'; token?: string }) {
  return <SinglePage>{kind === 'forgot' ? <ForgotCard /> : <ResetCard token={token} />}</SinglePage>;
}

function ForgotCard() {
  const [sent, setSent] = useState('');
  if (sent)
    return (
      <section className="card mt">
        <div className="card-body">
          <h1>ส่งลิงก์แล้ว ถ้าอีเมลนี้มีบัญชี</h1>
          <p>
            หากมีบัญชีทีมงานที่ใช้ {sent} ระบบได้ส่งลิงก์ตั้งรหัสผ่านใหม่ไปแล้ว กรุณาตรวจกล่องจดหมายและโฟลเดอร์สแปม ลิงก์มีอายุ 1 ชั่วโมง
          </p>
          <p className="notice">ระบบไม่บอกว่าอีเมลใดมีบัญชีอยู่บ้าง เพื่อไม่ให้ใครใช้หน้านี้ค้นหาว่าใครทำงานที่ไหน</p>
          <Link className="btn" href="/login">
            กลับไปหน้าเข้าสู่ระบบ
          </Link>
        </div>
      </section>
    );
  return (
    <section className="card mt">
      <div className="card-body">
        <h1>ลืมรหัสผ่านบัญชีทีมงาน</h1>
        <p>กรอกอีเมลที่ใช้เข้าสู่ระบบ ระบบจะส่งลิงก์ให้คุณตั้งรหัสผ่านใหม่ด้วยตัวเอง ไม่ต้องรอผู้ดูแลองค์กร</p>
        <Form
          onSubmit={async (values) => {
            await staffForgotPassword(values.email ?? '', { website: honeypotValue(values) });
            setSent(values.email ?? '');
          }}
        >
          <div className="stack mb">
            <TextField id="forgot-email" label="อีเมลที่ใช้เข้าสู่ระบบ" name="email" type="email" max={254} autoFocus />
          </div>
          <HoneypotField />
          <button className="btn primary" type="submit">
            <Icon name="mail" />
            ส่งลิงก์ตั้งรหัสผ่านใหม่
          </button>
        </Form>
        <p className="small muted mt">
          <Link href="/login">กลับไปหน้าเข้าสู่ระบบ</Link>
        </p>
      </div>
    </section>
  );
}

function ResetCard({ token }: { token: string }) {
  const router = useRouter();
  const toast = useToast();
  if (!token)
    return (
      <section className="card mt">
        <div className="card-body">
          <h1>ลิงก์ไม่ครบถ้วน</h1>
          <p className="notice warning">กรุณาเปิดลิงก์จากอีเมลอีกครั้ง หรือขอลิงก์ใหม่</p>
          <Link className="btn" href="/forgot-password">
            ขอลิงก์ใหม่
          </Link>
        </div>
      </section>
    );
  return (
    <section className="card mt">
      <div className="card-body">
        <h1>ตั้งรหัสผ่านใหม่</h1>
        <p>เมื่อตั้งรหัสผ่านใหม่แล้ว อุปกรณ์ที่ยังเข้าสู่ระบบค้างไว้จะถูกออกจากระบบทั้งหมด และ Passkey เดิมจะถูกลบเพื่อความปลอดภัย</p>
        <Form
          onSubmit={async (values) => {
            await staffResetPassword(token, values.password ?? '');
            toast('ตั้งรหัสผ่านใหม่แล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่');
            router.replace('/login');
          }}
        >
          <div className="stack mb">
            <TextField id="reset-password" label="รหัสผ่านใหม่" name="password" type="password" max={200} autoFocus />
          </div>
          <button className="btn primary" type="submit">
            <Icon name="check" />
            บันทึกรหัสผ่านใหม่
          </button>
        </Form>
        <p className="small muted mt">
          ลิงก์นี้ใช้ได้ครั้งเดียว หากหมดอายุแล้วให้ <Link href="/forgot-password">ขอลิงก์ใหม่</Link>
        </p>
      </div>
    </section>
  );
}
