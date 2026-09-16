'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { ErrorState, InitialLoading } from '@/components/ui/display';
import { TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useCustomerAccount } from '@/lib/customer-session';
import { useBoot } from '@/lib/session';
import { customerForgot, customerReset, customerVerify } from './api';
import { CustomerLinkPage } from './components/Frames';
import { TwoFactorStep } from './components/TwoFactorStep';
import { customerDestination, useFinishCustomerSignIn, useSignupOrg } from './hooks';
import { withOrg } from './params';

/* /customer/verify?token=, /customer/reset?token= and /customer/forgot: one thing to do on its own page, from a
   customer's email (customerLinkPage() in pages/customer/customer.js). Signed in already, the visitor goes on to
   their own screens. */

export type CustomerLinkKind = 'verify' | 'reset' | 'forgot';

export function CustomerLinkScreen({ kind, token = '', org = '' }: { kind: CustomerLinkKind; token?: string; org?: string }) {
  const boot = useBoot();
  const account = useCustomerAccount();
  const router = useRouter();
  const staffIn = Boolean(boot.data?.user);
  const customerIn = Boolean(account.data?.signed_in);
  const signedOut = Boolean(boot.data && account.data && !staffIn && !customerIn);
  const signup = useSignupOrg(org, signedOut ? boot.data?.home : undefined);
  const settled = !boot.isFetching && !account.isFetching;
  const name = signup.info?.organization.name || boot.data?.home?.name || '';

  useEffect(() => {
    if (!settled) return;
    if (staffIn) router.replace('/dashboard');
    else if (customerIn) router.replace(customerDestination('', org));
  }, [settled, staffIn, customerIn, org, router]);

  useEffect(() => {
    if (!name) return;
    const before = document.title;
    document.title = `${name} · Bookdose`;
    return () => {
      document.title = before;
    };
  }, [name]);

  const error = boot.error ?? account.error;
  if (error)
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void boot.refetch();
          void account.refetch();
        }}
      />
    );
  if (!signedOut || signup.loading) return <InitialLoading />;

  return (
    <CustomerLinkPage organization={name} loginHref={withOrg('/login', org)}>
      {kind === 'verify' ? (
        <VerifyForm token={token} org={org} signupOrg={signup.signupOrg} />
      ) : kind === 'reset' ? (
        <ResetForm token={token} signupOrg={signup.signupOrg} />
      ) : (
        <ForgotForm mailReady={Boolean(signup.info?.email_verification)} />
      )}
    </CustomerLinkPage>
  );
}

/** pages/customer/customer-verify.html */
function VerifyForm({ token, org, signupOrg }: { token: string; org: string; signupOrg: string }) {
  const finish = useFinishCustomerSignIn();
  return (
    <Form
      className="card-body"
      onSubmit={async (values) => {
        await customerVerify(token, values.password);
        // Moving on replaces the address, so the used token leaves it.
        finish(customerDestination('', signupOrg), 'ยืนยันอีเมลเรียบร้อย ยินดีต้อนรับ');
      }}
    >
      <span className="customer-center-icon">
        <Icon name="checkCircle" />
      </span>
      <h1>ยืนยันอีเมล</h1>
      <p>กรอกรหัสผ่านที่ตั้งไว้ตอนสมัคร เพื่อยืนยันว่าเป็นคุณ แล้วเริ่มใช้งานได้ทันที</p>
      <TextField label="รหัสผ่านที่ตั้งไว้ตอนสมัคร" name="password" type="password" max={200} autoFocus />
      <button className="btn primary customer-submit" type="submit">
        <Icon name="check" />
        ยืนยันและเข้าสู่ระบบ
      </button>
      <p className="small muted">
        จำรหัสผ่านที่ตั้งไว้ไม่ได้? <Link href={withOrg('/login?tab=signup', org)}>สมัครใหม่</Link> ด้วยอีเมลเดิมได้เลย
      </p>
    </Form>
  );
}

/** pages/customer/customer-reset.html. On an account with two-factor sign-in the link ends in the second step:
    the new password is saved, but the code from the authenticator app still decides who gets in. */
function ResetForm({ token, signupOrg }: { token: string; signupOrg: string }) {
  const finish = useFinishCustomerSignIn();
  const [secondStep, setSecondStep] = useState<string[] | null>(null);
  if (secondStep)
    return (
      <div className="card-body">
        <TwoFactorStep methods={secondStep} onDone={() => finish(customerDestination('', signupOrg), 'ตั้งรหัสผ่านใหม่แล้ว')} />
      </div>
    );
  return (
    <Form
      className="card-body"
      onSubmit={async (values) => {
        if (values.password !== values.password_confirm) throw new Error('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
        const result = await customerReset(token, values.password);
        if (result.two_factor) {
          setSecondStep(result.methods ?? ['totp']);
          return;
        }
        finish(customerDestination('', signupOrg), 'ตั้งรหัสผ่านใหม่แล้ว');
      }}
    >
      <span className="customer-center-icon">
        <Icon name="lock" />
      </span>
      <h1>ตั้งรหัสผ่านใหม่</h1>
      <p>รหัสผ่านใหม่ต้องมีอย่างน้อย 10 ตัวอักษร เมื่อบันทึกแล้วอุปกรณ์อื่นที่เข้าสู่ระบบไว้จะออกจากระบบ</p>
      <TextField label="รหัสผ่านใหม่ (อย่างน้อย 10 ตัวอักษร)" name="password" type="password" max={200} autoFocus />
      <TextField label="พิมพ์รหัสผ่านใหม่อีกครั้ง" name="password_confirm" type="password" max={200} matches="password" />
      <button className="btn primary customer-submit" type="submit">
        <Icon name="check" />
        บันทึกและเข้าสู่ระบบ
      </button>
    </Form>
  );
}

/** pages/customer/customer-forgot.html */
function ForgotForm({ mailReady }: { mailReady: boolean }) {
  const [sent, setSent] = useState('');
  if (sent)
    return (
      <div className="card-body">
        <span className="customer-center-icon">
          <Icon name="mail" />
        </span>
        <h1>ตรวจอีเมลของคุณ</h1>
        <p>
          ถ้า <strong>{sent}</strong> มีบัญชีอยู่ เราส่งลิงก์ตั้งรหัสผ่านใหม่ให้แล้ว ลิงก์มีอายุ 1 ชั่วโมงและใช้ได้ครั้งเดียว
        </p>
      </div>
    );
  if (!mailReady)
    return (
      <div className="card-body">
        <span className="customer-center-icon">
          <Icon name="lock" />
        </span>
        <h1>ลืมรหัสผ่าน</h1>
        <p>ตอนนี้ระบบยังส่งอีเมลตั้งรหัสผ่านใหม่ไม่ได้ กรุณาติดต่อทีมงานผ่านช่องทางอื่นขององค์กรเพื่อขอความช่วยเหลือ</p>
      </div>
    );
  return (
    <Form
      className="card-body"
      onSubmit={async (values) => {
        await customerForgot(values.email);
        setSent(values.email);
      }}
    >
      <span className="customer-center-icon">
        <Icon name="lock" />
      </span>
      <h1>ลืมรหัสผ่าน</h1>
      <p>กรอกอีเมลที่ใช้สมัคร เราจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ให้</p>
      <TextField label="อีเมลที่ใช้สมัคร" name="email" type="email" max={254} autoFocus />
      <button className="btn primary customer-submit" type="submit">
        <Icon name="send" />
        ส่งลิงก์ตั้งรหัสผ่านใหม่
      </button>
    </Form>
  );
}
