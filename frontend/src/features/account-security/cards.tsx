'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useCopyText } from '@/components/ui/actions';
import { useDialogs } from '@/components/ui/Dialogs';
import { EmptyState } from '@/components/ui/display';
import { TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { createPasskey, usePasskeysAvailable, type PasskeyAnswer, type PasskeyCreateOptions } from '@/features/auth/passkeys';
import { date } from '@/lib/format';
import { useInvalidate } from '@/lib/query';

/* The two-factor sign-in and passkey cards of an account's security settings, shared by a customer's account
   (ตั้งค่าบัญชี → ความปลอดภัย, backend customer_security) and a staff account (ความปลอดภัยของบัญชี, backend
   staff_security): the same rules, each with its own endpoints (`api`). Markup: pages/security.css. */

/** GET <path>: whether two-factor sign-in is on, the recovery codes left, and the passkeys. */
export type SecurityState = {
  two_factor: { enabled: boolean; pending: boolean; confirmed_at: string | null };
  recovery: { left: number; total: number };
  passkeys: Passkey[];
};

export type Passkey = { id: string; name: string; created_at: string; last_used_at: string | null; alg: number };

/** POST .../totp/setup: the secret to type by hand, its otpauth link and the QR as a data: URL. */
export type TotpSetup = { secret: string; otpauth_uri: string; qr: string };

export type RecoveryCodes = { ok: true; recovery_codes: string[] };

/** The endpoints of one kind of account. Turning the second step on, and adding a passkey, cost the password. */
export type SecurityApi = {
  path: string;
  startTotp: (password: string) => Promise<TotpSetup>;
  confirmTotp: (code: string) => Promise<RecoveryCodes>;
  disableTotp: (body: { password: string; code?: string; recovery_code?: string }) => Promise<unknown>;
  newRecoveryCodes: (password: string) => Promise<RecoveryCodes>;
  passkeyOptions: (password: string) => Promise<PasskeyCreateOptions>;
  addPasskey: (name: string, credential: PasskeyAnswer) => Promise<unknown>;
  renamePasskey: (id: string, name: string) => Promise<unknown>;
  removePasskey: (id: string, password: string) => Promise<unknown>;
};

/* Two-factor sign-in: set up, confirm, the ten recovery codes, and turning it off again. */
export function TwoFactorCard({ state, api }: { state: SecurityState | undefined; api: SecurityApi }) {
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
                    setCodes((await api.newRecoveryCodes(values.password)).recovery_codes);
                    await refresh(api.path);
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
                    await api.disableTotp({ password: values.password, code: values.code });
                    await refresh(api.path);
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
            api={api}
            onDone={async (given) => {
              setSetup(null);
              setCodes(given);
              await refresh(api.path);
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
                  setSetup(await api.startTotp(values.password ?? ''));
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

function TotpSetupSteps({
  setup,
  api,
  onDone,
  onCancel,
}: {
  setup: TotpSetup;
  api: SecurityApi;
  onDone: (codes: string[]) => void;
  onCancel: () => void;
}) {
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
        data-form="totp-confirm"
        onSubmit={async (values) => {
          onDone((await api.confirmTotp(values.code ?? '')).recovery_codes);
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
export function PasskeysCard({ passkeys, api }: { passkeys: Passkey[]; api: SecurityApi }) {
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
          const options = await api.passkeyOptions(values.password ?? '');
          await api.addPasskey(values.name ?? '', await createPasskey(options));
          closeModal(true);
          await refresh(api.path);
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
          await api.renamePasskey(passkey.id, values.name ?? '');
          closeModal(true);
          await refresh(api.path);
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
          await api.removePasskey(passkey.id, values.password ?? '');
          closeModal(true);
          await refresh(api.path);
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

