'use client';

import Link from 'next/link';
import { Fragment, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { Avatar, EmptyState, ProfilePhoto } from '@/components/ui/display';
import { FormActions, RequiredStar, TextArea, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { PhotoPicker } from '@/components/ui/PhotoPicker';
import { useToast } from '@/components/ui/Toast';
import { useCopyText, useRunAction } from '@/components/ui/actions';
import { priorityLabels } from '@/lib/labels';
import { useInvalidate } from '@/lib/query';
import { customerHomeUrl } from '@/lib/routes';
import { useBoot, useWork } from '@/lib/session';
import type { TeamSnippet } from '@/lib/types';
import { changeOrgSlug, downloadBackup, saveOrgProfile, saveSettings, saveTeamSnippets, WORKSPACE_PATH } from '../api';
import type { SettingsBody, SlaPriority } from '../types';
import { BusinessHoursCard, savedHours } from './BusinessHoursCard';
import { CategoriesForm } from './CategoriesForm';
import { QuietCloseCard } from './QuietCloseCard';
import { RetentionCard } from './RetentionCard';

/* ตั้งค่า → the organization's own sections, one per page: who it is and its customer link (ProfilePanel), the SLA
   and automatic texts (ServicePanel), the categories customers choose from (CategoriesPanel) and the backup
   (BackupPanel). Markup: pages/settings. */

export function ProfilePanel() {
  const work = useWork();
  const { data: boot } = useBoot();
  const copyText = useCopyText();
  const { openModal } = useDialogs();
  // The screen only renders in the browser (the staff layout waits for the workspace), so window is there.
  const customerUrl = typeof window === 'undefined' ? '' : customerHomeUrl(work.tenant.slug, boot?.home?.slug);
  return (
    <section className="card">
      <div className="card-header">
        <h2>ข้อมูลองค์กร</h2>
      </div>
      <div className="card-body">
        <div className="org-identity">
          {work.tenant.logo ? <ProfilePhoto src={work.tenant.logo} alt={`โลโก้ของ ${work.tenant.name}`} /> : <Avatar name={work.tenant.name} index={1} />}
          <div className="org-facts">
            <strong className="org-name">{work.tenant.name}</strong>
            <span className="muted">
              รหัสองค์กร <code>{work.tenant.slug}</code>
              {work.role === 'admin' && (
                <button
                  type="button"
                  className="icon-btn sm"
                  aria-label="แก้ไขรหัสองค์กร"
                  title="แก้ไขรหัสองค์กร"
                  onClick={() => openModal('รหัสองค์กร', <SlugForm />)}
                >
                  <Icon name="edit" />
                </button>
              )}{' '}
              · สมาชิกที่ใช้งาน {work.members.filter((m) => m.active).length} คน · {work.teams.length} ทีม
            </span>
            {(work.tenant.former_slugs?.length ?? 0) > 0 && (
              <span className="tiny muted">รหัสเดิมที่ยังใช้เปิดลิงก์เก่าได้: {work.tenant.former_slugs?.join(', ')}</span>
            )}
          </div>
          {work.role === 'admin' && (
            <button type="button" className="btn sm subtle org-identity-edit" onClick={() => openModal('ชื่อและโลโก้องค์กร', <OrgProfileForm />)}>
              <Icon name="edit" />
              แก้ไขชื่อและโลโก้
            </button>
          )}
        </div>
        <div className="portal-link">
          <div className="grow">
            <span className="muted">
              หน้าลูกค้า · ลูกค้าสมัครสมาชิกและเข้าสู่ระบบที่หน้าแรกของระบบ แล้วใช้แชท เคส และคำถามที่พบบ่อยจากเมนูด้านข้าง
            </span>
            <a className="portal-url" href={customerUrl} target="_blank" rel="noopener">
              {customerUrl}
            </a>
          </div>
          <button type="button" className="btn subtle" onClick={() => void copyText(customerUrl)}>
            <Icon name="link" />
            คัดลอกลิงก์
          </button>
        </div>
        {!work.customer_email && (
          <p className="notice warning mt">
            ลูกค้าสมัครสมาชิกได้แล้ว แต่ระบบยังส่งอีเมลไม่ได้ บัญชีใหม่จึงยังไม่ได้ยืนยันอีเมล
            และลูกค้าจะไม่ได้รับอีเมลแจ้งเมื่อทีมตอบหรือลิงก์ลืมรหัสผ่าน ผู้ดูแลระบบกลางตั้งค่าได้ที่ คอนโซลระบบกลาง → จัดการองค์กร →
            อีเมลยืนยันการสมัครองค์กร แล้วบัญชีใหม่จะต้องยืนยันอีเมลก่อนใช้งาน
          </p>
        )}
      </div>
    </section>
  );
}

/* How full the organization's share of the shared disk is, but only once it is worth saying (80%). Running out is
   then something the owner saw coming, instead of an upload that suddenly fails. Nothing shows while there is room,
   and nothing shows at all when the platform gave this organization no ceiling. */
function StorageNotice() {
  const work = useWork();
  const storage = work.storage;
  if (!storage?.quota || !storage.warn) return null;
  const mb = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`);
  return (
    <section className={`card storage-notice${storage.full ? ' full' : ''}`}>
      <div className="card-body">
        <Icon name={storage.full ? 'bolt' : 'chart'} />
        <div>
          <strong>
            {storage.full ? 'พื้นที่จัดเก็บเต็มแล้ว' : `ใช้พื้นที่ไปแล้ว ${Math.round(storage.share * 100)}%`} · {mb(storage.used)} จาก {mb(storage.quota)}
          </strong>
          <p className="muted">
            {storage.full
              ? 'อัปโหลดไฟล์ใหม่ไม่ได้จนกว่าจะมีที่ว่าง การตอบลูกค้าและการเปิดไฟล์เดิมยังทำได้ตามปกติ'
              : 'เมื่อเต็มจะอัปโหลดไฟล์ใหม่ไม่ได้ แต่ยังตอบลูกค้าได้ตามปกติ'}{' '}
            ลบไฟล์แนบเก่าที่ไม่ใช้แล้ว หรือติดต่อผู้ดูแลระบบเพื่อขอเพิ่มพื้นที่
          </p>
        </div>
      </div>
    </section>
  );
}

/* SLA by priority: ปกติ is the organization's SLA (required); เร่งด่วน, สูง and ต่ำ may have their own, and an empty
   box follows ปกติ (backend tickets/sla.py). Changing a case's priority measures it again from when it opened. */
const SLA_OWN: SlaPriority[] = ['urgent', 'high', 'low'];
const SLA_ROWS: Array<SlaPriority | 'normal'> = ['urgent', 'high', 'normal', 'low'];

function slaSaved(raw: unknown): Partial<Record<SlaPriority, { response: number | null; resolution: number | null }>> {
  try {
    const value = typeof raw === 'string' && raw ? JSON.parse(raw) : {};
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function SlaTable({ normal, saved }: { normal: [string, string]; saved: ReturnType<typeof slaSaved> }) {
  const box = (name: string, label: string, value: string | number | null | undefined, base: string) => (
    <input
      type="number"
      name={name}
      aria-label={label}
      min={0.25}
      max={8760}
      step="any"
      inputMode="decimal"
      defaultValue={value ?? ''}
      placeholder={base ? `ปกติ ${base}` : undefined}
      required={!base}
    />
  );
  return (
    <div className="sla-table" role="group" aria-label="SLA ตามความเร่งด่วน">
      <span className="sla-head">ความเร่งด่วน</span>
      <span className="sla-head">ตอบครั้งแรกภายใน (ชม.)</span>
      <span className="sla-head">แก้ไขเคสภายใน (ชม.)</span>
      {SLA_ROWS.map((p) => {
        const name = priorityLabels[p];
        return p === 'normal' ? (
          <Fragment key={p}>
            <strong className={`sla-level ${p}`}>{name}</strong>
            {box('response_hours', `${name}: ตอบครั้งแรกภายใน`, normal[0], '')}
            {box('resolution_hours', `${name}: แก้ไขเคสภายใน`, normal[1], '')}
          </Fragment>
        ) : (
          <Fragment key={p}>
            <strong className={`sla-level ${p}`}>{name}</strong>
            {box(`sla-${p}-response`, `${name}: ตอบครั้งแรกภายใน`, saved[p]?.response, normal[0])}
            {box(`sla-${p}-resolution`, `${name}: แก้ไขเคสภายใน`, saved[p]?.resolution, normal[1])}
          </Fragment>
        );
      })}
      <p className="tiny muted sla-note">
        ช่องที่เว้นว่างใช้เวลาเดียวกับระดับปกติ · เมื่อเปลี่ยนความเร่งด่วนของเคส ไม่ว่าจะเปลี่ยนเองหรือกฎรับเรื่องเปลี่ยนให้ ระบบคำนวณกำหนดเวลาใหม่นับจากตอนเปิดเคส
        ถ้าตอบครั้งแรกไปแล้ว กำหนดตอบครั้งแรกจะคงเดิม
      </p>
    </div>
  );
}

export function ServicePanel() {
  const work = useWork();
  const toast = useToast();
  const refresh = useInvalidate();
  const setting = (key: string) => String(work.settings[key] ?? '');
  return (
    <>
    <StorageNotice />
    <Form
      onSubmit={async (values) => {
        await saveSettings({
          response_hours: values.response_hours ?? '',
          resolution_hours: values.resolution_hours ?? '',
          welcome: values.welcome ?? '',
          sla_by_priority: Object.fromEntries(
            SLA_OWN.map((p) => [p, { response: values[`sla-${p}-response`] ?? '', resolution: values[`sla-${p}-resolution`] ?? '' }]),
          ) as SettingsBody['sla_by_priority'],
        });
        toast('บันทึกการตั้งค่าแล้ว');
        await refresh(WORKSPACE_PATH);
      }}
    >
      <section className="card">
        <div className="card-header">
          <div>
            <h2>มาตรฐานการบริการ (SLA)</h2>
            <p>
              ใช้กับเคสที่เปิดใหม่ ·{' '}
              {savedHours(work.settings.business_hours).sla
                ? 'นับเฉพาะในเวลาทำการ ไม่นับกลางคืน วันที่ปิด และวันหยุดพิเศษ'
                : 'นับต่อเนื่อง 24 ชั่วโมง รวมวันหยุด'}{' '}
              · เปลี่ยนได้ที่การ์ดเวลาทำการด้านล่าง
            </p>
          </div>
        </div>
        <div className="card-body">
          <SlaTable normal={[setting('response_hours'), setting('resolution_hours')]} saved={slaSaved(work.settings.sla_by_priority)} />
        </div>
      </section>
      <section className="card">
        <div className="card-header">
          <div>
            <h2>ข้อความอัตโนมัติ</h2>
            <p>ข้อความที่ลูกค้าเห็นเมื่อเริ่มแชทใหม่ในหน้าลูกค้า และคำตอบสำเร็จรูปที่ทีมหยิบไปใช้ได้ในกล่องข้อความ</p>
          </div>
        </div>
        <div className="card-body">
          <div className="field">
            <label htmlFor="welcome">
              ข้อความต้อนรับในหน้าลูกค้า
              <RequiredStar />
            </label>
            <textarea id="welcome" name="welcome" maxLength={500} required defaultValue={setting('welcome')} />
          </div>
        </div>
      </section>
      <div className="settings-save">
        <span className="muted">การแก้ไขจะมีผลทันทีหลังบันทึก</span>
        <button className="btn primary" type="submit">
          <Icon name="check" />
          บันทึกการตั้งค่า
        </button>
      </div>
    </Form>
    <BusinessHoursCard />
    <QuietCloseCard />
    <TeamRepliesCard snippets={work.snippets} />
    </>
  );
}

/* คำตอบสำเร็จรูปของทีม: what the whole organization can put into a reply. Its own card, because each one is added,
   edited and ordered on its own (the same list the member's own quick replies use, staff-account/RepliesSettings).
   A prepared text that should also move the case on is a Macro instead (ระบบอัตโนมัติ). */
function SnippetForm({ snippet, onSave }: { snippet?: TeamSnippet; onSave: (snippet: TeamSnippet) => Promise<void> }) {
  return (
    <Form className="dialog-form" onSubmit={async (values) => onSave({ id: snippet?.id, shortcut: values.shortcut ?? '', text: values.text ?? '' })}>
      <TextField
        label="คีย์ลัด (พิมพ์ / ตามด้วยคำนี้)"
        name="shortcut"
        max={31}
        defaultValue={snippet ? `/${snippet.shortcut}` : '/'}
        hint="ตัวอักษรไทย อังกฤษ ตัวเลข _ หรือ - ไม่มีช่องว่าง เช่น /ทักทาย หรือ /thanks"
      />
      <TextArea label="ข้อความ" name="text" max={3000} rows={5} defaultValue={snippet?.text} />
      <button className="btn primary" type="submit">
        <Icon name="check" />
        บันทึกคำตอบสำเร็จรูป
      </button>
    </Form>
  );
}

function TeamRepliesCard({ snippets }: { snippets: TeamSnippet[] }) {
  const { openModal, closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const run = useRunAction();
  const store = async (next: TeamSnippet[], message: string) => {
    await saveTeamSnippets(next);
    await refresh(WORKSPACE_PATH);
    toast(message);
  };
  const edit = (index?: number) =>
    openModal(
      index === undefined ? 'เพิ่มคำตอบสำเร็จรูปของทีม' : 'แก้ไขคำตอบสำเร็จรูปของทีม',
      <SnippetForm
        snippet={index === undefined ? undefined : snippets[index]}
        onSave={async (snippet) => {
          const next = index === undefined ? [...snippets, snippet] : snippets.map((s, i) => (i === index ? snippet : s));
          await store(next, index === undefined ? 'เพิ่มคำตอบสำเร็จรูปแล้ว' : 'บันทึกแล้ว');
          closeModal(true);
        }}
      />,
    );
  const move = (index: number, by: number) => {
    const next = [...snippets];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    void run(() => store(next, 'เปลี่ยนลำดับแล้ว'));
  };

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>คำตอบสำเร็จรูปของทีม</h2>
          <p>
            ทุกคนในองค์กรหยิบไปใช้ได้จากปุ่ม ⚡ ในกล่องข้อความ หรือพิมพ์ /คีย์ลัด แล้วเว้นวรรค · ข้อความจะแทรกในช่องร่าง
            <strong> แก้ก่อนส่งได้ ยังไม่ส่งออกไป</strong> · ถ้าต้องการให้กดแล้วส่งและเปลี่ยนสถานะเคสด้วย ให้ใช้ Macro ที่ ระบบอัตโนมัติ
          </p>
        </div>
        <button className="btn primary" type="button" onClick={() => edit()}>
          <Icon name="plus" />
          เพิ่มคำตอบสำเร็จรูป
        </button>
      </div>
      <div className="card-body">
        {snippets.length === 0 ? (
          <EmptyState icon="bolt" title="ยังไม่มีคำตอบสำเร็จรูปของทีม" description="เพิ่มข้อความที่ทั้งทีมพิมพ์บ่อย เช่น คำทักทาย การขอข้อมูลเพิ่ม หรือขั้นตอนที่อธิบายซ้ำ ๆ" />
        ) : (
          <ul className="security-list snippet-list">
            {snippets.map((snippet, index) => (
              <li key={snippet.id ?? snippet.shortcut}>
                <span className="security-list-icon">
                  <Icon name="bolt" />
                </span>
                <span className="grow">
                  <strong>
                    <code>/{snippet.shortcut}</code>
                  </strong>
                  <span className="muted snippet-text">{snippet.text}</span>
                </span>
                <button className="btn sm" type="button" disabled={index === 0} aria-label="เลื่อนขึ้น" title="เลื่อนขึ้น" onClick={() => move(index, -1)}>
                  ↑
                </button>
                <button
                  className="btn sm"
                  type="button"
                  disabled={index === snippets.length - 1}
                  aria-label="เลื่อนลง"
                  title="เลื่อนลง"
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button className="btn sm" type="button" onClick={() => edit(index)}>
                  <Icon name="edit" />
                  แก้ไข
                </button>
                <button
                  className="btn sm danger"
                  type="button"
                  onClick={() => void run(() => store(snippets.filter((_, i) => i !== index), `ลบ /${snippet.shortcut} แล้ว`))}
                >
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

export function CategoriesPanel() {
  const work = useWork();
  const categoriesKey = String(work.settings.customer_categories ?? '');
  // Saved categories come back as a new value: start the rows again from it.
  return <CategoriesForm key={categoriesKey} saved={categoriesKey} />;
}

export function BackupPanel() {
  const work = useWork();
  const toast = useToast();
  const run = useRunAction();
  const [backingUp, setBackingUp] = useState(false);
  const backup = () =>
    run(async () => {
      setBackingUp(true);
      try {
        await downloadBackup(work.tenant.slug);
        toast('ดาวน์โหลดไฟล์สำรองแล้ว');
      } finally {
        setBackingUp(false);
      }
    });
  return (
    <>
    <section className="card">
      <div className="card-header">
        <h2>ข้อมูลและการสำรอง</h2>
        <Icon name="shield" />
      </div>
      <div className="card-body">
        <p className="muted">
          ดาวน์โหลดฐานข้อมูลและไฟล์แนบขององค์กรนี้เป็น ZIP เพื่อเก็บสำรอง ไฟล์ที่ได้มีรายละเอียดลูกค้าและบันทึกภายใน จึงควรเก็บในที่ปลอดภัย
        </p>
        <div className="settings-row-actions">
          <button type="button" className="btn" disabled={backingUp} onClick={() => void backup()}>
            <Icon name="download" />
            สำรองข้อมูลองค์กร
          </button>
          <Link className="btn subtle" href="/trash">
            <Icon name="trash" />
            ดูถังขยะ
          </Link>
        </div>
        <p className="tiny muted mt">รายการที่ลบจะอยู่ในถังขยะ 30 วันก่อนถูกลบถาวร · การสำรองทั้งระบบและกู้คืนทำผ่านคำสั่งที่อธิบายใน README.md</p>
      </div>
    </section>
    <RetentionCard />
    </>
  );
}

/* Correcting the organization's own code. It sits in the help-centre address, in every follow link already emailed
   or texted to a customer, and in the widget on the organization's own website, so the old code keeps leading here
   for good instead of turning all of those into a dead end. A code another organization once used is refused. */
/* The organization's own name and picture. Both are what its customers see - the name heads every page they open and
   every notice they are sent - so this is the one place that changes them, and only an owner reaches it. */
function OrgProfileForm() {
  const work = useWork();
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <Form
      data-form="org-profile"
      onSubmit={async (values) => {
        await saveOrgProfile({ name: (values.name ?? '').trim(), logo: values.logo ?? '' });
        closeModal();
        toast('บันทึกข้อมูลองค์กรแล้ว');
        await refresh(WORKSPACE_PATH, '/api/bootstrap');
      }}
    >
      <PhotoPicker
        name="logo"
        value={work.tenant.logo ?? ''}
        personName={work.tenant.name}
        title="โลโก้องค์กร"
        hint="ลูกค้าเห็นรูปนี้ที่หน้าช่วยเหลือและหน้าต่างแชท · คลิกที่รูปเพื่อเลือกภาพใหม่ แล้วเลื่อนและย่อ-ขยายให้พอดี · PNG หรือ JPG ไม่เกิน 5 MB"
      />
      <TextField label="ชื่อองค์กร" name="name" defaultValue={work.tenant.name} max={100} required hint="ชื่อนี้ขึ้นบนหน้าที่ลูกค้าเปิดและในอีเมลที่ระบบส่งถึงลูกค้า" />
      <FormActions label="บันทึก" onCancel={() => closeModal()} />
    </Form>
  );
}

function SlugForm() {
  const work = useWork();
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <Form
      data-form="org-slug"
      onSubmit={async (values) => {
        const answer = await changeOrgSlug((values.slug ?? '').trim());
        closeModal();
        toast(`เปลี่ยนรหัสองค์กรเป็น ${answer.slug} แล้ว`);
        await refresh(WORKSPACE_PATH, '/api/bootstrap');
      }}
    >
      <p className="notice">
        รหัสเดิม <strong>{work.tenant.slug}</strong> จะยังเปิดหน้าลูกค้าขององค์กรได้ตลอดไป ลิงก์ที่ส่งไปแล้วทางอีเมลหรือ SMS และวิดเจ็ตที่ฝังบนเว็บไซต์ของคุณจึงไม่พัง
        · แต่ลิงก์ที่แจกใหม่ควรใช้รหัสใหม่
      </p>
      <TextField label="รหัสองค์กรใหม่" name="slug" defaultValue={work.tenant.slug} max={60} hint="a-z, 0-9 และขีดกลาง เช่น bookdose-support" />
      <FormActions label="เปลี่ยนรหัสองค์กร" onCancel={() => closeModal()} />
    </Form>
  );
}
