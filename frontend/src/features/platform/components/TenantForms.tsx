'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useCopyText } from '@/components/ui/actions';
import { useDialogs } from '@/components/ui/Dialogs';
import { ErrorState } from '@/components/ui/display';
import { FormActions, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useApi, useInvalidate } from '@/lib/query';
import { customerHomeUrl } from '@/lib/routes';
import { addTenantAdmin, createTenant, PLATFORM_PREFIX, requestSupportAccess, resetStaffSecurity, setTenantStatus, setTenantTeamSize, tenantMembersPath } from '../api';
import type { Tenant, TenantMember } from '../types';

// backend platform/team_size.py MAX
const TEAM_MAX = 5;

/** จำนวนทีมงาน: แบบคนเดียว (its หัวหน้าทีม answers every customer, a new case is theirs at once) or a team of up to
    five. The server refuses a number below the people already working there. */
export function TeamSizeForm({ tenant }: { tenant: Tenant }) {
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const [team, setTeam] = useState(tenant.member_limit > 1);
  return (
    <Form
      data-form="tenant-team-size"
      onSubmit={async (values) => {
        const limit = team ? Number(values.member_limit ?? TEAM_MAX) : 1;
        await setTenantTeamSize(tenant.id, limit);
        closeModal();
        toast(limit === 1 ? `${tenant.name} ใช้แบบคนเดียวแล้ว` : `${tenant.name} มีทีมงานได้สูงสุด ${limit} คนแล้ว`);
        await refresh(PLATFORM_PREFIX);
      }}
    >
      <p className="notice">ตอนนี้มีทีมงานที่เปิดใช้งาน {tenant.member_count} คน</p>
      <div className="stack mb">
        <label className="check">
          <input type="radio" name="mode" checked={!team} onChange={() => setTeam(false)} />
          <span>
            <strong>คนเดียว</strong>
            <span className="tiny muted"> หัวหน้าทีมคนเดียวตอบลูกค้าทุกเรื่อง เคสใหม่เป็นของเขาทันที เพิ่มทีมงานไม่ได้</span>
          </span>
        </label>
        <label className="check">
          <input type="radio" name="mode" checked={team} onChange={() => setTeam(true)} />
          <span>
            <strong>หลายคน</strong>
            <span className="tiny muted"> เชิญทีมงานได้ตามจำนวนที่ตั้ง นับรวมคำเชิญที่ยังไม่ตอบรับ</span>
          </span>
        </label>
      </div>
      {team && (
        <div className="field">
          <label htmlFor="team-size-limit">จำนวนทีมงานสูงสุด (คน)</label>
          <select id="team-size-limit" name="member_limit" defaultValue={String(Math.max(tenant.member_limit, 2))}>
            {Array.from({ length: TEAM_MAX - 1 }, (_, i) => i + 2).map((n) => (
              <option key={n} value={n}>
                {n} คน
              </option>
            ))}
          </select>
        </div>
      )}
      <FormActions onCancel={() => closeModal()} label="บันทึก" />
    </Form>
  );
}

/* The organizations page's dialogs: a new organization (pages/platform/new-tenant.html), a platform admin's request
   to enter one for support (pages/platform/support-access.html), suspending one, and resetting a staff member's
   two-step sign-in. */

/** An organization's staff and their two-step sign-in, for the one who lost their phone and their recovery codes: the
    reset asks the password again (the server's), is written in both histories and emails the account's owner.
    Markup: pages/platform.css (staff-security). */
export function StaffSecurityList({ id }: { id: string }) {
  const members = useApi<{ members: TenantMember[] }>(tenantMembersPath(id));
  const { confirm } = useDialogs();
  const toast = useToast();
  if (members.error) return <ErrorState error={members.error} onRetry={() => void members.refetch()} />;
  if (!members.data) return <p className="tiny muted">กำลังโหลดรายชื่อทีมงาน…</p>;
  const list = members.data.members;
  return (
    <>
      {list.length ? (
        <ul className="staff-security">
          {list.map((m) => {
            const methods = [m.two_factor ? 'แอปยืนยันตัวตน' : '', m.passkeys ? `Passkey ${m.passkeys} อัน` : ''].filter(Boolean);
            return (
              <li key={m.id}>
                <span className="staff-security-who">
                  <strong>{m.name}</strong>
                  <span className="tiny muted">
                    {m.email}
                    {!m.active && ' ปิดการใช้งานอยู่'}
                  </span>
                </span>
                {methods.length ? (
                  <>
                    <span className="staff-security-on">
                      <Icon name="shield" />
                      {methods.join(' และ ')}
                    </span>
                    <button type="button" className="btn sm" onClick={() => reset(m)}>
                      <Icon name="restore" />
                      รีเซ็ต
                    </button>
                  </>
                ) : (
                  <span className="tiny muted staff-security-off">ยังไม่ได้เปิดการยืนยันสองขั้นตอน</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="tiny muted">องค์กรนี้ยังไม่มีทีมงาน</p>
      )}
    </>
  );

  function reset(m: TenantMember) {
    confirm({
      title: `รีเซ็ตการยืนยันสองขั้นตอนของ ${m.name}`,
      message: `ลบแอปยืนยันตัวตน รหัสสำรอง และ Passkey ทั้งหมดของ ${m.email} และออกจากระบบทุกอุปกรณ์`,
      confirmLabel: 'รีเซ็ต',
      tone: 'danger',
      run: async () => {
        const answer = await resetStaffSecurity(m.id, '');
        toast(answer.emailed ? `รีเซ็ตแล้ว ส่งอีเมลแจ้ง ${m.email} แล้ว` : 'รีเซ็ตแล้ว แต่ส่งอีเมลแจ้งไม่ได้ ตรวจการตั้งค่าอีเมลของระบบ แล้วแจ้งเจ้าของบัญชีเอง', !answer.emailed);
        await members.refetch();
      },
    });
  }
}

/** An organization's code from its name, while the name is in Latin letters: "Acme Shop Co." is acme-shop-co. A Thai
    name gives nothing, and the code is typed. */
const codeFrom = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

/** A first password nobody has to think up: 16 characters without the ones that read alike (l 1 I O 0). */
function makePassword() {
  const letters = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const picks = crypto.getRandomValues(new Uint32Array(16));
  return Array.from(picks, (n) => letters[n % letters.length]).join('');
}

/** Put a value into an uncontrolled field the way typing would, so its own checks and counter see it. */
function typeInto(id: string, value: string) {
  const input = document.getElementById(id) as HTMLInputElement | null;
  if (!input) return;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** สร้างองค์กรใหม่ (the organizations page): the organization, then who runs it, then what happens next. The code is
    shown as the link customers will be given, since that is what it is for. Markup: pages/platform.css (new-tenant). */
export function TenantForm() {
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const copyText = useCopyText();
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [made, setMade] = useState('');
  const valid = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
  return (
    <Form
      data-form="tenant"
      className="new-tenant"
      onSubmit={async (values) => {
        await createTenant({
          name: values.name ?? '',
          slug: values.slug ?? '',
          admin_name: values.admin_name ?? '',
          email: values.email ?? '',
          password: values.password ?? '',
        });
        closeModal();
        toast('สร้างองค์กรเรียบร้อยแล้ว');
        await refresh(PLATFORM_PREFIX);
      }}
    >
      <section className="new-tenant-step" aria-labelledby="new-tenant-org">
        <h3 id="new-tenant-org">
          <span className="new-tenant-number">1</span>
          ข้อมูลองค์กร
        </h3>
        <TextField
          label="ชื่อองค์กร"
          name="name"
          max={100}
          placeholder="ชื่อบริษัทหรือหน่วยงาน"
          onChange={(e) => {
            if (!slugTouched) setSlug(codeFrom(e.target.value));
          }}
        />
        <TextField
          label="รหัสองค์กร"
          name="slug"
          max={60}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          title="ใช้ได้แค่ a-z ตัวเล็ก, 0-9 และขีดกลาง"
          placeholder="เช่น my-company"
          autoCapitalize="none"
          spellCheck={false}
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
        />
        <div className="new-tenant-link" aria-live="polite">
          <Icon name="link" />
          <span>
            <small>ลิงก์ที่ลูกค้าจะได้รับ</small>
            {/* Until there is a code, the link with a gap where it goes. */}
            <code>{valid ? customerHomeUrl(slug) : <>{customerHomeUrl('')}<span className="new-tenant-gap">รหัสองค์กร</span></>}</code>
          </span>
        </div>
      </section>

      <section className="new-tenant-step" aria-labelledby="new-tenant-admin">
        <h3 id="new-tenant-admin">
          <span className="new-tenant-number">2</span>
          หัวหน้าทีม
        </h3>
        <div className="form-grid">
          <TextField label="ชื่อผู้ดูแล" name="admin_name" max={100} placeholder="ชื่อ-นามสกุล" personName />
          <TextField label="อีเมลผู้ดูแล" name="email" type="email" max={254} placeholder="name@company.com" />
        </div>
        <div className="new-tenant-password">
          <TextField
            id="new-tenant-password"
            label="รหัสผ่านเริ่มต้น"
            name="password"
            type="password"
            required={false}
            max={200}
          />
          <button
            type="button"
            className="btn"
            onClick={() => {
              const password = makePassword();
              typeInto('new-tenant-password', password);
              setMade(password);
            }}
          >
            <Icon name="sparkle" />
            สุ่มรหัสผ่าน
          </button>
        </div>
        {made && (
          <div className="new-tenant-made">
            <span>
              <small>รหัสผ่านที่สุ่มได้ ระบบจะไม่แสดงอีก</small>
              <code>{made}</code>
            </span>
            <button type="button" className="btn sm" onClick={() => void copyText(made)}>
              <Icon name="copy" />
              คัดลอก
            </button>
          </div>
        )}
      </section>

      <FormActions label="สร้างองค์กร" onCancel={() => closeModal()} />
    </Form>
  );
}

/** An organization's admin, from the console: the platform's own organization has none at first (its owner looks
    after the server, never an organization's work). By email invitation when the platform can send email; otherwise,
    or when a first password is typed, the account is made at once. */
export function TenantAdminForm({ id, name, canInvite }: { id: string; name: string; canInvite: boolean }) {
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <Form
      data-form="tenant-admin"
      data-id={id}
      onSubmit={async (values) => {
        const answer = await addTenantAdmin(id, {
          email: values.email ?? '',
          ...(values.password ? { admin_name: values.admin_name ?? '', password: values.password } : {}),
        });
        closeModal();
        toast(
          answer.mode === 'created'
            ? `เพิ่มผู้ดูแล ${name} แล้ว เข้าสู่ระบบด้วยอีเมลและรหัสผ่านเริ่มต้นได้ทันที`
            : answer.sent
              ? `ส่งคำเชิญผู้ดูแล ${name} ทางอีเมลแล้ว`
              : 'บันทึกคำเชิญแล้ว แต่ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
          answer.mode === 'invited' && !answer.sent,
        );
        await refresh(PLATFORM_PREFIX);
      }}
    >
      {!canInvite && <p className="notice">ระบบยังส่งอีเมลไม่ได้</p>}
      <TextField label="อีเมลหัวหน้าทีม" name="email" type="email" max={254} />
      {canInvite ? (
        <details className="admin-password-option">
          <summary>หรือสร้างบัญชีพร้อมรหัสผ่านเริ่มต้นแทนการส่งอีเมล</summary>
          <TextField label="ชื่อผู้ดูแล" name="admin_name" max={100} required={false} />
          <TextField label="รหัสผ่านเริ่มต้น" name="password" type="password" required={false} max={200} />
        </details>
      ) : (
        <>
          <TextField label="ชื่อผู้ดูแล (สำหรับบัญชีใหม่)" name="admin_name" max={100} required={false} />
          <TextField label="รหัสผ่านเริ่มต้น" name="password" type="password" max={200} />
        </>
      )}
      <FormActions label={canInvite ? 'เชิญผู้ดูแล' : 'เพิ่มผู้ดูแล'} onCancel={() => closeModal()} />
    </Form>
  );
}

/** Suspending stops everything of the organization at once, so its name (or CONFIRM) is typed first, like the
    server asks. */
export function SuspendTenantForm({ id, name }: { id: string; name: string }) {
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <Form
      data-form="suspend-tenant"
      data-id={id}
      onSubmit={async (values) => {
        await setTenantStatus(id, 'suspended', (values.confirmation ?? '').trim());
        closeModal();
        toast(`ระงับ ${name} แล้ว`);
        // The signed-in account may work in it: its workspace list changes too.
        await refresh(PLATFORM_PREFIX, '/api/bootstrap');
      }}
    >
      <p className="notice warning">
        ทีมงานและลูกค้าของ <strong>{name}</strong> ใช้งานไม่ได้ทันที จนกว่าจะเปิดใช้งานอีกครั้ง
      </p>
      <TextField label={`พิมพ์ชื่อองค์กร “${name}” หรือ CONFIRM เพื่อยืนยัน`} name="confirmation" max={100} autoComplete="off" />
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => closeModal()}>
          ยกเลิก
        </button>
        <button className="btn danger" type="submit">
          ระงับองค์กร
        </button>
      </div>
    </Form>
  );
}

export function SupportAccessForm({ id, name }: { id: string; name: string }) {
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <Form
      data-form="support-access"
      data-id={id}
      onSubmit={async (values) => {
        await requestSupportAccess(id, values.reason ?? '', Number(values.hours));
        closeModal();
        toast(`ส่งคำขอถึงผู้ดูแล ${name} แล้ว เข้าได้เมื่อได้รับอนุมัติ`);
        await refresh(PLATFORM_PREFIX);
      }}
    >
      <TextField label="เหตุผลที่ต้องเข้าดูข้อมูล (เช่น เลขคำร้อง หรือปัญหาที่ต้องตรวจสอบ)" name="reason" max={300} />
      <div className="field">
        <label htmlFor="support-request-hours">ขอใช้งานเป็นเวลา</label>
        <select id="support-request-hours" name="hours" defaultValue="4">
          {[1, 4, 8, 24, 72].map((h) => (
            <option key={h} value={h}>
              {h} ชั่วโมง
            </option>
          ))}
        </select>
      </div>
      <FormActions label="ส่งคำขอ" onCancel={() => closeModal()} />
    </Form>
  );
}
