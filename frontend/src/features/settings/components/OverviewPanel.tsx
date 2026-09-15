'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/ui/display';
import { RequiredStar, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useCopyText, useRunAction } from '@/components/ui/actions';
import { ChannelSummary } from '@/features/channels';
import { useInvalidate } from '@/lib/query';
import { customerHomeUrl } from '@/lib/routes';
import { useBoot, useWork } from '@/lib/session';
import { downloadBackup, saveSettings, WORKSPACE_PATH } from '../api';
import { CategoriesForm } from './CategoriesForm';

/* ตั้งค่า → ภาพรวมและบริการ: who the organization is and its customer link, the SLA and automatic texts, the
   categories customers choose from, the channels and the backup. Markup: old-frontend/pages/settings/settings.html. */

export function OverviewPanel() {
  const work = useWork();
  const { data: boot } = useBoot();
  const toast = useToast();
  const refresh = useInvalidate();
  const copyText = useCopyText();
  const run = useRunAction();
  const [backingUp, setBackingUp] = useState(false);
  const s = work.settings;
  const setting = (key: string) => String(s[key] ?? '');
  // The screen only renders in the browser (the staff layout waits for the workspace), so window is there.
  const customerUrl = typeof window === 'undefined' ? '' : customerHomeUrl(work.tenant.slug, boot?.home?.slug);
  const categoriesKey = setting('customer_categories');

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
          <h2>ข้อมูลองค์กร</h2>
        </div>
        <div className="card-body">
          <div className="org-identity">
            <Avatar name={work.tenant.name} index={1} />
            <div className="org-facts">
              <strong className="org-name">{work.tenant.name}</strong>
              <span className="muted">
                รหัสองค์กร <code>{work.tenant.slug}</code> · สมาชิกที่ใช้งาน {work.members.filter((m) => m.active).length} คน ·{' '}
                {work.teams.length} ทีม
              </span>
            </div>
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
      <Form
        onSubmit={async (values) => {
          await saveSettings({
            response_hours: values.response_hours ?? '',
            resolution_hours: values.resolution_hours ?? '',
            welcome: values.welcome ?? '',
            canned_reply: values.canned_reply ?? '',
          });
          toast('บันทึกการตั้งค่าแล้ว');
          await refresh(WORKSPACE_PATH);
        }}
      >
        <section className="card">
          <div className="card-header">
            <div>
              <h2>มาตรฐานการบริการ (SLA)</h2>
              <p>ใช้กับเคสที่เปิดใหม่ · นับต่อเนื่อง 24 ชั่วโมง รวมวันหยุด</p>
            </div>
          </div>
          <div className="card-body">
            <div className="form-grid">
              <TextField
                id="f-response_hours"
                label="ตอบกลับครั้งแรกภายใน (ชม.)"
                name="response_hours"
                type="number"
                defaultValue={setting('response_hours')}
              />
              <TextField
                id="f-resolution_hours"
                label="แก้ไขเคสภายใน (ชม.)"
                name="resolution_hours"
                type="number"
                defaultValue={setting('resolution_hours')}
              />
            </div>
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
            <div className="field">
              <label htmlFor="canned-reply">
                คำตอบสำเร็จรูปของทีม
                <RequiredStar />
              </label>
              <textarea id="canned-reply" name="canned_reply" maxLength={3000} required defaultValue={setting('canned_reply')} />
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
      {/* Saved categories come back as a new value: start the rows again from it. */}
      <CategoriesForm key={categoriesKey} saved={categoriesKey} />
      <section className="card">
        <div className="card-header">
          <h2>ช่องทางรับเรื่อง</h2>
        </div>
        <div className="card-body">
          <div className="channel-row">
            <div className="channel-icon">
              <Icon name="globe" />
            </div>
            <div className="grow">
              <h3>แชทบนเว็บ</h3>
              <p>ลูกค้าที่มีบัญชีแชทกับทีมงานจากหน้าลูกค้า</p>
            </div>
            <span className="badge resolved">พร้อมใช้งาน</span>
          </div>
          <ChannelSummary />
        </div>
      </section>
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
          <p className="tiny muted mt">
            รายการที่ลบจะอยู่ในถังขยะ 30 วันก่อนถูกลบถาวร · การสำรองทั้งระบบและกู้คืนทำผ่านคำสั่งที่อธิบายใน README.md
          </p>
        </div>
      </section>
    </>
  );
}
