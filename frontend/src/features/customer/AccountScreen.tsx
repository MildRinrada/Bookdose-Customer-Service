'use client';

import { useEffect } from 'react';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/ui/display';
import { TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { PrivacyNotice } from '@/features/auth/components/PrivacyNotice';
import type { PublicOrgInfo } from '@/features/auth/types';
import { useCustomer, useCustomerAccount, useCustomerLogout, useCustomerOrgs } from '@/lib/customer-session';
import { date } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { useBoot } from '@/lib/session';
import { ACCOUNT_PATH, changePassword, publicInfoPath, saveNotifications, saveProfile } from './api';
import { JoinOrgInline } from './components/JoinOrg';
import { useOrgs } from './hooks';

/* ตั้งค่าบัญชี: the details teams use to reach the customer, the organizations they can contact, the password,
   notifications and what they agreed to (pages/customer/customer-account.html). */

export function AccountScreen() {
  const me = useCustomer();
  const account = useCustomerAccount();
  const orgsQuery = useCustomerOrgs();
  const orgs = useOrgs();
  const home = useBoot().data?.home;
  // Whether the platform can send email (for the hint under an unconfirmed address); assume it can until known.
  const info = useApi<PublicOrgInfo>(home ? publicInfoPath(home.slug) : null);
  const mailReady = info.data?.email_verification ?? true;
  const refresh = useInvalidate();
  const toast = useToast();
  const logout = useCustomerLogout();

  // The page shows the account as it is now (the old page asked again on opening).
  const { refetch: refetchAccount } = account;
  const { refetch: refetchOrgs } = orgsQuery;
  useEffect(() => {
    void refetchAccount();
    void refetchOrgs();
  }, [refetchAccount, refetchOrgs]);

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>ตั้งค่าบัญชี</h1>
          <p>บัญชีเดียวใช้กับทุกองค์กร ข้อมูลที่ทีมงานใช้ติดต่อคุณ องค์กรที่ติดต่อได้ และความปลอดภัยของบัญชี</p>
        </div>
      </div>
      <div className="customer-settings">
        <section className="card">
          <div className="card-header">
            <div>
              <h2>ข้อมูลส่วนตัว</h2>
              <p>ชื่อที่ทีมงานใช้เรียก และเบอร์สำหรับติดต่อกลับ</p>
            </div>
          </div>
          <Form
            key={`${me.name}|${me.phone}`}
            className="card-body"
            data-form="customer-profile"
            onSubmit={async (values) => {
              await saveProfile({ name: values.name ?? '', phone: values.phone || '' });
              toast('บันทึกข้อมูลแล้ว');
              await refresh(ACCOUNT_PATH);
            }}
          >
            <div className="field">
              <span className="file-field-title">อีเมลที่ใช้เข้าสู่ระบบ</span>
              <div className="customer-email">
                <strong>{me.email}</strong>
                {me.email_verified ? (
                  <span className="badge resolved">
                    <Icon name="check" />
                    ยืนยันแล้ว
                  </span>
                ) : (
                  <span className="badge pending_customer">ยังไม่ยืนยัน</span>
                )}
              </div>
              {!me.email_verified && (
                <p className="tiny muted">
                  {mailReady
                    ? 'ยืนยันอีเมลได้โดยออกจากระบบ กด “ลืมรหัสผ่าน” แล้วตั้งรหัสผ่านใหม่จากลิงก์ในอีเมล'
                    : 'ระบบยังส่งอีเมลไม่ได้ ใช้งานได้ตามปกติ แต่จะยังไม่ได้รับอีเมลแจ้งเมื่อทีมงานตอบ'}
                </p>
              )}
            </div>
            <TextField label="ชื่อ-นามสกุล หรือชื่อที่ต้องการให้เรียก" name="name" defaultValue={me.name} max={100} personName />
            <TextField label="เบอร์โทรศัพท์ (ไม่บังคับ)" name="phone" type="tel" defaultValue={me.phone} max={20} required={false} placeholder="เช่น 081-234-5678" />
            <button className="btn primary" type="submit">
              <Icon name="check" />
              บันทึกข้อมูล
            </button>
          </Form>
        </section>
        <section className="card">
          <div className="card-header">
            <div>
              <h2>องค์กรที่ติดต่อได้</h2>
              <p>เพิ่มองค์กรด้วยรหัสในลิงก์ขององค์กรนั้น เช่น …/?org=my-company</p>
            </div>
          </div>
          <div className="card-body">
            <ul className="customer-org-list">
              {orgs.map((o) => (
                <li key={o.slug}>
                  <Avatar name={o.name} index={o.home ? 1 : 3} />
                  <span className="grow">
                    <strong>{o.name}</strong>
                    <span className="muted">{o.home ? 'ผู้ให้บริการระบบ · ติดต่อเรื่องปัญหาระบบได้เสมอ' : 'องค์กรคู่ค้า'}</span>
                  </span>
                  {o.home && <span className="badge resolved">ผู้ให้บริการระบบ</span>}
                </li>
              ))}
            </ul>
            <JoinOrgInline />
          </div>
        </section>
        <section className="card">
          <div className="card-header">
            <div>
              <h2>เปลี่ยนรหัสผ่าน</h2>
              <p>เมื่อเปลี่ยนแล้ว อุปกรณ์อื่นที่เข้าสู่ระบบไว้จะออกจากระบบ</p>
            </div>
          </div>
          <Form
            className="card-body"
            data-form="customer-password"
            onSubmit={async (values, form) => {
              if (values.password !== values.password_confirm) throw new Error('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
              await changePassword({ current_password: values.current_password ?? '', password: values.password ?? '' });
              form.reset();
              toast('เปลี่ยนรหัสผ่านแล้ว อุปกรณ์อื่นออกจากระบบแล้ว');
            }}
          >
            <TextField label="รหัสผ่านปัจจุบัน" name="current_password" type="password" max={200} />
            <TextField label="รหัสผ่านใหม่ (อย่างน้อย 10 ตัวอักษร)" name="password" type="password" max={200} />
            <TextField label="พิมพ์รหัสผ่านใหม่อีกครั้ง" name="password_confirm" type="password" max={200} matches="password" />
            <button className="btn" type="submit">
              <Icon name="lock" />
              เปลี่ยนรหัสผ่าน
            </button>
          </Form>
        </section>
        <section className="card">
          <div className="card-header">
            <div>
              <h2>การแจ้งเตือน</h2>
              <p>การแจ้งเตือนในหน้าเว็บ (กระดิ่ง) แสดงเสมอ เลือกได้ว่าจะรับทางอีเมลด้วยหรือไม่</p>
            </div>
          </div>
          <Form
            key={String(me.notify_email)}
            className="card-body"
            data-form="customer-notifications"
            onSubmit={async (_values, form) => {
              const box = form.elements.namedItem('email') as HTMLInputElement | null;
              await saveNotifications(Boolean(box?.checked));
              toast('บันทึกการแจ้งเตือนแล้ว');
              await refresh(ACCOUNT_PATH);
            }}
          >
            <label className="check">
              <input type="checkbox" name="email" defaultChecked={me.notify_email} />
              <span>ส่งอีเมลแจ้งเมื่อทีมงานตอบกลับในแชท (อีเมลไม่มีเนื้อหาข้อความ มีแค่ลิงก์ให้เข้ามาอ่าน)</span>
            </label>
            {!me.email_verified && <p className="tiny muted">ต้องยืนยันอีเมลก่อนจึงจะได้รับอีเมลแจ้งเตือน</p>}
            <button className="btn" type="submit">
              <Icon name="check" />
              บันทึกการแจ้งเตือน
            </button>
          </Form>
        </section>
        <section className="card">
          <div className="card-header">
            <div>
              <h2>ความเป็นส่วนตัว</h2>
              <p>สิ่งที่คุณยินยอมไว้ตอนสมัครสมาชิก</p>
            </div>
          </div>
          <div className="card-body">
            <p className="customer-consent">
              <Icon name="checkCircle" />
              <span>
                ยอมรับประกาศความเป็นส่วนตัว ฉบับ {me.consent_version} เมื่อ {date(me.consent_at, true)}
              </span>
            </p>
            <details className="customer-privacy">
              <summary>อ่านประกาศความเป็นส่วนตัว</summary>
              <PrivacyNotice organization={home?.name || 'องค์กร'} />
            </details>
          </div>
        </section>
        <section className="card">
          <div className="card-header">
            <div>
              <h2>ออกจากระบบ</h2>
              <p>สมาชิกตั้งแต่ {date(me.created_at)}</p>
            </div>
          </div>
          <div className="card-body">
            <button
              className="btn danger"
              type="button"
              onClick={() =>
                void logout()
                  .then(() => toast('ออกจากระบบแล้ว'))
                  .catch((error: Error) => toast(error.message, true))
              }
            >
              <Icon name="logout" />
              ออกจากระบบบนอุปกรณ์นี้
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
