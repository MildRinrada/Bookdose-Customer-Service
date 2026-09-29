'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Avatar, ProfilePhoto } from '@/components/ui/display';
import { TextArea, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { PhotoPicker } from '@/components/ui/PhotoPicker';
import { useToast } from '@/components/ui/Toast';
import { ThanksCardView } from '@/features/customer/components/ThanksCard';
import { useInvalidate } from '@/lib/query';
import { useBoot, useStaffLogout } from '@/lib/session';
import { saveStaffProfile } from './api';
import { PREFS_PATH, savePreferences, usePreferences } from './prefs';

/* ตั้งค่าบัญชี → ข้อมูลส่วนตัว: the picture and name every team the member works with sees, the email they sign in
   with, and signing out (as a customer's, features/customer/settings/ProfileSettings.tsx). */

export function ProfileSettings() {
  const boot = useBoot().data!;
  const user = boot.user!;
  const refresh = useInvalidate();
  const toast = useToast();
  const logout = useStaffLogout();

  return (
    <div className="account-section">
      <section className="card">
        <div className="card-header">
          <div>
            <h2>ข้อมูลส่วนตัว</h2>
            <p>รูปและชื่อที่ทีมงานและลูกค้าเห็นในทุกองค์กรที่คุณทำงานด้วย</p>
          </div>
        </div>
        <Form
          key={`${user.name}|${boot.avatar.length}`}
          className="card-body"
          data-form="staff-profile"
          onSubmit={async (values) => {
            await saveStaffProfile({ name: values.name ?? '', avatar: values.avatar || '' });
            await refresh('/api/bootstrap', '/api/workspace');
            toast('บันทึกข้อมูลแล้ว');
          }}
        >
          <PhotoPicker value={boot.avatar} personName={user.name} />
          <div className="field">
            <span className="file-field-title">อีเมลที่ใช้เข้าสู่ระบบ</span>
            <div className="customer-email">
              <strong>{user.email}</strong>
              {user.platform_admin && (
                <span className="badge resolved">
                  <Icon name="globe" />
                  ผู้ดูแลแพลตฟอร์ม
                </span>
              )}
            </div>
            <p className="tiny muted">เปลี่ยนอีเมลไม่ได้ หากต้องใช้อีเมลใหม่ ให้ผู้ดูแลองค์กรเชิญอีเมลนั้นเข้าทีม</p>
          </div>
          <TextField label="ชื่อที่แสดง" name="name" defaultValue={user.name} max={100} personName />
          <button className="btn primary" type="submit">
            <Icon name="check" />
            บันทึกข้อมูล
          </button>
        </Form>
      </section>
      {!user.platform_admin && <CustomerFacingCard />}
      {!user.platform_admin && <ThanksPrefsCard />}
      <section className="card">
        <div className="card-header">
          <div>
            <h2>ออกจากระบบ</h2>
            <p>ออกจากบัญชีนี้บนอุปกรณ์ที่ใช้อยู่ อุปกรณ์อื่นดูและออกจากระบบได้ที่หมวดความปลอดภัย</p>
          </div>
        </div>
        <div className="card-body">
          <button className="btn danger" type="button" onClick={() => void logout().catch((error: Error) => toast(error.message, true))}>
            <Icon name="logout" />
            ออกจากระบบบนอุปกรณ์นี้
          </button>
        </div>
      </section>
    </div>
  );
}

/* The member's part of การ์ดขอบคุณหลังปิดเคส (backend automation/thanks.py), in the organizations that give one:
   whether customers see their photo on it - off until they say so, since the photo is theirs - and a thank-you in
   their own words. The card below is what the customer sees. */
function ThanksPrefsCard() {
  const view = usePreferences();
  const boot = useBoot().data!;
  const user = boot.user!;
  const refresh = useInvalidate();
  const toast = useToast();
  const [preview, setPreview] = useState<{ photo: boolean; message: string } | null>(null);
  if (!view.data) return null;
  const prefs = view.data.preferences;
  const shown = preview ?? prefs.thanks;
  const hasPhoto = boot.avatar.startsWith('data:image/');
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>การ์ดขอบคุณหลังปิดเคส</h2>
          <p>ในองค์กรที่เปิดการ์ดนี้ ลูกค้าที่แชทบนเว็บจะเห็นการ์ดจากคุณเมื่อปิดเคสที่คุณดูแล</p>
        </div>
      </div>
      <Form
        key={JSON.stringify(prefs.thanks)}
        className="card-body"
        data-form="thanks-card"
        onChange={(event) => {
          const form = event.currentTarget;
          setPreview({
            photo: Boolean((form.elements.namedItem('thanks_photo') as HTMLInputElement | null)?.checked),
            message: (form.elements.namedItem('thanks_message') as HTMLTextAreaElement | null)?.value.trim() ?? '',
          });
        }}
        onSubmit={async (values) => {
          await savePreferences({ thanks: { photo: values.thanks_photo === 'on', message: values.thanks_message ?? '' } });
          await refresh(PREFS_PATH);
          setPreview(null);
          toast('บันทึกแล้ว การ์ดที่ลูกค้าเห็นใช้ค่านี้ทันที');
        }}
      >
        <div className="switch-group">
          <label className="check">
            <input type="checkbox" className="switch" name="thanks_photo" defaultChecked={prefs.thanks.photo} />
            <span className="check-text">
              <strong>ให้ลูกค้าเห็นรูปของฉันในการ์ด</strong>
              <small>
                {hasPhoto ? 'ถ้าไม่เปิด การ์ดแสดงตัวอักษรแรกของชื่อแทน ปิดเมื่อไรรูปก็หายจากการ์ดที่ส่งไปแล้วด้วย' : 'ยังไม่ได้ตั้งรูปโปรไฟล์ด้านบน การ์ดจึงแสดงตัวอักษรแรกของชื่อ'}
              </small>
            </span>
          </label>
        </div>
        <TextArea
          label="ข้อความของฉัน (ไม่บังคับ)"
          name="thanks_message"
          max={200}
          rows={2}
          required={false}
          defaultValue={prefs.thanks.message}
          hint="เว้นว่างไว้เพื่อใช้ข้อความขององค์กร"
        />
        <div className="reply-preview" aria-live="polite">
          <span className="tiny muted">ตัวอย่างที่ลูกค้าเห็น</span>
          <ThanksCardView
            card={{ name: prefs.alias || user.name, message: shown.message || 'ข้อความขอบคุณขององค์กรจะขึ้นตรงนี้', case: 1024 }}
            src={shown.photo && hasPhoto ? boot.avatar : null}
            heart={{ sent: false }}
          />
        </div>
        <button className="btn primary" type="submit">
          <Icon name="check" />
          บันทึก
        </button>
      </Form>
    </section>
  );
}

/* What the customer sees of the member on a reply: the name (a chosen alias instead of the real one, for privacy), a
   signature added under every reply, and on the web chat their photo beside it (on until they turn it off). Internal
   notes and the team always show the real name. */
function CustomerFacingCard() {
  const view = usePreferences();
  const boot = useBoot().data!;
  const user = boot.user!;
  const refresh = useInvalidate();
  const toast = useToast();
  const [preview, setPreview] = useState<{ alias: string; signature: string; on: boolean; photo: boolean } | null>(null);
  if (!view.data) return null;
  const prefs = view.data.preferences;
  const shown = preview ?? { alias: prefs.alias, signature: prefs.signature.text, on: prefs.signature.enabled, photo: prefs.chat_photo };
  const hasPhoto = boot.avatar.startsWith('data:image/');
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>สิ่งที่ลูกค้าเห็นเมื่อคุณตอบ</h2>
          <p>ชื่อบนข้อความตอบกลับ และลายเซ็นท้ายข้อความ ใช้กับทุกช่องทาง (หน้าเว็บ LINE อีเมล Facebook)</p>
        </div>
      </div>
      <Form
        key={JSON.stringify([prefs.alias, prefs.signature, prefs.chat_photo])}
        className="card-body"
        data-form="customer-facing"
        onChange={(event) => {
          const form = event.currentTarget;
          const read = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null);
          const checked = (name: string) => Boolean((read(name) as HTMLInputElement | null)?.checked);
          setPreview({ alias: read('alias')?.value.trim() ?? '', signature: read('signature')?.value.trim() ?? '', on: checked('signature_on'), photo: checked('chat_photo') });
        }}
        onSubmit={async (values) => {
          await savePreferences({
            alias: values.alias ?? '',
            signature: { enabled: values.signature_on === 'on', text: values.signature ?? '' },
            chat_photo: values.chat_photo === 'on',
          });
          await refresh(PREFS_PATH);
          setPreview(null);
          toast('บันทึกแล้ว ข้อความตอบกลับถัดไปจะใช้ค่านี้');
        }}
      >
        <TextField
          label="ชื่อที่แสดงต่อลูกค้า (ไม่บังคับ)"
          name="alias"
          max={60}
          required={false}
          defaultValue={prefs.alias}
          placeholder={user.name}
          hint="เว้นว่างไว้เพื่อใช้ชื่อจริง ใส่ชื่อเล่นหรือชื่อกลางได้ เช่น “ทีมบริการลูกค้า” เพื่อความเป็นส่วนตัว"
        />
        <div className="switch-group">
          <label className="check">
            <input type="checkbox" className="switch" name="chat_photo" defaultChecked={prefs.chat_photo} />
            <span className="check-text">
              <strong>ให้ลูกค้าเห็นรูปของฉันข้างข้อความตอบกลับในแชทบนเว็บ</strong>
              <small>
                {hasPhoto ? 'ถ้าปิด ลูกค้าเห็นตัวอักษรแรกของชื่อแทน และรูปหายจากข้อความที่ตอบไปแล้วด้วย' : 'ยังไม่ได้ตั้งรูปโปรไฟล์ด้านบน ลูกค้าจึงเห็นตัวอักษรแรกของชื่อ'}
              </small>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" className="switch" name="signature_on" defaultChecked={prefs.signature.enabled} />
            <span className="check-text">
              <strong>ต่อท้ายลายเซ็นในข้อความตอบกลับลูกค้าอัตโนมัติ</strong>
            </span>
          </label>
        </div>
        <TextArea
          label="ลายเซ็น"
          name="signature"
          max={500}
          rows={3}
          required={false}
          defaultValue={prefs.signature.text}
          hint="เช่น ชื่อ ตำแหน่ง หรือข้อความบริการมาตรฐาน บันทึกภายในไม่มีลายเซ็น"
        />
        <div className="reply-preview" aria-live="polite">
          <span className="tiny muted">ตัวอย่างที่ลูกค้าเห็น</span>
          <div className="reply-preview-row">
            {shown.photo && hasPhoto ? <ProfilePhoto src={boot.avatar} alt="รูปของคุณที่ลูกค้าเห็น" /> : <Avatar name={shown.alias || user.name} />}
            <div className="reply-preview-bubble">
              <strong>{shown.alias || user.name}</strong>
              <p>
                ขอบคุณที่แจ้งเข้ามาค่ะ ทีมงานตรวจสอบให้แล้ว
                {shown.on && shown.signature ? `\n\n${shown.signature}` : ''}
              </p>
            </div>
          </div>
        </div>
        <button className="btn primary" type="submit">
          <Icon name="check" />
          บันทึก
        </button>
      </Form>
    </section>
  );
}
