'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useRunAction } from '@/components/ui/actions';
import { useDialogs } from '@/components/ui/Dialogs';
import { EmptyState } from '@/components/ui/display';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { date } from '@/lib/format';
import { forceAccountReset, searchAccounts, suspendAccount, type AccountKind, type AccountSearch, type FoundAccount } from './api';

/* Platform console → บัญชีผู้ใช้ (backend platform/accounts.py): one account, found by its email, stopped everywhere.
   Suspending an organization stops everyone in it and signing someone out lasts until their next sign-in; this is
   for the account itself: staff or customer, the organizations it is in, and two acts - suspend (no sign-in at all
   until lifted) or make the password change (the old one stops working and the owner is emailed a link). Both ask
   the password again and are written in the platform's history and the account's own. Markup: pages/platform.css
   (account-*), the search as pages/pdpa.css. */

const roleWords: Record<string, string> = { admin: 'เจ้าขององค์กร', agent: 'เจ้าหน้าที่' };

export function AccountsScreen() {
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [found, setFound] = useState<AccountSearch | null>(null);
  const run = useRunAction();

  const find = (text: string) =>
    void run(async () => {
      const result = await searchAccounts(text.trim());
      setSearched(text.trim());
      setFound(result);
    });

  const accounts: { kind: AccountKind; account: FoundAccount }[] = found
    ? [...found.staff.map((account) => ({ kind: 'staff' as const, account })), ...found.customers.map((account) => ({ kind: 'customer' as const, account }))]
    : [];

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>บัญชีผู้ใช้</h1>
          <p>ค้นบัญชีทีมงานหรือลูกค้าด้วยอีเมล ดูว่าอยู่องค์กรไหนบ้าง แล้วระงับทั้งระบบ หรือบังคับตั้งรหัสผ่านใหม่</p>
        </div>
      </div>
      <section className="card">
        <form
          className="card-body pdpa-search"
          onSubmit={(event) => {
            event.preventDefault();
            if (query.trim().length >= 3) find(query);
          }}
        >
          <label className="pdpa-search-label" htmlFor="account-query">
            ค้นหาบัญชีด้วยอีเมล
          </label>
          <div className="pdpa-search-row">
            <input
              id="account-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="พิมพ์บางส่วนได้ อย่างน้อย 3 ตัวอักษร"
              autoComplete="off"
            />
            <button className="btn primary" type="submit" disabled={query.trim().length < 3}>
              <Icon name="search" />
              ค้นหา
            </button>
          </div>
          <p className="tiny muted">บัญชีผู้ดูแลแพลตฟอร์มแสดงในผลค้นหา แต่จัดการที่ ทีมผู้ดูแลระบบ</p>
        </form>
      </section>
      {found &&
        (accounts.length ? (
          <section className="card mt">
            <ul className="account-results">
              {accounts.map(({ kind, account }) => (
                <AccountRow key={`${kind}:${account.id}`} kind={kind} account={account} onDone={() => find(searched)} />
              ))}
            </ul>
            {(found.staff.length >= found.limit || found.customers.length >= found.limit) && (
              <p className="tiny muted account-more">แสดง {found.limit} บัญชีแรกของแต่ละประเภท พิมพ์อีเมลให้ละเอียดขึ้นเพื่อหาบัญชีที่เหลือ</p>
            )}
          </section>
        ) : (
          <EmptyState title="ไม่พบบัญชี" description={`ไม่มีบัญชีทีมงานหรือลูกค้าที่อีเมลมีคำว่า “${searched}”`} icon="search" />
        ))}
    </>
  );
}

function AccountRow({ kind, account: a, onDone }: { kind: AccountKind; account: FoundAccount; onDone: () => void }) {
  const { openModal, confirm } = useDialogs();
  const toast = useToast();
  const locked = Boolean(a.platform_admin);
  return (
    <li className={a.suspended_at ? 'is-suspended' : undefined}>
      <div className="account-who">
        <strong>{a.name}</strong>
        <span className="tiny muted">
          {a.email} · {kind === 'staff' ? (a.platform_admin ? 'ผู้ดูแลแพลตฟอร์ม' : 'บัญชีทีมงาน') : 'บัญชีลูกค้า'} · สร้างเมื่อ {date(a.created_at)}
        </span>
        {a.suspended_at && (
          <span className="account-suspended">
            <Icon name="lock" />
            ระงับเมื่อ {date(a.suspended_at, true)}
            {a.suspended_reason ? ` · ${a.suspended_reason}` : ''}
          </span>
        )}
        <span className="account-orgs">
          {a.organizations.length
            ? a.organizations.map((o) => (
                <span key={o.id} className="org-admin" title={o.status === 'suspended' ? 'องค์กรนี้ถูกระงับอยู่' : undefined}>
                  {o.name}
                  {o.role ? ` · ${roleWords[o.role] ?? o.role}` : ''}
                  {o.status === 'suspended' ? ' · ระงับ' : ''}
                </span>
              ))
            : <span className="tiny muted">{kind === 'staff' ? 'ไม่ได้อยู่องค์กรใด' : 'ยังไม่ได้เข้าร่วมองค์กรใด'}</span>}
        </span>
      </div>
      {locked ? (
        <span className="tiny muted">จัดการที่ ทีมผู้ดูแลระบบ</span>
      ) : (
        <div className="account-actions">
          {a.suspended_at ? (
            <button
              type="button"
              className="btn sm"
              onClick={() =>
                confirm({
                  title: `ยกเลิกการระงับ ${a.name}`,
                  message: 'เจ้าของบัญชีกลับมาเข้าสู่ระบบได้ด้วยรหัสผ่านของตัวเอง',
                  confirmLabel: 'ยกเลิกการระงับ',
                  run: async () => {
                    await suspendAccount(kind, a.id, false, '');
                    toast(`ยกเลิกการระงับ ${a.email} แล้ว`);
                    onDone();
                  },
                })
              }
            >
              <Icon name="restore" />
              ยกเลิกการระงับ
            </button>
          ) : (
            <button type="button" className="btn sm org-suspend" onClick={() => openModal(`ระงับบัญชี ${a.name}`, <ActionForm kind={kind} account={a} act="suspend" onDone={onDone} />)}>
              <Icon name="lock" />
              ระงับบัญชี
            </button>
          )}
          <button type="button" className="btn sm" onClick={() => openModal(`บังคับตั้งรหัสผ่านใหม่ ${a.name}`, <ActionForm kind={kind} account={a} act="reset" onDone={onDone} />)}>
            <Icon name="shield" />
            บังคับตั้งรหัสผ่านใหม่
          </button>
        </div>
      )}
    </li>
  );
}

function ActionForm({ kind, account: a, act, onDone }: { kind: AccountKind; account: FoundAccount; act: 'suspend' | 'reset'; onDone: () => void }) {
  const { closeModal } = useDialogs();
  const toast = useToast();
  return (
    <Form
      onSubmit={async (values) => {
        const reason = (values.reason ?? '').trim();
        if (act === 'suspend') {
          await suspendAccount(kind, a.id, true, reason);
          toast(`ระงับ ${a.email} แล้ว`);
        } else {
          const answer = await forceAccountReset(kind, a.id, reason);
          toast(answer.emailed ? `ส่งลิงก์ตั้งรหัสผ่านใหม่ถึง ${a.email} แล้ว` : 'รหัสผ่านเดิมใช้ไม่ได้แล้ว แต่ส่งอีเมลไม่สำเร็จ ลองกดอีกครั้งภายหลัง', !answer.emailed);
        }
        closeModal();
        onDone();
      }}
    >
      <div className="notice warning">
        {act === 'suspend' ? (
          <ul>
            <li>ออกจากระบบทุกอุปกรณ์ทันที</li>
            <li>เข้าสู่ระบบไม่ได้ทุกวิธี แม้รู้รหัสผ่าน มี Passkey หรือตั้งรหัสผ่านใหม่จากลิงก์</li>
            <li>{kind === 'staff' ? `มีผลกับทุกองค์กรที่บัญชีนี้อยู่ (${a.organizations.length} องค์กร)` : 'มีผลกับหน้าลูกค้าของทุกองค์กร'} จนกว่าผู้ดูแลแพลตฟอร์มจะยกเลิก</li>
          </ul>
        ) : (
          <ul>
            <li>รหัสผ่านเดิมใช้ไม่ได้ทันที และออกจากระบบทุกอุปกรณ์</li>
            <li>ลบ Passkey ทั้งหมด เผื่อคนอื่นเพิ่มไว้</li>
            <li>ระบบส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่ {a.email} ใช้เมื่อรหัสผ่านรั่วแต่อีเมลยังเป็นของเจ้าของ ถ้าอีเมลก็ถูกยึดไปด้วย ให้ระงับบัญชีแทน</li>
          </ul>
        )}
      </div>
      <div className="field">
        <label htmlFor="account-reason">เหตุผล (บันทึกในประวัติ ไม่ใส่ก็ได้)</label>
        <input id="account-reason" name="reason" maxLength={300} autoComplete="off" />
      </div>
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => closeModal()}>
          ยกเลิก
        </button>
        <button className="btn danger" type="submit">
          {act === 'suspend' ? 'ระงับบัญชี' : 'บังคับตั้งรหัสผ่านใหม่'}
        </button>
      </div>
    </Form>
  );
}
