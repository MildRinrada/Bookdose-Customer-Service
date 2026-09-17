'use client';

import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { SelectField, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import { revokeSessions, SECURITY_PREFIX } from '../api';

/* "ยุติเซสชันทั้งหมดของบัญชี": every device signed in with one staff or customer account is signed out at once (a
   lost phone, a shared password). Asks before it runs. */

export function RevokeSessionsCard() {
  const { confirm } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <section className="card security-card" id="security-revoke" aria-labelledby="security-revoke-title">
      <div className="card-header">
        <div>
          <h2 id="security-revoke-title">ยุติเซสชันทั้งหมดของบัญชี</h2>
          <p>ออกจากระบบทุกอุปกรณ์ของบัญชีเดียว เจ้าของบัญชีต้องเข้าสู่ระบบใหม่</p>
        </div>
        <Icon name="logout" />
      </div>
      <Form
        className="card-body"
        data-form="security-revoke"
        onSubmit={(values, form) => {
          const actor = values.actor === 'customer' ? 'customer' : 'staff';
          const subject = (values.subject ?? '').trim();
          confirm({
            title: 'ยุติเซสชันทั้งหมด',
            message: `${subject} (${actor === 'staff' ? 'ทีมงาน' : 'ลูกค้า'}) จะถูกออกจากระบบทุกอุปกรณ์ทันที`,
            confirmLabel: 'ยุติเซสชัน',
            tone: 'danger',
            run: async () => {
              const { revoked } = await revokeSessions({ actor, subject });
              form.reset();
              toast(revoked ? `ยุติแล้ว ${revoked} เซสชัน` : 'บัญชีนี้ไม่มีเซสชันที่เปิดอยู่');
              await refresh(`${SECURITY_PREFIX}/events`);
            },
          });
        }}
      >
        <div className="security-revoke-grid">
          <SelectField label="ประเภทบัญชี" name="actor" required defaultValue="staff">
            <option value="staff">ทีมงานองค์กร / ผู้ดูแลแพลตฟอร์ม</option>
            <option value="customer">ลูกค้า</option>
          </SelectField>
          <TextField label="อีเมลของบัญชี" name="subject" type="email" max={254} placeholder="name@example.com" autoComplete="off" />
        </div>
        <div className="security-form-end">
          <button type="submit" className="btn danger">
            <Icon name="logout" />
            ยุติเซสชันทั้งหมด
          </button>
        </div>
      </Form>
    </section>
  );
}
