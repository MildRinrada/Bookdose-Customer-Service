'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { PhotoPicker } from '@/components/ui/PhotoPicker';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api/client';
import { useInvalidate } from '@/lib/query';
import { useBoot, useStaffLogout } from '@/lib/session';

/* "จัดการบัญชี": the staff member's picture and name, their password, the way to two-factor sign-in and passkeys,
   and signing out. */

export function AccountDialog() {
  const boot = useBoot().data!;
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const logout = useStaffLogout();
  return (
    <div className="profile-editor">
      <Form
        onSubmit={async (values) => {
          await api('/api/account/profile', { name: values.name, avatar: values.avatar || '' });
          closeModal(true);
          await refresh('/api/bootstrap', '/api/workspace');
          toast('บันทึกโปรไฟล์แล้ว');
        }}
      >
        <PhotoPicker value={boot.avatar} personName={boot.user?.name ?? ''} />
        <TextField label="ชื่อที่แสดง" name="name" defaultValue={boot.user?.name} max={100} />
        <button className="btn primary" type="submit">
          บันทึกโปรไฟล์
        </button>
      </Form>
      <hr />
      <Form
        onSubmit={async (values) => {
          await api('/api/account/password', values);
          closeModal();
          await refresh('/api/bootstrap');
          toast('เปลี่ยนรหัสผ่านและออกจากเซสชันอื่นแล้ว');
        }}
      >
        <TextField label="รหัสผ่านเดิม" name="current_password" type="password" max={200} autoComplete="current-password" minLength={undefined} />
        <TextField label="รหัสผ่านใหม่" name="password" type="password" max={200} />
        <button className="btn" type="submit">
          เปลี่ยนรหัสผ่าน
        </button>
      </Form>
      <Link className="btn" href="/account/security" onClick={() => closeModal()}>
        <Icon name="shield" />
        การยืนยันสองขั้นตอนและ Passkey
      </Link>
      <button type="button" className="btn danger" onClick={() => void logout().catch((error: Error) => toast(error.message, true))}>
        ออกจากระบบ
      </button>
    </div>
  );
}
