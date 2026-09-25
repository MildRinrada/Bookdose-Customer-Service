'use client';

import { useEffect } from 'react';
import { Icon } from '@/components/Icon';
import { PhotoPicker } from '@/components/ui/PhotoPicker';
import { TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { PrivacyNotice } from '@/features/auth/components/PrivacyNotice';
import type { PublicOrgInfo } from '@/features/auth/types';
import { useCustomer, useCustomerAccount, useCustomerLogout } from '@/lib/customer-session';
import { date } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { useBoot } from '@/lib/session';
import { ACCOUNT_PATH, publicInfoPath, saveProfile } from '../api';

/* ตั้งค่าบัญชี → ข้อมูลส่วนตัว: the name and phone teams use to reach the customer, what they agreed to, and
   signing out (pages/customer/customer-account.html). */

export function ProfileSettings() {
  const me = useCustomer();
  const account = useCustomerAccount();
  const home = useBoot().data?.home;
  // Whether the platform can send email (for the hint under an unconfirmed address); assume it can until known.
  const info = useApi<PublicOrgInfo>(home ? publicInfoPath(home.slug) : null);
  const mailReady = info.data?.email_verification ?? true;
  const refresh = useInvalidate();
  const toast = useToast();
  const logout = useCustomerLogout();

  // The page shows the account as it is now (the old page asked again on opening).
  const { refetch: refetchAccount } = account;
  useEffect(() => {
    void refetchAccount();
  }, [refetchAccount]);

  return (
    <div className="account-section">
      <section className="card">
        <div className="card-header">
          <div>
            <h2>ข้อมูลส่วนตัว</h2>
            <p>รูปและชื่อที่ทีมงานเห็น และเบอร์สำหรับติดต่อกลับ</p>
          </div>
        </div>
        <Form
          key={`${me.name}|${me.phone}|${(me.avatar ?? '').length}`}
          className="card-body"
          data-form="customer-profile"
          onSubmit={async (values) => {
            await saveProfile({ name: values.name ?? '', phone: values.phone || '', avatar: values.avatar || '' });
            toast('บันทึกข้อมูลแล้ว');
            await refresh(ACCOUNT_PATH);
          }}
        >
          <PhotoPicker value={me.avatar ?? ''} personName={me.name} />
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
  );
}
