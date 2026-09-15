'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { TextSizeControls } from '@/components/shell/TextSize';
import { useDialogs } from '@/components/ui/Dialogs';
import { ErrorState, InitialLoading } from '@/components/ui/display';
import { TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api/client';
import { useCustomerAccount } from '@/lib/customer-session';
import { useBoot } from '@/lib/session';
import type { Boot } from '@/lib/types';
import { customerLogin, customerRegister, customerResend, registerOrganization, setUp, staffLogin } from './api';
import { AuthStory } from './components/AuthStory';
import { ForgotPasswordHelp } from './components/ForgotPasswordHelp';
import { SinglePage } from './components/Frames';
import { PrivacyNotice } from './components/PrivacyNotice';
import { SlugField } from './components/SlugField';
import {
  customerDestination,
  rememberRegistrationEmail,
  staffDestination,
  useFinishCustomerSignIn,
  useFinishStaffSignIn,
  useSignupOrg,
} from './hooks';
import { withOrg } from './params';
import type { PublicOrgInfo } from './types';

/* /login and /register (pages/auth/auth.js, the signed-out branch of the old route()).
   - /login: "เข้าสู่ระบบ" for everyone (staff go to their workspace, customers to their own screens) and
     "สมัครสมาชิก" for customers of the organization named by ?org=, else the platform's own. Before the first
     organization exists, the first-time setup form instead.
   - /register: organization sign-up, or a page saying it is not open yet.
   Someone already signed in is sent on to their screens. */

export type AuthTab = 'login' | 'signup';

type Props = {
  page: 'login' | 'register';
  /** ?tab=signup opens the customer sign-up tab. */
  tab?: AuthTab;
  /** ?org=<code>, already checked against the code pattern. */
  org?: string;
  /** ?next=, a path inside the app to return to after signing in. */
  next?: string;
};

export function AuthScreen({ page, tab = 'login', org = '', next = '' }: Props) {
  const boot = useBoot();
  const account = useCustomerAccount();
  const router = useRouter();
  const staffIn = Boolean(boot.data?.user);
  const customerIn = Boolean(account.data?.signed_in);
  const signedOut = Boolean(boot.data && account.data && !staffIn && !customerIn);
  const signup = useSignupOrg(org, signedOut ? boot.data?.home : undefined);
  const settled = !boot.isFetching && !account.isFetching;

  useEffect(() => {
    if (!settled) return;
    if (staffIn) router.replace(staffDestination(next));
    else if (customerIn) router.replace(customerDestination(next, org));
  }, [settled, staffIn, customerIn, next, org, router]);

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
  if (!boot.data || !signedOut || signup.loading) return <InitialLoading />;

  if (page === 'register' && boot.data.setup_required)
    return <RegistrationClosed message="เจ้าของระบบต้องตั้งค่าครั้งแรกก่อน จึงจะสมัครองค์กรใหม่ได้" linkLabel="กลับหน้าหลัก" />;
  if (page === 'register' && !boot.data.registration_available)
    return <RegistrationClosed message="กรุณาติดต่อ Bookdose เพื่อเปิดใช้งานอีเมลยืนยันการสมัคร" linkLabel="กลับหน้าเข้าสู่ระบบ" />;

  return (
    <AuthPage
      boot={boot.data}
      setup={boot.data.setup_required}
      register={page === 'register'}
      initialTab={tab}
      org={org}
      signupOrg={signup.signupOrg}
      info={signup.info}
      next={next}
    />
  );
}

/** pages/auth/registration-closed.html */
function RegistrationClosed({ message, linkLabel }: { message: string; linkLabel: string }) {
  return (
    <SinglePage>
      <section className="card mt">
        <div className="card-body">
          <h1>ยังไม่เปิดรับสมัครองค์กร</h1>
          <p>{message}</p>
          <Link className="btn" href="/login">
            {linkLabel}
          </Link>
        </div>
      </section>
    </SinglePage>
  );
}

const SIGNUP_CLOSED = 'ระบบนี้ให้บริการหลายองค์กร กรุณาเปิดจากลิงก์ที่องค์กรที่คุณใช้บริการให้ไว้ เพื่อสมัครสมาชิกกับองค์กรนั้น';

type AuthPageProps = {
  boot: Boot;
  setup: boolean;
  register: boolean;
  initialTab: AuthTab;
  org: string;
  signupOrg: string;
  info: PublicOrgInfo | null;
  next: string;
};

/** pages/auth/auth.html */
function AuthPage({ boot, setup, register, initialTab, org, signupOrg, info, next }: AuthPageProps) {
  const router = useRouter();
  const toast = useToast();
  const { openModal } = useDialogs();
  const finishStaff = useFinishStaffSignIn();
  const finishCustomer = useFinishCustomerSignIn();
  const card = useRef<HTMLDivElement>(null);
  const focusAfterSwitch = useRef(false);

  // The tab follows the address (?tab=signup) and survives switching back and forth with what was sent.
  const [tab, setTab] = useState<AuthTab>(initialTab);
  const [seenTab, setSeenTab] = useState<AuthTab>(initialTab);
  if (initialTab !== seenTab) {
    setSeenTab(initialTab);
    setTab(initialTab);
  }
  const [sentTo, setSentTo] = useState('');
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (!focusAfterSwitch.current) return;
    focusAfterSwitch.current = false;
    card.current?.querySelector<HTMLInputElement>('.auth-form input')?.focus();
  }, [tab]);

  const creating = setup || register;
  const login = !creating;
  const signUp = login && tab === 'signup';
  const kind = setup ? 'setup' : register ? 'register' : 'login';
  // Customers sign up with the organization of the link the page was opened with, else the platform's own.
  const signupOrganization = info?.organization ?? boot.home;
  const verifyEmail = Boolean(info?.email_verification);
  const supportName = signupOrganization?.name ?? '';

  const switchTab = (value: AuthTab) => {
    focusAfterSwitch.current = true;
    setTab(value);
    const query = new URLSearchParams();
    if (value === 'signup') query.set('tab', 'signup');
    if (org) query.set('org', org);
    if (next) query.set('next', next);
    const text = query.toString();
    router.replace(text ? `/login?${text}` : '/login', { scroll: false });
  };

  const submitStaffForm = async (values: Record<string, string>, form: HTMLFormElement) => {
    if (kind === 'login') {
      // One sign-in for everyone: an email that is not a staff account is tried as a customer account.
      try {
        await staffLogin(values.email, values.password);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401 || !boot.home) throw error;
        await customerLogin(values.email, values.password);
        finishCustomer(customerDestination(next, signupOrg), 'เข้าสู่ระบบแล้ว');
        return;
      }
      finishStaff(staffDestination(next));
      return;
    }
    if (kind === 'register') {
      if (values.password !== values.password_confirm) throw new Error('รหัสผ่านยืนยันไม่ตรงกัน');
      await registerOrganization({
        name: values.name,
        email: values.email,
        password: values.password,
        password_confirm: values.password_confirm,
        organization: values.organization,
        slug: values.slug,
      });
      rememberRegistrationEmail(values.email);
      router.push('/check-email');
      return;
    }
    await setUp({
      name: values.name,
      email: values.email,
      password: values.password,
      organization: values.organization,
      slug: values.slug,
      ...(values.setup_token !== undefined ? { setup_token: values.setup_token } : {}),
      demo: (form.elements.namedItem('demo') as HTMLInputElement | null)?.checked ?? false,
    });
    finishStaff('/dashboard');
  };

  const submitSignup = async (values: Record<string, string>, form: HTMLFormElement) => {
    const result = await customerRegister({
      name: values.name,
      email: values.email,
      password: values.password,
      phone: values.phone || '',
      consent: (form.elements.namedItem('consent') as HTMLInputElement).checked,
      ...(signupOrg ? { org: signupOrg } : {}),
    });
    // Without email set up the account is ready at once.
    if (result.signed_in) {
      finishCustomer(customerDestination(next, signupOrg), 'สมัครสมาชิกเรียบร้อย เริ่มแชทกับทีมงานได้เลย');
      return;
    }
    setSentTo(values.email);
  };

  const resend = async () => {
    setResending(true);
    try {
      await customerResend(sentTo);
      toast('ส่งลิงก์ยืนยันใหม่แล้ว ตรวจกล่องจดหมายและสแปม');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setResending(false);
    }
  };

  const openForgot = () =>
    openModal('ลืมรหัสผ่าน', <ForgotPasswordHelp customerReset={verifyEmail} forgotHref={withOrg('/customer/forgot', org)} />);

  return (
    <main className="auth-page">
      <AuthStory />
      <section className="auth-form-wrap">
        <div className="auth-card" ref={card}>
          <TextSizeControls />
          {login && (
            <div className="auth-tabs" role="tablist" aria-label="เข้าสู่ระบบหรือสมัครสมาชิก">
              <button type="button" role="tab" aria-selected={!signUp} onClick={() => switchTab('login')}>
                เข้าสู่ระบบ
              </button>
              <button type="button" role="tab" aria-selected={signUp} onClick={() => switchTab('signup')}>
                สมัครสมาชิก
              </button>
            </div>
          )}
          {signUp ? (
            <div className="auth-form" role="tabpanel">
              {sentTo ? (
                <>
                  <h2>ตรวจอีเมลของคุณ</h2>
                  <p>
                    เราส่งลิงก์ยืนยันไปที่ <strong>{sentTo}</strong> เปิดลิงก์ แล้วกรอกรหัสผ่านที่เพิ่งตั้ง เพื่อเริ่มส่งเรื่องถึงทีมงาน
                  </p>
                  <p className="small muted">ไม่พบอีเมล? ตรวจโฟลเดอร์สแปม · ลิงก์มีอายุ 24 ชั่วโมง</p>
                  <button className="btn" type="button" disabled={resending} onClick={() => void resend()}>
                    <Icon name="send" />
                    ส่งลิงก์อีกครั้ง
                  </button>
                </>
              ) : signupOrganization ? (
                <Form onSubmit={submitSignup}>
                  <h2>สมัครสมาชิก</h2>
                  <p>สร้างบัญชีลูกค้า {supportName} เพื่อแชทกับทีมงาน ติดตามเคส และอ่านคำถามที่พบบ่อยได้ในที่เดียว</p>
                  <TextField label="ชื่อ-นามสกุล หรือชื่อที่ต้องการให้เรียก" name="name" max={100} placeholder="เช่น สมชาย ใจดี" personName />
                  <TextField label="อีเมล" name="email" type="email" placeholder="name@example.com" max={254} />
                  <TextField label="ตั้งรหัสผ่าน (อย่างน้อย 10 ตัวอักษร)" name="password" type="password" max={200} />
                  <TextField label="เบอร์โทรศัพท์ (ไม่บังคับ)" name="phone" type="tel" max={20} required={false} placeholder="เช่น 081-234-5678" />
                  <details className="auth-privacy">
                    <summary>ประกาศความเป็นส่วนตัว (อ่านก่อนสมัคร)</summary>
                    <PrivacyNotice organization={supportName} />
                  </details>
                  <label className="check">
                    <input type="checkbox" name="consent" required />
                    <span>ฉันอ่านและยอมรับประกาศความเป็นส่วนตัว และยินยอมให้ {supportName} เก็บและใช้ข้อมูลนี้เพื่อให้บริการ</span>
                  </label>
                  <button className="btn primary" type="submit">
                    {verifyEmail ? 'สมัครและส่งอีเมลยืนยัน' : 'สมัครสมาชิก'} <Icon name="arrow" />
                  </button>
                  <div className="auth-foot">
                    <Icon name="lock" /> {verifyEmail ? 'ต้องยืนยันอีเมลก่อนเริ่มใช้งาน' : 'สมัครแล้วเริ่มแชทกับทีมงานได้ทันที'}
                  </div>
                </Form>
              ) : (
                <>
                  <h2>สมัครสมาชิก</h2>
                  <p className="notice">{SIGNUP_CLOSED}</p>
                </>
              )}
            </div>
          ) : (
            <Form className="auth-form" data-form={kind} role={login ? 'tabpanel' : undefined} onSubmit={submitStaffForm}>
              <div className="eyebrow">{creating ? 'LET’S GET STARTED' : 'WELCOME BACK'}</div>
              <h2>{register ? 'สมัครองค์กรใหม่' : setup ? 'สร้างพื้นที่ดูแลลูกค้าของคุณ' : 'ยินดีต้อนรับกลับมาครับ'}</h2>
              <p>
                {register
                  ? 'สร้างบัญชีผู้ดูแลและพื้นที่บริการลูกค้าสำหรับองค์กรของคุณ'
                  : setup
                    ? 'ตั้งค่าผู้ดูแลและองค์กรแรก ใช้เวลาเพียงนิดเดียว'
                    : 'เข้าสู่ระบบด้วยอีเมลและรหัสผ่านของคุณ'}
              </p>
              {creating && <TextField label="ชื่อผู้ดูแล" name="name" placeholder="ชื่อที่ต้องการให้ทีมเห็น" max={100} />}
              <TextField label="อีเมล" name="email" type="email" placeholder="you@bookdose.com" max={254} />
              {creating ? (
                <TextField
                  label="รหัสผ่าน (อย่างน้อย 10 ตัวอักษร)"
                  name="password"
                  id="auth-password"
                  type="password"
                  max={200}
                  placeholder="สร้างรหัสผ่านของคุณ"
                />
              ) : (
                <TextField
                  label="รหัสผ่าน"
                  name="password"
                  id="auth-password"
                  type="password"
                  max={200}
                  minLength={undefined}
                  autoComplete="current-password"
                  placeholder="รหัสผ่านของคุณ"
                />
              )}
              {register && <TextField label="ยืนยันรหัสผ่าน" name="password_confirm" type="password" max={200} matches="password" />}
              {creating && (
                <>
                  <TextField
                    label="ชื่อองค์กร"
                    name="organization"
                    defaultValue={setup ? 'Bookdose' : ''}
                    placeholder="ชื่อบริษัทหรือองค์กรของคุณ"
                    max={100}
                  />
                  <SlugField defaultValue={setup ? 'bookdose' : ''} />
                </>
              )}
              {setup && boot.setup_token_required && (
                <TextField label="รหัสตั้งค่าระบบจากผู้ดูแลโฮสต์" name="setup_token" type="password" max={200} />
              )}
              {setup && (
                <label className="check">
                  <input name="demo" type="checkbox" defaultChecked />
                  เพิ่มเคสตัวอย่าง 5 เคสและคู่มือ เพื่อทดลองใช้งาน
                </label>
              )}
              <button className="btn primary" type="submit">
                {register ? 'สมัครและส่งอีเมลยืนยัน' : setup ? 'สร้างพื้นที่ทำงาน' : 'เข้าสู่ระบบ'} <Icon name="arrow" />
              </button>
              <div className="auth-foot">
                <Icon name="lock" />{' '}
                {register
                  ? 'ยืนยันอีเมลก่อนเข้าใช้งาน คุณจะเป็นผู้ดูแลเฉพาะองค์กรที่สร้าง'
                  : setup
                    ? 'คุณจะเป็นผู้ดูแลแพลตฟอร์มและผู้ดูแลองค์กรแรก'
                    : 'ข้อมูลแต่ละองค์กรแยกพื้นที่จัดเก็บอย่างอิสระ'}
              </div>
              {!setup && (
                <>
                  <button className="btn subtle" type="button" onClick={openForgot}>
                    ลืมรหัสผ่าน?
                  </button>
                  {register && (
                    <p className="small">
                      <Link href="/resend-email">ยังไม่ได้รับอีเมลยืนยัน? ขอลิงก์ใหม่</Link>
                    </p>
                  )}
                  <p className="small">
                    {register ? (
                      <>
                        มีบัญชีแล้ว? <Link href="/login">เข้าสู่ระบบ</Link>
                      </>
                    ) : (
                      <>
                        ต้องการเปิดระบบนี้ให้องค์กรของคุณ? <Link href="/register">สมัครองค์กรใหม่</Link>
                      </>
                    )}
                  </p>
                  {register && <p className="tiny muted">หากเข้าร่วมองค์กรที่มีอยู่แล้ว ให้ติดต่อผู้ดูแลองค์กรเพื่อเพิ่มสมาชิก</p>}
                </>
              )}
            </Form>
          )}
        </div>
      </section>
    </main>
  );
}
