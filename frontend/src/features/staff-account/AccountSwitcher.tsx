'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { Avatar, ProfilePhoto } from '@/components/ui/display';
import { TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { TwoFactorStep } from '@/features/auth/components/TwoFactorStep';
import { api } from '@/lib/api/client';
import { useApi } from '@/lib/query';

/* The account switcher in the avatar menu, like Google's: the account in use on top, the other staff accounts signed
   in on this browser below (one click moves to one, the cross signs just that one out), "เพิ่มบัญชีอื่น" (its email
   and password, and the code from its authenticator app when it asks for one), then signing this account - or every
   account - out. Each account sees in ตั้งค่าบัญชี → ความปลอดภัย who shares the browser with it.
   Moving between accounts reloads the page, so nothing of one account stays on screen for the other.
   Endpoints: auth/routes.py (/api/accounts...). Markup: layout.css (account-switcher). */

export const ACCOUNTS_PATH = '/api/accounts';

export type BrowserAccount = {
  id: string;
  name: string;
  email: string;
  avatar: string;
  platform_admin: boolean;
  active: boolean;
  signed_in_at: string;
  last_active_at: string;
};

type Accounts = { accounts: BrowserAccount[]; max: number };

/** A fresh start as the account now in the cookie: a full load, so no screen or cache of the previous one is kept. */
export function reloadAsAccount(path = '/dashboard') {
  window.location.assign(path);
}

function AccountPhoto({ account }: { account: Pick<BrowserAccount, 'avatar' | 'name'> }) {
  return account.avatar ? <ProfilePhoto src={account.avatar} alt={`รูปของ ${account.name}`} /> : <Avatar name={account.name} index={2} />;
}

export function AccountSwitcher({ roleLabel, onLogout }: { roleLabel: string; onLogout: () => Promise<void> }) {
  const found = useApi<Accounts>(ACCOUNTS_PATH).data;
  const toast = useToast();
  const { openModal, confirm } = useDialogs();
  const [busy, setBusy] = useState<string | null>(null);
  const accounts = found?.accounts ?? [];
  const current = accounts.find((a) => a.active);
  const others = accounts.filter((a) => !a.active);
  const full = found ? accounts.length >= found.max : false;

  const run = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await work();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
      setBusy(null);
    }
  };

  const switchTo = (account: BrowserAccount) =>
    run(account.id, async () => {
      await api(`${ACCOUNTS_PATH}/switch`, { id: account.id });
      reloadAsAccount();
    });

  const signOutOther = (account: BrowserAccount) =>
    run(`out:${account.id}`, async () => {
      await api(`${ACCOUNTS_PATH}/${account.id}/sign-out`, {});
      toast(`ออกจากระบบ ${account.email} แล้ว`);
      reloadAsAccount(window.location.pathname);
    });

  const signOutAll = () =>
    confirm({
      title: 'ออกจากระบบทุกบัญชี',
      message: `ทุกบัญชีที่เข้าสู่ระบบในเบราว์เซอร์นี้ (${accounts.length} บัญชี) จะออกจากระบบ`,
      confirmLabel: 'ออกจากระบบทุกบัญชี',
      tone: 'danger',
      run: async () => {
        await api(`${ACCOUNTS_PATH}/sign-out-all`, {});
        reloadAsAccount('/login');
      },
    });

  return (
    <div className="account-switcher">
      {current && (
        <div className="account-current">
          <AccountPhoto account={current} />
          <div className="account-who">
            <strong className="truncate">{current.name}</strong>
            <span className="truncate">{current.email}</span>
            <span className="account-role">{roleLabel}</span>
          </div>
        </div>
      )}
      {others.length > 0 && (
        <ul className="account-list" aria-label="บัญชีอื่นในเบราว์เซอร์นี้">
          {others.map((a) => (
            <li key={a.id}>
              <button type="button" className="account-row" disabled={busy !== null} onClick={() => void switchTo(a)} title={`สลับไปใช้ ${a.email}`}>
                <AccountPhoto account={a} />
                <span className="account-who">
                  <strong className="truncate">{a.name}</strong>
                  <span className="truncate">{a.email}</span>
                </span>
                {busy === a.id && <span className="account-busy">กำลังสลับ…</span>}
              </button>
              <button
                type="button"
                className="icon-btn account-out"
                aria-label={`ออกจากระบบ ${a.email}`}
                title="ออกจากระบบบัญชีนี้"
                disabled={busy !== null}
                onClick={() => void signOutOther(a)}
              >
                <Icon name="logout" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="account-actions">
        <button
          type="button"
          className="menu-item"
          disabled={full}
          title={full ? `เข้าสู่ระบบได้สูงสุด ${found?.max} บัญชีต่อเบราว์เซอร์` : undefined}
          onClick={() => openModal('เพิ่มบัญชีอื่น', <AddAccountForm />)}
        >
          <Icon name="plus" />
          {full ? `ครบ ${found?.max} บัญชีแล้ว` : 'เพิ่มบัญชีอื่น'}
        </button>
        <Link className="menu-item" href="/account">
          <Icon name="settings" />
          ตั้งค่าบัญชี
        </Link>
        <button type="button" className="menu-item danger" onClick={() => void onLogout().catch((error: Error) => toast(error.message, true))}>
          <Icon name="logout" />
          {others.length ? 'ออกจากระบบบัญชีนี้' : 'ออกจากระบบ'}
        </button>
        {others.length > 0 && (
          <button type="button" className="menu-item danger" onClick={signOutAll}>
            <Icon name="close" />
            ออกจากระบบทุกบัญชี
          </button>
        )}
      </div>
    </div>
  );
}

/** เพิ่มบัญชีอื่น: the account's email and password, then its second step when it has one. The account in use stays
    signed in on this browser. */
export function AddAccountForm() {
  const [methods, setMethods] = useState<string[] | null>(null);
  if (methods) return <TwoFactorStep kind="staff" methods={methods} onDone={() => reloadAsAccount()} />;
  return (
    <Form
      className="add-account-form"
      data-form="add-account"
      onSubmit={async (values) => {
        const result = await api<{ two_factor?: boolean; methods?: string[] }>('/api/login', { email: values.email, password: values.password });
        if (result.two_factor) {
          setMethods(result.methods ?? ['totp']);
          return;
        }
        reloadAsAccount();
      }}
    >
      <p className="muted">เข้าสู่ระบบอีกบัญชีในเบราว์เซอร์นี้ แล้วสลับไปมาได้จากเมนูรูปโปรไฟล์ โดยบัญชีที่ใช้อยู่ยังเข้าสู่ระบบค้างไว้</p>
      <TextField label="อีเมล" name="email" type="email" placeholder="you@bookdose.com" max={254} autoFocus />
      <TextField label="รหัสผ่าน" name="password" type="password" max={200} minLength={undefined} autoComplete="current-password" />
      <p className="notice add-account-note">
        <Icon name="shield" />
        <span>ทั้งสองบัญชีจะเห็นในประวัติความปลอดภัยว่าใช้เบราว์เซอร์นี้ร่วมกัน · บัญชีที่เปิดการยืนยันสองขั้นตอนจะถามรหัส 6 หลักต่อ</span>
      </p>
      <button className="btn primary" type="submit">
        เพิ่มบัญชี <Icon name="arrow" />
      </button>
    </Form>
  );
}
