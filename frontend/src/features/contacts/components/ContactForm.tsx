'use client';

import { useCallback, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { PageLoading } from '@/components/ui/display';
import { FormActions, TextField, useFieldValidation } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useOpenNewTicket } from '@/features/tickets/components/NewTicket';
import { date } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { contactProfilePath, CONTACTS_PATH, saveContact } from '../api';
import { consentLabels, emailKey, languageLabels, preferredChannelLabels } from '../labels';
import type { Contact, ContactProfile, ContactProfileView, ContactsPage, ContactValues } from '../types';
import { ContactChannels, TagInput } from './ContactProfileParts';

/* Adding or editing a customer (the old contactForm / contactModal): split first and last name, email, phone,
   organization, with a warning (not a block) when the email already belongs to another customer; then how the team
   looks after them - how and when they like to be contacted, the language to answer in, the team's own tags, a
   warning shown on their chats and cases, and notes; the channels they talked on (read only); consent to be
   contacted back and a data deletion request; and who edited last. `thenTicket` opens the new-case dialog after
   saving. Markup: pages/contacts/contact-form. */

export function ContactForm({ contact = null, thenTicket = false }: { contact?: Contact | null; thenTicket?: boolean }) {
  const c = contact;
  const toast = useToast();
  const refresh = useInvalidate();
  const { closeModal } = useDialogs();
  const openNewTicket = useOpenNewTicket();
  const contacts = useApi<ContactsPage>(CONTACTS_PATH).data?.contacts ?? [];
  const view = useApi<ContactProfileView>(c ? contactProfilePath(c.id) : null).data;
  const [email, setEmail] = useState(c?.email || '');
  const notes = useFieldValidation();
  const key = email.trim().toLowerCase();
  const match = key ? contacts.find((x) => x.id !== c?.id && emailKey(x) === key) : undefined;
  // The list row carries the profile; opened from elsewhere, the form waits for it.
  const profile: ContactProfile | null | undefined = c ? (c.profile !== undefined ? c.profile : view?.profile) : null;
  if (c && profile === undefined) return <PageLoading />;
  return <ContactFormBody c={c} p={profile ?? null} view={view} contacts={contacts} match={match} setEmail={setEmail} notes={notes} onSaved={async () => {
    closeModal();
    toast('บันทึกข้อมูลลูกค้าแล้ว');
    // The customer's name shows on the case list and case screens too, the profile on chats and cases.
    await refresh(CONTACTS_PATH, '/api/tickets');
    if (thenTicket) await openNewTicket();
  }} onCancel={() => closeModal()} />;
}

function ContactFormBody({
  c,
  p,
  view,
  contacts,
  match,
  setEmail,
  notes,
  onSaved,
  onCancel,
}: {
  c: Contact | null;
  p: ContactProfile | null;
  view: ContactProfileView | undefined;
  contacts: Contact[];
  match: Contact | undefined;
  setEmail: (value: string) => void;
  notes: ReturnType<typeof useFieldValidation>;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [tags, setTags] = useState<string[]>(p?.tags ?? []);
  const [consent, setConsent] = useState<string>(p?.consent ?? '');
  const [deletion, setDeletion] = useState(Boolean(p?.deletion_requested_at));
  // The tags the team already uses, most used first.
  const used = new Map<string, number>();
  contacts.forEach((x) => x.profile?.tags.forEach((t) => used.set(t, (used.get(t) ?? 0) + 1)));
  const suggestions = [...used].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const edited = view?.last_edit;

  return (
    <Form
      className="contact-form"
      onSubmit={async (values) => {
        const body: ContactValues = { ...(values as unknown as ContactValues), tags, consent, deletion_requested: deletion };
        await saveContact(c?.id, body);
        await onSaved();
      }}
    >
      <section className="contact-form-section">
        <h3>ข้อมูลติดต่อ</h3>
        <div className="form-grid">
          <div className="form-grid">
            <TextField label="ชื่อ" name="first_name" defaultValue={c?.first_name ?? c?.name ?? ''} placeholder="เช่น สมชาย" max={100} personName />
            <TextField label="นามสกุล" name="last_name" defaultValue={c?.last_name || ''} placeholder="เช่น ใจดี" required={false} max={100} personName />
          </div>
          <TextField
            label="อีเมล"
            name="email"
            type="email"
            defaultValue={c?.email || ''}
            placeholder="name@example.com"
            required={false}
            max={254}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextField label="โทรศัพท์" name="phone" type="tel" defaultValue={c?.phone || ''} placeholder="081-234-5678" required={false} max={40} />
          <TextField label="องค์กร / บริษัท" name="company" defaultValue={c?.company || ''} placeholder="เช่น บริษัท บุ๊คโดส จำกัด" required={false} max={150} />
          <p className="notice warning span-2" data-duplicate-warning="" role="status" hidden={!match}>
            {match ? `มีลูกค้า “${match.name}” ใช้อีเมลนี้อยู่แล้ว ตรวจสอบก่อนบันทึกเพื่อไม่ให้ข้อมูลซ้ำ` : ''}
          </p>
        </div>
      </section>

      <section className="contact-form-section">
        <h3>การดูแลลูกค้า</h3>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="contact-channel">ช่องทางที่ลูกค้าสะดวก</label>
            <select id="contact-channel" name="preferred_channel" defaultValue={p?.preferred_channel ?? ''}>
              <option value="">ไม่ระบุ</option>
              {Object.entries(preferredChannelLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <TextField label="ช่วงเวลาที่สะดวก" name="contact_hours" defaultValue={p?.contact_hours ?? ''} placeholder="เช่น หลัง 18:00 หรือ จ.-ศ. 9:00-12:00" required={false} max={80} />
          <div className="field">
            <label htmlFor="contact-language">ภาษาที่ใช้ตอบ</label>
            <select id="contact-language" name="language" defaultValue={p?.language ?? ''}>
              <option value="">ตามที่ลูกค้าเขียนมา</option>
              {Object.entries(languageLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <span className="field-hint">AI จะตอบลูกค้ารายนี้เป็นภาษานี้ด้วย</span>
          </div>
          <div className="field">
            <label htmlFor="contact-tags">แท็กของทีม</label>
            <TagInput value={tags} onChange={setTags} suggestions={suggestions} />
          </div>
          <div className="field span-2 warning-field">
            <label htmlFor="contact-warning">
              <Icon name="bell" />
              คำเตือนถึงทีม
            </label>
            <textarea
              id="contact-warning"
              name="warning"
              rows={2}
              maxLength={300}
              defaultValue={p?.warning ?? ''}
              placeholder="แสดงเด่นบนหน้าแชทและหน้าเคส เช่น ลูกค้าเคยร้องเรียนเรื่องการตอบช้า ควรตอบภายใน 1 ชั่วโมง"
            />
          </div>
          <div className="field span-2">
            <label htmlFor="contact-notes">หมายเหตุ</label>
            <textarea
              id="contact-notes"
              name="notes"
              maxLength={3000}
              placeholder="ข้อมูลเพิ่มเติมที่ช่วยในการดูแลลูกค้า"
              defaultValue={c?.notes || ''}
              {...notes.bind}
            />
            {notes.errorNode}
          </div>
        </div>
      </section>

      {c && (
        <section className="contact-form-section">
          <h3>ช่องทางที่เชื่อมต่อ</h3>
          <ContactChannels view={view} />
        </section>
      )}

      <section className="contact-form-section">
        <h3>ความยินยอม (PDPA)</h3>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="contact-consent">การติดต่อกลับ</label>
            <select id="contact-consent" value={consent} onChange={(e) => setConsent(e.target.value)}>
              {Object.entries(consentLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {p?.consent && consent === p.consent && p.consent_at && (
              <span className="field-hint">
                บันทึกโดย {p.consent_by} · {date(p.consent_at, true)}
              </span>
            )}
          </div>
          <div className="field">
            <span className="field-label">คำขอลบข้อมูล</span>
            <label className={`deletion-check${deletion ? ' on' : ''}`}>
              <input type="checkbox" checked={deletion} onChange={(e) => setDeletion(e.target.checked)} />
              <span>
                ลูกค้าขอให้ลบข้อมูลส่วนตัว
                {deletion && p?.deletion_requested_at && (
                  <small>
                    แจ้งโดย {p.deletion_requested_by} · {date(p.deletion_requested_at, true)}
                  </small>
                )}
              </span>
            </label>
          </div>
          {deletion && (
            <p className="notice warning span-2">
              ทีมจะเห็นป้าย “ขอให้ลบข้อมูล” ที่ลูกค้ารายนี้ · ลบได้จากปุ่มลบในรายชื่อลูกค้า เมื่อจัดการเคสและบทสนทนาของลูกค้าแล้ว (ระบบไม่ลบประวัติเคสโดยอัตโนมัติ)
            </p>
          )}
        </div>
      </section>

      {c && (
        <p className="small muted contact-last-edit">
          <Icon name="clock" />
          {edited
            ? `${edited.action === 'contact.created' ? 'เพิ่มโดย' : edited.action === 'contact.merged' ? 'รวมข้อมูลล่าสุดโดย' : 'แก้ไขล่าสุดโดย'} ${edited.actor} · ${date(edited.created_at, true)}`
            : `เพิ่มเข้าระบบ ${date(c.created_at, true)}`}
        </p>
      )}
      <FormActions onCancel={onCancel} />
    </Form>
  );
}

/** The old contactModal: const contactModal = useContactModal(); contactModal(contact?, thenTicket?). */
export function useContactModal() {
  const { openModal } = useDialogs();
  return useCallback(
    (contact?: Contact | null, thenTicket = false) =>
      openModal(contact ? 'แก้ไขข้อมูลลูกค้า' : 'เพิ่มลูกค้าใหม่', <ContactForm contact={contact ?? null} thenTicket={thenTicket} />, { wide: true }),
    [openModal],
  );
}

/** Same component under the old name, for modals opened by hand: openModal(title, <ContactModal contact thenTicket />). */
export const ContactModal = ContactForm;
