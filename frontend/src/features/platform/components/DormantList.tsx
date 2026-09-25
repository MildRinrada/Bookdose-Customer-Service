'use client';

import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { EmptyState } from '@/components/ui/display';
import { FormActions } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { date, number, relative } from '@/lib/format';
import { useInvalidate } from '@/lib/query';
import { contactTenant, DORMANT_PATH } from '../api';
import { bytesText } from '../labels';
import type { DormantPage } from '../types';
import { SuspendTenantForm } from './TenantForms';

/* จัดการองค์กร → องค์กรที่หลับ (backend platform/dormant.py): organizations no member of the team has opened and no
   case has come into for 90 days, the longest asleep first, with what they still hold and who runs them - and the two
   things to do about one: ask its owners (an email from the platform's mailbox, or their addresses to write to
   yourself) or suspend it. Markup: pages/platform-health.css (.dormant-*). */

type Org = DormantPage['organizations'][number];

const daysSince = (value: string) => Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 86_400_000));

function letter(org: Org) {
  return {
    subject: `องค์กร ${org.name} บน Bookdose ยังใช้งานอยู่ไหม`,
    message:
      `สวัสดีค่ะ ผู้ดูแลองค์กร ${org.name}\n\n` +
      `องค์กร ${org.name} (รหัส ${org.slug}) บน Bookdose Customer Service ไม่มีทีมงานเข้าใช้และไม่มีเคสใหม่มาตั้งแต่ ${date(org.asleep_since)}\n\n` +
      'ถ้ายังต้องการใช้งานอยู่ เพียงเข้าสู่ระบบตามปกติ หรือตอบกลับอีเมลนี้\n' +
      'ถ้าไม่ใช้แล้ว ทางเราจะระงับองค์กรเพื่อความปลอดภัยของข้อมูล ข้อมูลยังเก็บไว้ครบ และเปิดใช้งานกลับได้เมื่อแจ้งมา\n\n' +
      'ทีมผู้ดูแลแพลตฟอร์ม',
  };
}

function ContactForm({ org, mailReady }: { org: Org; mailReady: boolean }) {
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const draft = letter(org);
  const emails = org.admins.map((a) => a.email);
  if (!emails.length) return <p className="notice warning">องค์กรนี้ไม่มีผู้ดูแลที่ติดต่อได้ ระงับได้เลย หรือเพิ่มผู้ดูแลจากรายชื่อองค์กร</p>;
  if (!mailReady)
    return (
      <div className="dormant-contact">
        <p className="notice warning">ยังไม่ได้ตั้งค่าอีเมลของระบบ จึงส่งจากที่นี่ไม่ได้ เปิดอีเมลของคุณเพื่อส่งเองได้</p>
        <p>
          ผู้ดูแล: <strong>{emails.join(', ')}</strong>
        </p>
        <a
          className="btn primary"
          href={`mailto:${emails.join(',')}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.message)}`}
        >
          <Icon name="mail" />
          เปิดอีเมลของฉัน
        </a>
      </div>
    );
  return (
    <Form
      className="dormant-contact"
      data-form="contact-tenant"
      onSubmit={async (values) => {
        const done = await contactTenant(org.id, { subject: values.subject ?? '', message: values.message ?? '' });
        closeModal();
        toast(`ส่งอีเมลถึง ${done.sent.join(', ')} แล้ว`);
        await refresh(DORMANT_PATH);
      }}
    >
      <p>
        ส่งจากอีเมลของระบบถึงผู้ดูแลองค์กร: <strong>{emails.join(', ')}</strong>
      </p>
      <label className="field">
        <span>หัวเรื่อง</span>
        <input name="subject" defaultValue={draft.subject} maxLength={200} required />
      </label>
      <label className="field">
        <span>ข้อความ</span>
        <textarea name="message" defaultValue={draft.message} maxLength={5000} rows={10} required />
      </label>
      <FormActions label="ส่งอีเมล" onCancel={() => closeModal()} />
    </Form>
  );
}

export function DormantList({ page }: { page: DormantPage | undefined }) {
  const { openModal } = useDialogs();
  if (!page) return <p className="muted">กำลังดูว่าองค์กรไหนไม่มีการใช้งาน…</p>;
  if (!page.organizations.length)
    return (
      <section className="card">
        <EmptyState
          title="ไม่มีองค์กรที่หลับ"
          description={`ทุกองค์กรที่เปิดใช้มีทีมงานเข้าใช้ หรือมีเคสใหม่ ภายใน ${page.days} วันที่ผ่านมา`}
          icon="checkCircle"
        />
      </section>
    );
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>องค์กรที่หลับ</h2>
          <p>
            ไม่มีทีมงานเข้าใช้และไม่มีเคสใหม่ {page.days} วันขึ้นไป · ยังกินพื้นที่ และบัญชีที่ไม่มีใครดูแลเป็นช่องโหว่ ควรถามเจ้าของก่อน แล้วระงับถ้าไม่ใช้แล้ว
          </p>
        </div>
        <Icon name="clock" />
      </div>
      <ul className="dormant-list">
        {page.organizations.map((org) => {
          const customersWriting = org.last_customer_message && org.last_customer_message > org.asleep_since;
          return (
            <li key={org.id} className="dormant">
              <div className="dormant-head">
                <span className="dormant-name">
                  <strong>{org.name}</strong>
                  <small>{org.slug}</small>
                </span>
                <span className="dormant-days">หลับมา {number(daysSince(org.asleep_since))} วัน</span>
              </div>
              <dl className="dormant-facts">
                <div>
                  <dt>ทีมงานเข้าใช้ล่าสุด</dt>
                  <dd>{org.last_seen ? date(org.last_seen) : 'ไม่เคย'}</dd>
                </div>
                <div>
                  <dt>เคสใหม่ล่าสุด</dt>
                  <dd>{org.last_case ? date(org.last_case) : 'ไม่เคยมี'}</dd>
                </div>
                <div>
                  <dt>สมาชิก / เคสค้าง</dt>
                  <dd>
                    {number(org.members)} คน / {number(org.open_cases)} เคส
                  </dd>
                </div>
                <div>
                  <dt>พื้นที่ที่ใช้</dt>
                  <dd>{bytesText(org.used_bytes)}</dd>
                </div>
              </dl>
              {customersWriting && (
                <p className="dormant-warn">
                  <Icon name="chat" />
                  ลูกค้ายังทักเข้ามา ล่าสุด {relative(org.last_customer_message)} แต่ไม่มีทีมงานเข้ามาดู ควรติดต่อเจ้าของก่อนระงับ
                </p>
              )}
              <p className="dormant-admins">
                ผู้ดูแล: {org.admins.length ? org.admins.map((a) => `${a.name} (${a.email})`).join(', ') : 'ไม่มี'}
                {org.contacted && (
                  <span className="dormant-contacted">
                    {' '}
                    · ติดต่อแล้วเมื่อ {date(org.contacted.at, true)} โดย {org.contacted.by}
                  </span>
                )}
              </p>
              <div className="dormant-actions">
                <button type="button" className="btn sm" onClick={() => openModal(`ติดต่อผู้ดูแล ${org.name}`, <ContactForm org={org} mailReady={page.mail_ready} />)}>
                  <Icon name="mail" />
                  {org.contacted ? 'ติดต่ออีกครั้ง' : 'ติดต่อ'}
                </button>
                <button type="button" className="btn sm danger" onClick={() => openModal(`ระงับองค์กร ${org.name}`, <SuspendTenantForm id={org.id} name={org.name} />)}>
                  <Icon name="lock" />
                  ระงับ
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
