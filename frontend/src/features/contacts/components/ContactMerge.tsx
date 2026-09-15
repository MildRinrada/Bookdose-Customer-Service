'use client';

import { useDialogs } from '@/components/ui/Dialogs';
import { FormActions } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { date } from '@/lib/format';
import { useInvalidate } from '@/lib/query';
import { CONTACTS_PATH, mergeContacts } from '../api';
import type { ContactStats } from '../labels';
import type { Contact } from '../types';

/** Merging contacts that share an email (the old mergeContacts): pick the one to keep; the others' cases and
    conversations move to it and they are deleted. `group` is oldest first. Markup: pages/contacts/contact-merge,
    contact-merge-option. */
export function ContactMerge({ group, stats }: { group: Contact[]; stats: Map<string, ContactStats> }) {
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const ids = group.map((c) => c.id);
  return (
    <Form
      onSubmit={async (values) => {
        await mergeContacts(values.target_id, ids.filter((id) => id !== values.target_id));
        closeModal();
        toast('รวมข้อมูลลูกค้าเป็นรายชื่อเดียวแล้ว');
        await refresh(CONTACTS_PATH, '/api/tickets', '/api/conversations');
      }}
    >
      <p className="notice warning">
        ลูกค้าเหล่านี้ใช้อีเมล <strong>{group[0]?.email}</strong> เดียวกัน เลือกรายชื่อที่จะเก็บไว้ เคสและบทสนทนาของรายชื่ออื่นจะย้ายมารวมที่รายชื่อนี้
        แล้วรายชื่ออื่นจะถูกลบ การรวมย้อนกลับไม่ได้
      </p>
      <fieldset className="merge-options">
        <legend>เก็บรายชื่อนี้ไว้</legend>
        {group.map((c, i) => {
          const details = [c.phone, c.company].filter(Boolean).join(' · ');
          return (
            <label key={c.id} className="merge-option">
              <input type="radio" name="target_id" value={c.id} defaultChecked={i === 0} required />
              <span>
                <strong>{c.name}</strong>
                <span className="muted">
                  เพิ่มเมื่อ {date(c.created_at)} · {stats.get(c.id)?.total ?? 0} เคส{details && ` · ${details}`}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <p className="small muted">ช่องที่ว่างของรายชื่อที่เก็บไว้ (อีเมล โทรศัพท์ องค์กร) จะเติมจากรายชื่ออื่น และหมายเหตุจะนำมารวมกัน</p>
      <FormActions label="รวมเป็นรายชื่อเดียว" onCancel={() => closeModal()} />
    </Form>
  );
}
