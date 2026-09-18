'use client';

import { useDialogs } from '@/components/ui/Dialogs';
import { FormActions, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { roleLabels } from '@/lib/labels';
import { useInvalidate } from '@/lib/query';
import { useWork } from '@/lib/session';
import type { Member } from '@/lib/types';
import { INVITATIONS_PATH, inviteMember, saveMember, WORKSPACE_PATH } from '../api';
import type { MemberBody } from '../types';

/* เชิญเพื่อนร่วมงาน / เพิ่มสมาชิกใหม่ / จัดการสมาชิก. A new colleague is invited by email and chooses their own password
   (backend invitations); only where the platform has no mailbox yet does the admin still set a first password.
   An existing member's role, team and access are changed here too. Markup: old-frontend/pages/settings/member.html. */

export function MemberForm({ member }: { member?: Member }) {
  const work = useWork();
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const existing = Boolean(member);
  // Without the platform's mailbox nothing can be sent, so the admin falls back to setting a first password.
  const inviting = !member && work.customer_email;
  // Like teamOptions(): an agent would only see their own team, but this screen is for admins.
  const teams = work.teams.filter((t) => work.role !== 'agent' || t.id === work.team_id);

  return (
    <Form
      data-id={member?.id ?? ''}
      onSubmit={async (values, form) => {
        if (inviting) {
          const answer = await inviteMember({ email: values.email ?? '', role: values.role ?? 'agent', team_id: values.team_id ?? '' });
          closeModal();
          toast(
            (answer as { sent?: boolean }).sent === false
              ? 'บันทึกคำเชิญแล้ว แต่ส่งอีเมลไม่สำเร็จ กรุณากด “ส่งอีกครั้ง” ในรายการคำเชิญ'
              : `ส่งคำเชิญถึง ${values.email} แล้ว`,
          );
          await refresh(INVITATIONS_PATH, WORKSPACE_PATH, '/api/audit');
          return;
        }
        const body: MemberBody = { role: values.role ?? 'agent', team_id: values.team_id ?? '' };
        if (member) body.active = (form.elements.namedItem('active') as HTMLInputElement).checked;
        else Object.assign(body, { name: values.name ?? '', email: values.email ?? '', password: values.password ?? '' });
        await saveMember(member?.id ?? null, body);
        closeModal();
        toast('บันทึกสมาชิกแล้ว');
        // Moving or suspending a member unassigns their cases outside the new team.
        await refresh(WORKSPACE_PATH, INVITATIONS_PATH, '/api/tickets', '/api/conversations');
      }}
    >
      {member ? (
        <p>
          {member.name} · {member.email}
        </p>
      ) : inviting ? (
        <>
          <div className="notice">
            ระบบจะส่งลิงก์ไปที่อีเมลนี้ เจ้าตัวเป็นผู้ตั้งชื่อและรหัสผ่านของตัวเอง คุณไม่ต้องรู้รหัสผ่านของใคร · ลิงก์มีอายุ 7 วัน
          </div>
          <div className="stack mb">
            <TextField id="f-email" label="อีเมลของเพื่อนร่วมงาน" name="email" type="email" max={254} autoFocus />
          </div>
        </>
      ) : (
        <>
          <div className="notice warning">
            ยังส่งคำเชิญทางอีเมลไม่ได้ เพราะแพลตฟอร์มยังไม่ได้ตั้งค่าอีเมลของระบบ ระหว่างนี้ให้ตั้งรหัสผ่านเริ่มต้นแล้วแจ้งเจ้าตัวโดยตรง และบอกให้เปลี่ยนรหัสผ่านทันทีที่เข้าใช้งาน
          </div>
          <div className="stack mb">
            <TextField id="f-name" label="ชื่อสมาชิก" name="name" max={100} />
            <TextField id="f-email" label="อีเมล" name="email" type="email" max={254} />
            <TextField id="f-password" label="รหัสผ่านเริ่มต้น" name="password" type="password" max={200} />
          </div>
        </>
      )}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="member-role">บทบาท</label>
          <select id="member-role" name="role" defaultValue={member?.role ?? 'agent'}>
            {Object.entries(roleLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="member-team">ทีม</label>
          <select id="member-team" name="team_id" defaultValue={member?.team_id || work.team_id || undefined}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        {existing && (
          <label className="check span-2">
            <input name="active" type="checkbox" className="switch" defaultChecked={Boolean(member?.active)} />
            อนุญาตให้เข้าใช้งานองค์กร
          </label>
        )}
      </div>
      <FormActions onCancel={() => closeModal()} label={inviting ? 'ส่งคำเชิญ' : 'บันทึก'} />
    </Form>
  );
}
