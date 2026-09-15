'use client';

import { useDialogs } from '@/components/ui/Dialogs';
import { FormActions, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { roleLabels } from '@/lib/labels';
import { useInvalidate } from '@/lib/query';
import { useWork } from '@/lib/session';
import type { Member } from '@/lib/types';
import { saveMember, WORKSPACE_PATH } from '../api';
import type { MemberBody } from '../types';

/* เพิ่มสมาชิกใหม่ / จัดการสมาชิก: a new account (name, email, first password) or a member's role, team and access.
   Markup: old-frontend/pages/settings/member.html. */

export function MemberForm({ member }: { member?: Member }) {
  const work = useWork();
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const existing = Boolean(member);
  // Like teamOptions(): an agent would only see their own team, but this screen is for admins.
  const teams = work.teams.filter((t) => work.role !== 'agent' || t.id === work.team_id);

  return (
    <Form
      data-id={member?.id ?? ''}
      onSubmit={async (values, form) => {
        const body: MemberBody = { role: values.role ?? 'agent', team_id: values.team_id ?? '' };
        if (member) body.active = (form.elements.namedItem('active') as HTMLInputElement).checked;
        else Object.assign(body, { name: values.name ?? '', email: values.email ?? '', password: values.password ?? '' });
        await saveMember(member?.id ?? null, body);
        closeModal();
        toast('บันทึกสมาชิกแล้ว');
        // Moving or suspending a member unassigns their cases outside the new team.
        await refresh(WORKSPACE_PATH, '/api/tickets', '/api/conversations');
      }}
    >
      {member ? (
        <p>
          {member.name} · {member.email}
        </p>
      ) : (
        <>
          <div className="notice">สร้างบัญชีให้สมาชิกใหม่ แล้วแจ้งอีเมลและรหัสผ่านให้เจ้าตัวโดยตรง ระบบรุ่นนี้ไม่ส่งอีเมลเชิญ</div>
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
            <input name="active" type="checkbox" defaultChecked={Boolean(member?.active)} />
            อนุญาตให้เข้าใช้งานองค์กร
          </label>
        )}
      </div>
      <FormActions onCancel={() => closeModal()} />
    </Form>
  );
}
