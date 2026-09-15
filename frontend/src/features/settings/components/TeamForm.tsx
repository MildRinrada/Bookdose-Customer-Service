'use client';

import { useDialogs } from '@/components/ui/Dialogs';
import { FormActions, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import { createTeam, WORKSPACE_PATH } from '../api';

/* เพิ่มทีมใหม่. Markup: old-frontend/pages/settings/new-team.html. */

export function TeamForm() {
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <Form
      onSubmit={async (values) => {
        await createTeam(values.name ?? '');
        closeModal();
        toast('เพิ่มทีมแล้ว');
        await refresh(WORKSPACE_PATH);
      }}
    >
      <TextField id="f-name" label="ชื่อทีม" name="name" max={100} />
      <FormActions label="เพิ่มทีม" onCancel={() => closeModal()} />
    </Form>
  );
}
