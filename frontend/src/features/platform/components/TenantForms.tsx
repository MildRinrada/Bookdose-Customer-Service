'use client';

import { useDialogs } from '@/components/ui/Dialogs';
import { FormActions, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import { createTenant, PLATFORM_PREFIX, requestSupportAccess, setTenantStatus } from '../api';

/* The organizations page's dialogs: a new organization (pages/platform/new-tenant.html), a platform admin's request
   to enter one for support (pages/platform/support-access.html), and suspending one. */

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

/** Suspending stops everything of the organization at once, so its name (or CONFIRM) is typed first, like the
    server asks. */
export function SuspendTenantForm({ id, name }: { id: string; name: string }) {
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <Form
      data-form="suspend-tenant"
      data-id={id}
      onSubmit={async (values) => {
        await setTenantStatus(id, 'suspended', (values.confirmation ?? '').trim());
        closeModal();
        toast(`ระงับ ${name} แล้ว`);
        // The signed-in account may work in it: its workspace list changes too.
        await refresh(PLATFORM_PREFIX, '/api/bootstrap');
      }}
    >
      <div className="notice warning">
        <p>
          เมื่อระงับ <strong>{name}</strong> จะมีผลทันที:
        </p>
        <ul>
          <li>ทีมงานขององค์กรเข้าพื้นที่ทำงานไม่ได้</li>
          <li>หน้าลูกค้า แชทผู้เยี่ยมชม และลิงก์เชิญเปิดไม่ได้ ลูกค้าไม่เห็นองค์กรนี้ในรายการ</li>
          <li>รับข้อความจาก LINE / Facebook ไม่ได้ และหยุดส่งข้อความกับงาน AI ที่ค้างอยู่</li>
        </ul>
        <p>ข้อมูลทั้งหมดยังเก็บไว้ครบ กด “เปิดใช้งานอีกครั้ง” ได้ภายหลัง</p>
      </div>
      <TextField label={`พิมพ์ชื่อองค์กร “${name}” หรือ CONFIRM เพื่อยืนยัน`} name="confirmation" max={100} autoComplete="off" />
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => closeModal()}>
          ยกเลิก
        </button>
        <button className="btn danger" type="submit">
          ระงับองค์กร
        </button>
      </div>
    </Form>
  );
}

export function SupportAccessForm({ id, name }: { id: string; name: string }) {
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <Form
      data-form="support-access"
      data-id={id}
      onSubmit={async (values) => {
        await requestSupportAccess(id, values.reason ?? '', Number(values.hours));
        closeModal();
        toast(`ส่งคำขอถึงผู้ดูแล ${name} แล้ว · เข้าได้เมื่อได้รับอนุมัติ`);
        await refresh(PLATFORM_PREFIX);
      }}
    >
      <p className="notice">
        คำขอจะส่งถึงผู้ดูแลของ <strong>{name}</strong> ทางอีเมลและในหน้าตั้งค่าองค์กร คุณยังเข้าไม่ได้จนกว่าผู้ดูแลองค์กรจะอนุมัติ เมื่ออนุมัติแล้ว
        คุณจะเป็นหัวหน้าทีมชั่วคราว อ่านและตอบเคสได้ทุกทีม แต่แก้การตั้งค่าองค์กรไม่ได้ และสิทธิ์จะหมดเองเมื่อครบเวลา ผู้ดูแลองค์กรหยุดสิทธิ์ได้ทุกเมื่อ
        ทุกขั้นตอนบันทึกทั้งใน “ประวัติแพลตฟอร์ม” และ “ประวัติการทำงาน” ขององค์กร
      </p>
      <TextField label="เหตุผลที่ต้องเข้าดูข้อมูล (เช่น เลขคำร้อง หรือปัญหาที่ต้องตรวจสอบ)" name="reason" max={300} />
      <div className="field">
        <label htmlFor="support-request-hours">ขอใช้งานเป็นเวลา</label>
        <select id="support-request-hours" name="hours" defaultValue="4">
          {[1, 4, 8, 24, 72].map((h) => (
            <option key={h} value={h}>
              {h} ชั่วโมง
            </option>
          ))}
        </select>
        <small className="muted">ผู้ดูแลองค์กรอนุมัติได้เท่ากับหรือน้อยกว่าที่ขอ คำขอที่ไม่มีใครตัดสินภายใน 24 ชั่วโมงจะหมดอายุเอง</small>
      </div>
      <FormActions label="ส่งคำขอ" onCancel={() => closeModal()} />
    </Form>
  );
}
