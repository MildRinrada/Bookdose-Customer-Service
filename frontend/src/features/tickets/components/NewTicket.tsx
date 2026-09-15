'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Combobox } from '@/components/ui/Combobox';
import { useDialogs } from '@/components/ui/Dialogs';
import { FormActions, RequiredStar, TextField, useFieldValidation } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { CONTACTS_PATH, fetchContacts } from '@/features/contacts/api';
import { ContactForm } from '@/features/contacts/components/ContactForm';
import type { Contact } from '@/features/contacts/types';
import { priorityLabels } from '@/lib/labels';
import { useInvalidate } from '@/lib/query';
import { useWork } from '@/lib/session';
import { createTicket, TICKET_PREFIXES } from '../api';
import type { NewTicket } from '../types';
import { initialTeam, MemberPicker, TeamOptions } from '@/components/ui/pickers';

/* Opening a case by hand (the old openNewTicket): subject, customer, priority, category, team, owner and a first
   internal note. With no customers yet, the customer form comes first and opens this one after saving.
   Markup: pages/tickets/new-ticket, new-ticket-button. */

export function NewTicketForm({ contacts, contactId = '' }: { contacts: Contact[]; contactId?: string }) {
  const work = useWork();
  const router = useRouter();
  const toast = useToast();
  const refresh = useInvalidate();
  const { closeModal, openModal } = useDialogs();
  const [team, setTeam] = useState(() => initialTeam(work, work.team_id));
  const subject = useFieldValidation();
  const body = useFieldValidation();
  return (
    <Form
      onSubmit={async (values) => {
        if (!values.contact_id) throw new Error('กรุณาเลือกลูกค้าจากรายการ');
        const result = await createTicket(values as NewTicket);
        closeModal();
        router.push(`/tickets/${result.id}`);
        toast('เปิดเคสเรียบร้อยแล้ว');
        await refresh(...TICKET_PREFIXES);
      }}
    >
      <div className="form-grid">
        <div className="field span-2">
          <label htmlFor="new-subject">
            เรื่องที่ต้องการให้ช่วยเหลือ
            <RequiredStar />
          </label>
          <input id="new-subject" name="subject" required maxLength={300} placeholder="สรุปเรื่องให้ทีมเข้าใจได้ง่าย" {...subject.bind} />
          {subject.errorNode}
        </div>
        <div className="field span-2">
          <label htmlFor="new-contact">
            ลูกค้า
            <RequiredStar />
          </label>
          <Combobox
            id="new-contact"
            name="contact_id"
            value={contactId}
            placeholder="พิมพ์ชื่อ อีเมล หรือองค์กรเพื่อค้นหา"
            items={contacts.map((c) => ({ value: c.id, label: c.name, detail: [c.company, c.email].filter(Boolean).join(' · ') }))}
          />
          <button type="button" className="btn subtle" onClick={() => openModal('เพิ่มลูกค้าใหม่', <ContactForm thenTicket />)}>
            + เพิ่มลูกค้าใหม่
          </button>
        </div>
        <div className="field">
          <label htmlFor="new-priority">ความเร่งด่วน</label>
          <select id="new-priority" name="priority" defaultValue="normal">
            {Object.entries(priorityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <TextField label="หมวดหมู่" name="category" defaultValue="ทั่วไป" max={80} />
        <div className="field">
          <label htmlFor="new-team">ทีมรับผิดชอบ</label>
          <select id="new-team" name="team_id" value={team} onChange={(e) => setTeam(e.target.value)}>
            <TeamOptions />
          </select>
        </div>
        <div className="field">
          <label htmlFor="new-assignee">ผู้รับผิดชอบ</label>
          <MemberPicker id="new-assignee" teamId={team} />
        </div>
        <div className="field span-2">
          <label htmlFor="new-body">รายละเอียด / บันทึกภายใน</label>
          <textarea id="new-body" name="body" maxLength={20000} placeholder="รายละเอียดปัญหาและข้อมูลที่ทีมควรทราบ" {...body.bind} />
          {body.errorNode}
        </div>
      </div>
      <FormActions label="เปิดเคส" onCancel={() => closeModal()} />
    </Form>
  );
}

/** const openNewTicket = useOpenNewTicket(); openNewTicket(contactId?) - reads the customers again, then opens the
    new-case dialog (with that customer chosen), or the customer form first when there are none yet. */
export function useOpenNewTicket() {
  const client = useQueryClient();
  const toast = useToast();
  const { openModal } = useDialogs();
  return useCallback(
    async (contactId = '') => {
      try {
        const data = await fetchContacts();
        client.setQueryData([CONTACTS_PATH], data);
        if (!data.contacts.length) openModal('เพิ่มลูกค้าใหม่', <ContactForm thenTicket />);
        else openModal('เปิดเคสบริการใหม่', <NewTicketForm contacts={data.contacts} contactId={contactId} />);
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), true);
      }
    },
    [client, toast, openModal],
  );
}

/** "เปิดเคสใหม่" (the case list, the overview). */
export function NewTicketButton() {
  const openNewTicket = useOpenNewTicket();
  return (
    <button type="button" className="btn primary" onClick={() => void openNewTicket()}>
      <Icon name="plus" />
      เปิดเคสใหม่
    </button>
  );
}
