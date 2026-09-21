'use client';

import { useDialogs } from '@/components/ui/Dialogs';
import { FormActions, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import type { Team } from '@/lib/types';
import { createTeam, saveTeam, WORKSPACE_PATH } from '../api';

/* เพิ่มทีมใหม่, and changing one that exists. Editing keeps the team's id, so the cases, the members and the
   customers' categories stay with it and only the words on them change.
   Markup: old-frontend/pages/settings/new-team.html. */

export function TeamForm({ team }: { team?: Team }) {
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <Form
      onSubmit={async (values) => {
        const body = { name: values.name ?? '', description: values.description ?? '' };
        if (team) await saveTeam(team.id, body);
        else await createTeam(body);
        closeModal();
        toast(team ? 'บันทึกทีมแล้ว' : 'เพิ่มทีมแล้ว');
        await refresh(WORKSPACE_PATH);
      }}
    >
      {team && <p className="notice">เคส สมาชิก และหมวดเรื่องที่ลูกค้าเลือก ยังอยู่กับทีมนี้เหมือนเดิม</p>}
      <TextField id="f-name" label="ชื่อทีม" name="name" max={100} defaultValue={team?.name} />
      <div className="field">
        <label htmlFor="f-team-description">ทีมนี้ดูแลอะไร</label>
        <textarea
          id="f-team-description"
          name="description"
          rows={3}
          maxLength={300}
          defaultValue={typeof team?.description === 'string' ? team.description : ''}
          placeholder="เช่น ดูแลลูกค้าองค์กรและเรื่องที่ต้องคุยกับฝ่ายเทคนิค"
        />
        <span className="tiny muted">ไม่ใส่ก็ได้ · เห็นเฉพาะทีมงาน ลูกค้าไม่เห็น</span>
      </div>
      <FormActions label={team ? 'บันทึก' : 'เพิ่มทีม'} onCancel={() => closeModal()} />
    </Form>
  );
}
