'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ErrorState, InitialLoading } from '@/components/ui/display';
import { TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useBoot, useStaffLogout } from '@/lib/session';
import { resendRegistration, verifyRegistration } from './api';
import { SinglePage } from './components/Frames';
import { rememberRegistrationEmail, rememberedRegistrationEmail, useFinishStaffSignIn } from './hooks';

/* /verify-email?token=, /check-email and /resend-email: confirming an organization sign-up
   (pages/auth/verification.html, verificationPage() in modules/auth/registration.js). */

export type VerificationPage = 'verify-email' | 'check-email' | 'resend-email';

export function VerificationScreen({ page, token = '' }: { page: VerificationPage; token?: string }) {
  const boot = useBoot();
  const toast = useToast();
  const logout = useStaffLogout();
  const finishStaff = useFinishStaffSignIn();
  const [status, setStatus] = useState('');

  if (boot.error) return <ErrorState error={boot.error} onRetry={() => void boot.refetch()} />;
  if (!boot.data) return <InitialLoading />;

  const user = boot.data.user;
  const verify = !user && page === 'verify-email';
  const resend = !user && page !== 'verify-email';
  const checkEmail = page === 'check-email';

  const logOut = async () => {
    try {
      // Everything cached belonged to the old session: ask again who is signed in (nobody), then show the form here.
      await logout({ stay: true });
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  };

  return (
    <SinglePage>
      <section className="card mt">
        <div className="card-body">
          {user && (
            <>
              <h1>กรุณาออกจากระบบก่อนยืนยันบัญชีใหม่</h1>
              <p>ขณะนี้เข้าสู่ระบบด้วย {user.email}</p>
              <button type="button" className="btn" onClick={() => void logOut()}>
                ออกจากระบบเพื่อยืนยันอีเมล
              </button>{' '}
              <Link href="/dashboard">กลับพื้นที่ทำงาน</Link>
            </>
          )}
          {verify && (
            <>
              <h1>ยืนยันอีเมลของคุณ</h1>
              <p>กดปุ่มด้านล่างเพื่อยืนยันอีเมลและสร้างองค์กรที่คุณสมัครไว้</p>
              <Form
                onSubmit={async (values) => {
                  await verifyRegistration(values.token ?? '');
                  // Signed in to the new organization; the link token leaves the address with this move.
                  finishStaff('/dashboard');
                  toast('ยืนยันอีเมลและสร้างองค์กรเรียบร้อยแล้ว');
                }}
              >
                <input type="hidden" name="token" value={token} />
                <button className="btn primary" type="submit">
                  ยืนยันอีเมลและสร้างองค์กร
                </button>
              </Form>
              <p className="small">
                <Link href="/resend-email">ลิงก์หมดอายุหรือใช้ไม่ได้? ขอลิงก์ใหม่</Link>
              </p>
            </>
          )}
          {resend && (
            <>
              <h1>{checkEmail ? 'กรุณาตรวจอีเมลของคุณ' : 'ขอลิงก์ยืนยันอีเมลใหม่'}</h1>
              <p>
                {checkEmail && 'หากอีเมลนี้มีคำขอสมัครที่รอยืนยัน ระบบจะส่งลิงก์ให้ กรุณาตรวจกล่องจดหมายและสแปม'} ลิงก์มีอายุ 1 ชั่วโมง
                ให้เปิดลิงก์แล้วกดยืนยันเพื่อเข้าใช้งาน
              </p>
              <Form
                onSubmit={async (values) => {
                  await resendRegistration(values.email);
                  rememberRegistrationEmail(values.email);
                  setStatus('หากมีคำขอที่รอยืนยัน ระบบจะส่งลิงก์ให้ กรุณาตรวจอีเมลและสแปม หากมีบัญชีแล้วให้เข้าสู่ระบบ');
                }}
              >
                <TextField label="อีเมลที่ใช้สมัคร" name="email" type="email" max={254} defaultValue={rememberedRegistrationEmail()} />
                <p className="tiny muted">ขอลิงก์ใหม่ได้หลังรอ 1 นาที ลิงก์ใหม่จะยกเลิกลิงก์เดิม หากสมัครเกิน 24 ชั่วโมงแล้ว ให้สมัครใหม่</p>
                <button className="btn primary" type="submit">
                  ส่งลิงก์ยืนยันใหม่
                </button>
                <div className="small" role="status">
                  {status}
                </div>
              </Form>
            </>
          )}
          <p className="small mt">
            <Link href="/login">เข้าสู่ระบบ</Link> · <Link href="/register">สมัครองค์กรใหม่</Link>
          </p>
        </div>
      </section>
    </SinglePage>
  );
}
