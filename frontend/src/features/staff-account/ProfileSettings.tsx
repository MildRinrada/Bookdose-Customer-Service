'use client';

import { Icon } from '@/components/Icon';
import { TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { PhotoPicker } from '@/components/ui/PhotoPicker';
import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import { useBoot, useStaffLogout } from '@/lib/session';
import { saveStaffProfile } from './api';

/* ตั้งค่าบัญชี → ข้อมูลส่วนตัว: the picture and name every team the member works with sees, the email they sign in
   with, and signing out (as a customer's, features/customer/settings/ProfileSettings.tsx). */

export function ProfileSettings() {
  const boot = useBoot().data!;
  const user = boot.user!;
  const refresh = useInvalidate();
  const toast = useToast();
  const logout = useStaffLogout();

  return (
    <div className="account-section">
      <section className="card">
        <div className="card-header">
          <div>
            <h2>ข้อมูลส่วนตัว</h2>
            <p>รูปและชื่อที่ทีมงานและลูกค้าเห็นในทุกองค์กรที่คุณทำงานด้วย</p>
          </div>
        </div>
        <Form
          key={`${user.name}|${boot.avatar.length}`}
          className="card-body"
          data-form="staff-profile"
          onSubmit={async (values) => {
            await saveStaffProfile({ name: values.name ?? '', avatar: values.avatar || '' });
            await refresh('/api/bootstrap', '/api/workspace');
            toast('บันทึกข้อมูลแล้ว');
          }}
        >
          <PhotoPicker value={boot.avatar} personName={user.name} />
          <div className="field">
            <span className="file-field-title">อีเมลที่ใช้เข้าสู่ระบบ</span>
            <div className="customer-email">
              <strong>{user.email}</strong>
              {user.platform_admin && (
                <span className="badge resolved">
                  <Icon name="globe" />
                  ผู้ดูแลแพลตฟอร์ม
                </span>
              )}
            </div>
            <p className="tiny muted">เปลี่ยนอีเมลไม่ได้ หากต้องใช้อีเมลใหม่ ให้ผู้ดูแลองค์กรเชิญอีเมลนั้นเข้าทีม</p>
          </div>
          <TextField label="ชื่อที่แสดง" name="name" defaultValue={user.name} max={100} personName />
          <button className="btn primary" type="submit">
            <Icon name="check" />
            บันทึกข้อมูล
          </button>
        </Form>
      </section>
      <section className="card">
        <div className="card-header">
          <div>
            <h2>ออกจากระบบ</h2>
            <p>ออกจากบัญชีนี้บนอุปกรณ์ที่ใช้อยู่ อุปกรณ์อื่นดูและออกจากระบบได้ที่หมวดความปลอดภัย</p>
          </div>
        </div>
        <div className="card-body">
          <button className="btn danger" type="button" onClick={() => void logout().catch((error: Error) => toast(error.message, true))}>
            <Icon name="logout" />
            ออกจากระบบบนอุปกรณ์นี้
          </button>
        </div>
      </section>
    </div>
  );
}
