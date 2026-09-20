'use client';

import { useState } from 'react';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { SelectField, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useApi, useInvalidate } from '@/lib/query';
import { saveRegistrationSettings } from '../api';
import type { RegistrationConfig } from '../types';

/* The platform console's card for the email that confirms organization sign-ups
   (modules/auth/registration-settings.html). Pass `config` when the console already has GET /api/platform/registration;
   without it the panel reads it itself. */

export function RegistrationSettingsPanel({ config }: { config?: RegistrationConfig }) {
  const loaded = useApi<RegistrationConfig>(config ? null : '/api/platform/registration');
  const current = config ?? loaded.data;
  if (!current) {
    if (loaded.error) return <ErrorState error={loaded.error} onRetry={() => void loaded.refetch()} />;
    return <PageLoading />;
  }
  return <RegistrationSettingsCard config={current} />;
}

function RegistrationSettingsCard({ config }: { config: RegistrationConfig }) {
  const toast = useToast();
  const refresh = useInvalidate();
  // The saved answer redraws the form from scratch, like the old page did after saving (the password box empties).
  const [saved, setSaved] = useState<{ config: RegistrationConfig; version: number } | null>(null);
  const cfg = saved?.config ?? config;
  return (
    <section className="card mt">
      <div className="card-header">
        <h2>อีเมลยืนยันการสมัครองค์กร</h2>
      </div>
      <div className="card-body">
        <p className="small muted">กล่องจดหมายที่ระบบใช้ส่งออกทั้งหมด และโดเมนที่ใช้สร้างลิงก์ในอีเมล · สองสวิตช์ด้านล่างแยกกัน</p>
        <Form
          key={saved?.version ?? 0}
          onSubmit={async (values, form) => {
            const result = await saveRegistrationSettings({
              enabled: (form.elements.namedItem('enabled') as HTMLInputElement).checked,
              signup_enabled: (form.elements.namedItem('signup_enabled') as HTMLInputElement).checked,
              public_base_url: values.public_base_url ?? '',
              address: values.address ?? '',
              smtp_host: values.smtp_host ?? '',
              smtp_port: Number(values.smtp_port),
              username: values.username ?? '',
              password: values.password ?? '',
            });
            setSaved((s) => ({ config: result, version: (s?.version ?? 0) + 1 }));
            await refresh('/api/platform/registration', '/api/bootstrap');
            toast('บันทึกอีเมลยืนยันแล้ว');
          }}
        >
          <div className="form-grid">
            <label className="check span-2">
              <input type="checkbox" className="switch" name="enabled" defaultChecked={cfg.enabled} />
              <span className="check-text">
                <strong>เปิดใช้อีเมลของระบบ</strong>
                <small>ส่งลิงก์ติดตามแชทให้ลูกค้า ยืนยันอีเมล ลืมรหัสผ่าน คำเชิญสมาชิก และแจ้งเตือนถึงเจ้าหน้าที่</small>
              </span>
            </label>
            <label className="check span-2">
              <input type="checkbox" className="switch" name="signup_enabled" defaultChecked={cfg.signup_enabled} />
              <span className="check-text">
                <strong>เปิดให้สมัครสร้างองค์กรใหม่เองจากหน้าเว็บ</strong>
                <small>ใครก็ตามที่เข้าถึงหน้าสมัครสร้างองค์กรของตัวเองได้ · ปิดไว้ถ้าต้องการให้ผู้ดูแลแพลตฟอร์มเป็นคนสร้างองค์กรเอง · ต้องเปิดอีเมลของระบบด้วย</small>
              </span>
            </label>
            <TextField
              label="โดเมนเว็บไซต์"
              name="public_base_url"
              defaultValue={cfg.public_base_url || ''}
              placeholder="https://support.example.com"
              max={500}
              required={false}
            />
            <TextField label="อีเมลผู้ส่ง" name="address" type="email" defaultValue={cfg.address || ''} max={254} required={false} />
            <TextField label="เซิร์ฟเวอร์ SMTP" name="smtp_host" defaultValue={cfg.smtp_host || ''} placeholder="smtp.example.com" max={253} required={false} />
            <SelectField label="พอร์ต SMTP" name="smtp_port" id="registration-port" defaultValue={cfg.smtp_port === 587 ? '587' : '465'}>
              <option value="465">465 · TLS</option>
              <option value="587">587 · STARTTLS</option>
            </SelectField>
            <TextField label="ชื่อผู้ใช้ SMTP" name="username" defaultValue={cfg.username || ''} max={500} required={false} />
            <TextField
              label="รหัสผ่าน SMTP / App Password"
              name="password"
              id="registration-password"
              type="password"
              max={2000}
              minLength={undefined}
              required={false}
              placeholder={cfg.has_password ? 'บันทึกไว้แล้ว เว้นว่างเพื่อใช้ค่าเดิม' : 'รหัสผ่านสำหรับส่งอีเมล'}
            />
          </div>
          <p className="tiny muted">
            หากเปลี่ยนเซิร์ฟเวอร์ พอร์ต หรือชื่อผู้ใช้ ต้องกรอกรหัสผ่านใหม่ ใช้บัญชีที่ผู้ให้บริการอนุญาตให้ส่งผ่าน SMTP ด้วยรหัสผ่าน / App Password
            การบันทึกยังไม่ได้ทดสอบส่งอีเมล
          </p>
          <button className="btn primary" type="submit">
            บันทึกอีเมลยืนยัน
          </button>
        </Form>
      </div>
    </section>
  );
}
