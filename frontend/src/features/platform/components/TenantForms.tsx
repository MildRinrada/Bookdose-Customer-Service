'use client';

import { useDialogs } from '@/components/ui/Dialogs';
import { FormActions, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import { useSwitchTenant } from '@/lib/session';
import { createTenant, PLATFORM_PREFIX, requestSupportAccess } from '../api';

/* The organizations page's two dialogs: a new organization (pages/platform/new-tenant.html) and a platform admin's
   request to enter one for support (pages/platform/support-access.html). */

export function TenantForm() {
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <Form
      data-form="tenant"
      onSubmit={async (values) => {
        await createTenant({
          name: values.name ?? '',
          slug: values.slug ?? '',
          admin_name: values.admin_name ?? '',
          email: values.email ?? '',
          password: values.password ?? '',
        });
        closeModal();
        toast('สร้างองค์กรเรียบร้อยแล้ว');
        // The admin may be the signed-in account, whose memberships then include the new organization.
        await refresh(PLATFORM_PREFIX, '/api/bootstrap');
      }}
    >
      <div className="notice">
        องค์กรใหม่มีพื้นที่ข้อมูลแยกของตัวเอง ระบุผู้ดูแลองค์กรด้านล่าง หากอีเมลมีบัญชีอยู่แล้ว ระบบจะใช้บัญชีเดิมและไม่เปลี่ยนรหัสผ่าน
      </div>
      <div className="form-grid">
        <TextField label="ชื่อองค์กร" name="name" max={100} />
        <TextField label="รหัสองค์กร (a-z, 0-9, -)" name="slug" max={60} />
        <TextField label="ชื่อผู้ดูแลองค์กร" name="admin_name" max={100} />
        <TextField label="อีเมลผู้ดูแล" name="email" type="email" max={254} />
        <div className="span-2">
          <TextField label="รหัสผ่านเริ่มต้น (กรอกสำหรับบัญชีใหม่)" name="password" type="password" required={false} max={200} />
        </div>
      </div>
      <FormActions label="สร้างองค์กร" onCancel={() => closeModal()} />
    </Form>
  );
}

export function SupportAccessForm({ id, name }: { id: string; name: string }) {
  const { closeModal } = useDialogs();
  const toast = useToast();
  const switchTenant = useSwitchTenant();
  return (
    <Form
      data-form="support-access"
      data-id={id}
      onSubmit={async (values) => {
        await requestSupportAccess(id, values.reason ?? '');
        closeModal();
        toast('เพิ่มสิทธิ์ Support Access และบันทึกใน audit log แล้ว');
        await switchTenant(id);
      }}
    >
      <p className="notice">
        ระบบจะเพิ่มคุณเป็นสมาชิกของ <strong>{name}</strong> ในบทบาทหัวหน้าทีม อ่านและตอบเคสได้ทุกทีม แต่แก้การตั้งค่าองค์กรไม่ได้ ชื่อของคุณและเหตุผลจะถูกบันทึกทั้งใน
        “ประวัติแพลตฟอร์ม” และ “ประวัติการทำงาน” ขององค์กรนั้น ผู้ดูแลองค์กรปิดสิทธิ์นี้ได้ทุกเมื่อจากหน้าจัดการสมาชิก
      </p>
      <TextField label="เหตุผลที่ต้องเข้าดูข้อมูล (เช่น เลขคำร้อง หรือปัญหาที่ต้องตรวจสอบ)" name="reason" max={300} />
      <FormActions label="ยืนยันและเข้าองค์กร" onCancel={() => closeModal()} />
    </Form>
  );
}
