'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useCopyText } from '@/components/ui/actions';
import { useDialogs } from '@/components/ui/Dialogs';
import { EmptyState } from '@/components/ui/display';
import { TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { createPasskey, usePasskeysAvailable } from '@/features/auth/passkeys';
import { date } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { changePassword } from '../api';
import type { ActivityPage, CustomerSession, Passkey, SecurityState, TotpSetup } from './security';
import {
  SECURITY_PATH,
  SESSIONS_PATH,
  activityPath,
  addPasskey,
  confirmTotp,
  disableTotp,
  newRecoveryCodes,
  passkeyOptions,
  removePasskey,
  renamePasskey,
  revokeSession,
  signOutEverywhere,
  startTotp,
} from './security';

/* ตั้งค่าบัญชี → ความปลอดภัย: the password, two-factor sign-in with an authenticator app and recovery codes,
   passkeys, the browsers signed in to the account, and its history (backend customer_security).
   Markup: pages/security.css. */

export function SecuritySettings() {
  const state = useApi<SecurityState>(SECURITY_PATH);
  return (
    <div className="account-section">
      <PasswordCard />
      <TwoFactorCard state={state.data} />
      <PasskeysCard passkeys={state.data?.passkeys ?? []} />
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

/* Two-factor sign-in: set up, confirm, the ten recovery codes, and turning it off again. */
function TwoFactorCard({ state }: { state: SecurityState | undefined }) {
  const refresh = useInvalidate();
  const toast = useToast();
  const { openModal, closeModal } = useDialogs();
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const on = Boolean(state?.two_factor.enabled);

  const ask = (title: string, label: string, run: (values: Record<string, string>) => Promise<void>) =>
    openModal(
      title,
      <Form
        className="dialog-form"
        onSubmit={async (values) => {
          await run(values);
          closeModal(true);
        }}
      >
        <TextField label="รหัสผ่านของบัญชี" name="password" type="password" max={200} minLength={undefined} autoComplete="current-password" />
        {label === 'code' && <TextField label="รหัส 6 หลักจากแอป" name="code" max={10} inputMode="numeric" autoComplete="one-time-code" />}
        <button className="btn primary" type="submit">
          ยืนยัน
        </button>
      </Form>,
    );

  return (
    <section className="card security-card">
      <div className="card-header">
        <div>
          <h2>การยืนยันสองขั้นตอน</h2>
          <p>ให้แอปยืนยันตัวตนสร้างรหัส 6 หลักเพิ่มอีกชั้นหนึ่งตอนเข้าสู่ระบบ</p>
        </div>
        <span className={`badge ${on ? 'resolved' : 'muted'}`}>{on ? 'เปิดใช้งาน' : 'ยังไม่เปิด'}</span>
      </div>
      <div className="card-body">
        {codes && <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />}
        {on ? (
          <>
            <p className="small muted">
              เปิดใช้งานเมื่อ {date(state?.two_factor.confirmed_at, true)} · เหลือรหัสสำรอง {state?.recovery.left ?? 0} จาก{' '}
              {state?.recovery.total ?? 0} รหัส
            </p>
            <div className="security-actions">
              <button
                className="btn"
                type="button"
                onClick={() =>
                  ask('สร้างรหัสสำรองชุดใหม่', 'password', async (values) => {
                    setCodes((await newRecoveryCodes(values.password)).recovery_codes);
                    await refresh(SECURITY_PATH);
                    toast('สร้างรหัสสำรองชุดใหม่แล้ว รหัสชุดเดิมใช้ไม่ได้อีก');
                  })
                }
              >
                <Icon name="restore" />
                สร้างรหัสสำรองชุดใหม่
              </button>
              <button
                className="btn danger"
                type="button"
                onClick={() =>
                  ask('ปิดการยืนยันสองขั้นตอน', 'code', async (values) => {
                    await disableTotp({ password: values.password, code: values.code });
                    await refresh(SECURITY_PATH);
                    toast('ปิดการยืนยันสองขั้นตอนแล้ว');
                  })
                }
              >
                <Icon name="close" />
                ปิดการยืนยันสองขั้นตอน
              </button>
            </div>
          </>
        ) : setup ? (
          <TotpSetupSteps
            setup={setup}
            onDone={async (given) => {
              setSetup(null);
              setCodes(given);
              await refresh(SECURITY_PATH);
              toast('เปิดการยืนยันสองขั้นตอนแล้ว');
            }}
            onCancel={() => setSetup(null)}
          />
        ) : (
          <div className="security-actions">
            {/* Turning it on asks for the password first: it decides how the owner gets back in. */}
            <button
              className="btn primary"
              type="button"
              onClick={() =>
                ask('เปิดการยืนยันสองขั้นตอน', 'password', async (values) => {
                  setCodes(null);
                  setSetup(await startTotp(values.password ?? ''));
                })
              }
            >
              <Icon name="shield" />
              เปิดการยืนยันสองขั้นตอน
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function TotpSetupSteps({ setup, onDone, onCancel }: { setup: TotpSetup; onDone: (codes: string[]) => void; onCancel: () => void }) {
  const copy = useCopyText();
  return (
    <div className="totp-setup">
      <ol className="totp-steps">
        <li>เปิดแอปยืนยันตัวตน เช่น Google Authenticator, Microsoft Authenticator หรือ 1Password</li>
        <li>สแกน QR ด้านล่าง หรือกรอกรหัสลับด้วยตนเอง</li>
        <li>กรอกตัวเลข 6 หลักที่แอปแสดง เพื่อยืนยันว่าตรงกัน</li>
      </ol>
      <div className="totp-pair">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {setup.qr && <img className="totp-qr" src={setup.qr} alt="QR สำหรับแอปยืนยันตัวตน" width={200} height={200} />}
        <div className="totp-secret">
          <span className="tiny muted">รหัสลับสำหรับกรอกเอง</span>
          <code>{setup.secret}</code>
          <button className="btn sm" type="button" onClick={() => void copy(setup.secret)}>
            <Icon name="code" />
            คัดลอกรหัสลับ
          </button>
        </div>
      </div>
      <Form
        data-form="customer-totp-confirm"
        onSubmit={async (values) => {
          onDone((await confirmTotp(values.code ?? '')).recovery_codes);
        }}
      >
        <TextField label="รหัส 6 หลักจากแอป" name="code" max={10} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" />
        <div className="security-actions">
          <button className="btn primary" type="submit">
            <Icon name="check" />
            ยืนยันและเปิดใช้งาน
          </button>
          <button className="btn subtle" type="button" onClick={onCancel}>
            ยกเลิก
          </button>
        </div>
      </Form>
    </div>
  );
}

/** The ten codes, shown once. Copying or printing them is the only way to keep them. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const copy = useCopyText();
  return (
    <div className="recovery-codes" role="alert">
      <h3>
        <Icon name="lock" />
        เก็บรหัสสำรอง 10 รหัสนี้ไว้
      </h3>
      <p>ใช้แทนรหัสจากแอปได้เมื่อทำโทรศัพท์หาย รหัสแต่ละรหัสใช้ได้ครั้งเดียว และจะไม่แสดงอีก</p>
      <ul>
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>
      <div className="security-actions">
        <button className="btn" type="button" onClick={() => void copy(codes.join('\n'))}>
          <Icon name="code" />
          คัดลอกทั้งหมด
        </button>
        <button className="btn" type="button" onClick={() => window.print()}>
          <Icon name="file" />
          พิมพ์หน้านี้
        </button>
        <button className="btn subtle" type="button" onClick={onDone}>
          เก็บไว้เรียบร้อยแล้ว
        </button>
      </div>
    </div>
  );
}

/* Passkeys: add one with the device's own unlock, rename it, or remove it with the account's password. */
function PasskeysCard({ passkeys }: { passkeys: Passkey[] }) {
  const refresh = useInvalidate();
  const toast = useToast();
  const { openModal, closeModal } = useDialogs();
  // Only the browser knows whether it can make passkeys; the server renders the page without the buttons.
  const available = usePasskeysAvailable();

  const add = () =>
    openModal(
      'เพิ่ม Passkey',
      <Form
        className="dialog-form"
        onSubmit={async (values) => {
          const options = await passkeyOptions(values.password ?? '');
          await addPasskey(values.name ?? '', await createPasskey(options));
          closeModal(true);
          await refresh(SECURITY_PATH);
          toast('เพิ่ม Passkey แล้ว ครั้งต่อไปเข้าสู่ระบบได้โดยไม่ต้องใช้รหัสผ่าน');
        }}
      >
        <p>ระบบจะขอให้ปลดล็อกอุปกรณ์นี้ด้วยลายนิ้วมือ ใบหน้า หรือ PIN แล้วเก็บกุญแจไว้ในอุปกรณ์เอง</p>
        <p className="small muted">Passkey ใช้เข้าสู่ระบบแทนรหัสผ่านและรหัสยืนยันได้ จึงต้องกรอกรหัสผ่านของบัญชีก่อนเพิ่ม</p>
        <TextField label="รหัสผ่านของบัญชี" name="password" type="password" max={200} minLength={undefined} autoComplete="current-password" />
        <TextField label="ชื่อที่จะใช้เรียกอุปกรณ์นี้ (ไม่บังคับ)" name="name" max={60} required={false} placeholder="เช่น โน้ตบุ๊กที่ทำงาน" />
        <button className="btn primary" type="submit">
          <Icon name="shield" />
          สร้าง Passkey
        </button>
      </Form>,
    );

  const rename = (passkey: Passkey) =>
    openModal(
      'เปลี่ยนชื่อ Passkey',
      <Form
        className="dialog-form"
        onSubmit={async (values) => {
          await renamePasskey(passkey.id, values.name ?? '');
          closeModal(true);
          await refresh(SECURITY_PATH);
        }}
      >
        <TextField label="ชื่ออุปกรณ์" name="name" max={60} defaultValue={passkey.name} />
        <button className="btn primary" type="submit">
          บันทึก
        </button>
      </Form>,
    );

  const remove = (passkey: Passkey) =>
    openModal(
      `ลบ Passkey “${passkey.name}”`,
      <Form
        className="dialog-form"
        onSubmit={async (values) => {
          await removePasskey(passkey.id, values.password ?? '');
          closeModal(true);
          await refresh(SECURITY_PATH);
          toast('ลบ Passkey แล้ว');
        }}
      >
        <p>อุปกรณ์นี้จะเข้าสู่ระบบด้วย Passkey ไม่ได้อีก กรอกรหัสผ่านของบัญชีเพื่อยืนยันว่าเป็นคุณ</p>
        <TextField label="รหัสผ่านของบัญชี" name="password" type="password" max={200} minLength={undefined} autoComplete="current-password" />
        <button className="btn danger" type="submit">
          ลบ Passkey
        </button>
      </Form>,
    );

  return (
    <section className="card security-card">
      <div className="card-header">
        <div>
          <h2>Passkey</h2>
          <p>เข้าสู่ระบบด้วยลายนิ้วมือ ใบหน้า หรือ PIN ของอุปกรณ์ แทนรหัสผ่านและรหัสยืนยัน</p>
        </div>
        {available && (
          <button className="btn primary" type="button" onClick={add}>
            <Icon name="plus" />
            เพิ่ม Passkey
          </button>
        )}
      </div>
      <div className="card-body">
        {!available && <p className="notice">เบราว์เซอร์นี้ยังไม่รองรับ Passkey กรุณาใช้เบราว์เซอร์รุ่นใหม่บนอุปกรณ์ที่ตั้งรหัสปลดล็อกไว้</p>}
        {passkeys.length === 0 ? (
          <EmptyState icon="shield" title="ยังไม่มี Passkey" description="เพิ่ม Passkey ไว้ในอุปกรณ์ที่คุณใช้ประจำ แล้วเข้าสู่ระบบได้ในคลิกเดียว" />
        ) : (
          <ul className="security-list">
            {passkeys.map((passkey) => (
              <li key={passkey.id}>
                <span className="security-list-icon">
                  <Icon name="shield" />
                </span>
                <span className="grow">
                  <strong>{passkey.name}</strong>
                  <span className="muted">
                    เพิ่มเมื่อ {date(passkey.created_at)} ·{' '}
                    {passkey.last_used_at ? `ใช้ล่าสุด ${date(passkey.last_used_at, true)}` : 'ยังไม่เคยใช้'}
                  </span>
                </span>
                <button className="btn sm" type="button" onClick={() => rename(passkey)}>
                  <Icon name="edit" />
                  เปลี่ยนชื่อ
                </button>
                <button className="btn sm danger" type="button" onClick={() => remove(passkey)}>
                  <Icon name="trash" />
                  ลบ
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
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
