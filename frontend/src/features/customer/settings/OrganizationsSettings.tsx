'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { OrgLogo } from '@/components/ui/OrgLogo';
import { TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { joinByLink } from '@/features/org-links/api';
import { canScanQr, QrScan, readJoinCode, type JoinCode } from '@/features/org-links/components/QrScan';
import { useInvalidate } from '@/lib/query';
import { joinOrganization, ORGS_PATH, OVERVIEW_PATH } from '../api';
import { useOrgs } from '../hooks';

/* ตั้งค่าบัญชี → องค์กรที่ติดต่อได้: every organization the customer can contact, and the three ways to add one — its
   code, a pasted link, or scanning its QR with the camera (backend org_links). Markup: pages/org-links.css. */

/** Whether the browser can read a QR never changes while the page is open. */
const neverChanges = () => () => {};

export function OrganizationsSettings() {
  const orgs = useOrgs();
  const refresh = useInvalidate();
  const toast = useToast();

  /** Add an organization from what the customer typed, pasted or scanned. */
  const add = useCallback(
    async (found: JoinCode) => {
      const { organization } = 'token' in found ? await joinByLink(found.token) : await joinOrganization(found.slug);
      await refresh(ORGS_PATH, OVERVIEW_PATH);
      toast(`เพิ่ม ${organization.name} ในองค์กรที่ติดต่อได้แล้ว`);
    },
    [refresh, toast],
  );

  return (
    <div className="account-section">
      <section className="card">
        <div className="card-header">
          <div>
            <h2>องค์กรที่ติดต่อได้</h2>
            <p>บัญชีเดียวใช้ได้ทุกองค์กร แชท เปิดเคส และอ่านคำถามที่พบบ่อยขององค์กรเหล่านี้ได้</p>
          </div>
        </div>
        <div className="card-body">
          <ul className="org-role-list">
            {orgs.map((org) => (
              <li key={org.slug} className="org-role">
                <div className="org-role-head">
                  <OrgLogo slug={org.slug} name={org.name} index={org.home ? 1 : 3} hasLogo={org.has_logo} />
                  <span className="grow">
                    <strong>{org.name}</strong>
                    <span className="muted">
                      {org.home ? 'ผู้ให้บริการระบบ · ติดต่อเรื่องปัญหาระบบได้เสมอ' : 'องค์กรที่คุณติดต่อ'} · รหัส {org.slug}
                    </span>
                  </span>
                  {org.home && <span className="badge resolved">ผู้ให้บริการระบบ</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <AddOrgCard onAdd={add} />
    </div>
  );
}

/** Adding an organization: its code, a link that was sent, or its QR read by the camera. */
function AddOrgCard({ onAdd }: { onAdd: (found: JoinCode) => Promise<void> }) {
  const { openModal, closeModal } = useDialogs();
  const toast = useToast();
  // Only the browser knows whether it can read a QR; the server renders the page without the button.
  const scanner = useSyncExternalStore(neverChanges, canScanQr, () => false);

  const scanned = async (found: JoinCode) => {
    closeModal(true);
    try {
      await onAdd(found);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  };

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>เพิ่มองค์กรที่ติดต่อได้</h2>
          <p>ใช้รหัสองค์กร ลิงก์ที่องค์กรส่งมา หรือสแกน QR ขององค์กร</p>
        </div>
      </div>
      <Form
        className="card-body org-join-form"
        onSubmit={async (values, form) => {
          const found = readJoinCode(values.code ?? '');
          if (!found) throw new Error('ไม่รู้จักลิงก์หรือรหัสนี้ ระบบรับเฉพาะลิงก์ของระบบนี้ กรุณาวางลิงก์ที่องค์กรให้ไว้ หรือกรอกรหัสองค์กร เช่น my-company');
          await onAdd(found);
          form.reset();
        }}
      >
        <TextField
          label="รหัสองค์กร หรือวางลิงก์ที่ได้รับ"
          name="code"
          max={200}
          placeholder="เช่น my-company หรือ https://…/join/…"
          hint="ลิงก์ขององค์กรมีรหัสอยู่ท้าย เช่น …/?org=my-company · ลิงก์เชิญเป็น …/join/…"
        />
        <div className="org-join-actions">
          <button className="btn primary" type="submit">
            <Icon name="plus" />
            เพิ่มองค์กร
          </button>
          {scanner && (
            <button
              type="button"
              className="btn"
              onClick={() => openModal('สแกน QR ขององค์กร', <QrScan onFound={(found) => void scanned(found)} />)}
            >
              <Icon name="camera" />
              สแกน QR
            </button>
          )}
        </div>
      </Form>
    </section>
  );
}
