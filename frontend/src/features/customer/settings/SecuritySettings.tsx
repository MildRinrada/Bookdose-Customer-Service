'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { EmptyState } from '@/components/ui/display';
import { TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { PasskeysCard, TwoFactorCard, type SecurityState } from '@/features/account-security/cards';
import { date } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { changePassword } from '../api';
import type { ActivityPage, CustomerSession } from './security';
import { SECURITY_PATH, SESSIONS_PATH, activityPath, customerSecurityApi, revokeSession, signOutEverywhere } from './security';

/* ตั้งค่าบัญชี → ความปลอดภัย: the password, two-factor sign-in with an authenticator app and recovery codes,
   passkeys, the browsers signed in to the account, and its history (backend customer_security).
   Markup: pages/security.css. */

export function SecuritySettings() {
  const state = useApi<SecurityState>(SECURITY_PATH);
  return (
    <div className="account-section">
      <PasswordCard />
      <TwoFactorCard state={state.data} api={customerSecurityApi} />
      <PasskeysCard passkeys={state.data?.passkeys ?? []} api={customerSecurityApi} />
      <SessionsCard />
      <ActivityCard />
    </div>
  );
}

function PasswordCard() {
  const toast = useToast();
  return (
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
  );
}

/* The browsers signed in to this account. */
function SessionsCard() {
  const sessions = useApi<{ sessions: CustomerSession[] }>(SESSIONS_PATH);
  const refresh = useInvalidate();
  const toast = useToast();
  const { confirm } = useDialogs();
  const rows = sessions.data?.sessions ?? [];

  const signOutAll = (keepCurrent: boolean) =>
    confirm({
      title: keepCurrent ? 'ออกจากระบบอุปกรณ์อื่นทั้งหมด' : 'ออกจากระบบทุกอุปกรณ์',
      message: keepCurrent
        ? 'อุปกรณ์อื่นทุกเครื่องจะต้องเข้าสู่ระบบใหม่ เครื่องนี้ยังใช้งานต่อได้'
        : 'ทุกเครื่องรวมถึงเครื่องนี้จะออกจากระบบ และต้องเข้าสู่ระบบใหม่',
      confirmLabel: 'ออกจากระบบ',
      tone: 'danger',
      run: async () => {
        await signOutEverywhere(keepCurrent);
        toast(keepCurrent ? 'ออกจากระบบอุปกรณ์อื่นแล้ว' : 'ออกจากระบบทุกอุปกรณ์แล้ว');
        await refresh('/api/customer');
      },
    });

  return (
    <section className="card security-card">
      <div className="card-header">
        <div>
          <h2>อุปกรณ์ที่เข้าสู่ระบบ</h2>
          <p>ถ้าเห็นอุปกรณ์ที่ไม่ใช่ของคุณ ให้กดออกจากระบบแล้วเปลี่ยนรหัสผ่าน</p>
        </div>
      </div>
      <div className="card-body">
        <ul className="security-list">
          {rows.map((row) => (
            <li key={row.id}>
              <span className="security-list-icon">
                <Icon name="sidebar" />
              </span>
              <span className="grow">
                <strong>
                  {row.device}
                  {row.current && <span className="badge resolved">เครื่องนี้</span>}
                </strong>
                <span className="muted">
                  {row.ip} · เข้าสู่ระบบ {date(row.created_at, true)} · ใช้งานล่าสุด {date(row.last_seen_at, true)}
                </span>
              </span>
              {!row.current && (
                <button
                  className="btn sm"
                  type="button"
                  onClick={() =>
                    void revokeSession(row.id)
                      .then(() => refresh(SESSIONS_PATH))
                      .then(() => toast('ออกจากระบบอุปกรณ์นั้นแล้ว'))
                  }
                >
                  <Icon name="logout" />
                  ออกจากระบบ
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="security-actions">
          <button className="btn" type="button" onClick={() => signOutAll(true)}>
            ออกจากระบบอุปกรณ์อื่นทั้งหมด
          </button>
          <button className="btn danger" type="button" onClick={() => signOutAll(false)}>
            ออกจากระบบทุกอุปกรณ์
          </button>
        </div>
      </div>
    </section>
  );
}

/* Everything that happened to the account, plus what it signed and approved in each organization. */
function ActivityCard() {
  const [page, setPage] = useState(0);
  const history = useApi<ActivityPage>(activityPath(page), { keepPrevious: true });
  const items = history.data?.items ?? [];
  return (
    <section className="card security-card">
      <div className="card-header">
        <div>
          <h2>ประวัติการใช้งานบัญชี</h2>
          <p>การเข้าสู่ระบบ การเปลี่ยนการตั้งค่าความปลอดภัย และเอกสารที่คุณลงนามหรืออนุมัติ</p>
        </div>
      </div>
      <div className="card-body">
        {items.length === 0 ? (
          <EmptyState icon="clock" title="ยังไม่มีประวัติ" description="เมื่อมีการเข้าสู่ระบบหรือเปลี่ยนการตั้งค่า รายการจะแสดงที่นี่" />
        ) : (
          <div className="table-wrap">
            <table className="activity-table">
              <thead>
                <tr>
                  <th>เมื่อ</th>
                  <th>รายการ</th>
                  <th>รายละเอียด</th>
                  <th>อุปกรณ์ / IP</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={`${item.at}-${index}`}>
                    <td>{date(item.at, true)}</td>
                    <td>
                      <strong>{item.label}</strong>
                      {item.org_name && <span className="muted"> · {item.org_name}</span>}
                    </td>
                    <td>{item.detail || '—'}</td>
                    <td className="muted">
                      {item.device || '—'}
                      {item.ip ? ` · ${item.ip}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="security-actions">
          <button className="btn sm" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
            ‹ ก่อนหน้า
          </button>
          <button className="btn sm" type="button" disabled={!history.data?.has_more} onClick={() => setPage(page + 1)}>
            ถัดไป ›
          </button>
        </div>
      </div>
    </section>
  );
}
