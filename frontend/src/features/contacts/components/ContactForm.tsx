'use client';

import { useCallback, useState } from 'react';
import { useDialogs } from '@/components/ui/Dialogs';
import { FormActions, TextField, useFieldValidation } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useOpenNewTicket } from '@/features/tickets/components/NewTicket';
import { useApi, useInvalidate } from '@/lib/query';
import { CONTACTS_PATH, saveContact } from '../api';
import { emailKey } from '../labels';
import type { Contact, ContactsPage, ContactValues } from '../types';

/* Adding or editing a customer (the old contactForm / contactModal): split first and last name, email, phone,
   organization and notes, with a warning (not a block) when the email already belongs to another customer.
   `thenTicket` opens the new-case dialog after saving. Markup: pages/contacts/contact-form. */

export function ContactForm({ contact = null, thenTicket = false }: { contact?: Contact | null; thenTicket?: boolean }) {
  const c = contact;
  const toast = useToast();
  const refresh = useInvalidate();
  const { closeModal } = useDialogs();
  const openNewTicket = useOpenNewTicket();
  const contacts = useApi<ContactsPage>(CONTACTS_PATH).data?.contacts ?? [];
  const [email, setEmail] = useState(c?.email || '');
  const notes = useFieldValidation();
  const key = email.trim().toLowerCase();
  const match = key ? contacts.find((x) => x.id !== c?.id && emailKey(x) === key) : undefined;
  return (
    <Form
      onSubmit={async (values) => {
        await saveContact(c?.id, values as ContactValues);
        closeModal();
        toast('บันทึกข้อมูลลูกค้าแล้ว');
        // The customer's name shows on the case list and case screens too.
        await refresh(CONTACTS_PATH, '/api/tickets');
        if (thenTicket) await openNewTicket();
      }}
    >
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
      <p className="small muted">ชื่อและนามสกุลเดิมยังคงอยู่ หากเป็นข้อมูลเก่า สามารถจัดแยกช่องได้โดยไม่สูญหาย</p>
      <FormActions onCancel={() => closeModal()} />
    </Form>
  );
}

/** The old contactModal: const contactModal = useContactModal(); contactModal(contact?, thenTicket?). */
export function useContactModal() {
  const { openModal } = useDialogs();
  return useCallback(
    (contact?: Contact | null, thenTicket = false) =>
      openModal(contact ? 'แก้ไขข้อมูลลูกค้า' : 'เพิ่มลูกค้าใหม่', <ContactForm contact={contact ?? null} thenTicket={thenTicket} />),
    [openModal],
  );
}

/** Same component under the old name, for modals opened by hand: openModal(title, <ContactModal contact thenTicket />). */
export const ContactModal = ContactForm;
