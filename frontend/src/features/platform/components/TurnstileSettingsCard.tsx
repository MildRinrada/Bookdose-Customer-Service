'use client';

import { useState } from 'react';
import { TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useApi, useInvalidate } from '@/lib/query';
import { saveTurnstileSettings, TURNSTILE_PATH } from '../api';
import type { TurnstileSettings } from '../types';

/* Platform console → ตั้งค่าระบบ (#turnstile): the bot check on the public support form (GET/POST
   /api/platform/turnstile, backend/extensions/turnstile.py). The Site Key is public and goes to the page that draws
   the widget; the Secret Key is sealed on the server and never shown again, so leaving it empty keeps what was saved.
   While this is off, the support form works exactly as before. */

const HELP = 'https://dash.cloudflare.com/?to=/:account/turnstile';

export function TurnstileSettingsCard() {
  const { data, error } = useApi<TurnstileSettings>(TURNSTILE_PATH);
  return (
    <section className="card system-section">
      <div className="card-header">
        <div>
          <h2>ตรวจบอทหน้าติดต่อ (Cloudflare Turnstile)</h2>
          <p>ผู้เยี่ยมชมที่เริ่มแชทจากหน้าติดต่อต้องผ่านการตรวจว่าไม่ใช่บอทก่อน ส่วนใหญ่ผ่านเองโดยไม่ต้องกดอะไร</p>
        </div>
      </div>
      <div className="card-body">
        {error ? (
          <p className="notice warning">{error.message}</p>
        ) : !data ? (
          <p className="muted">กำลังโหลด…</p>
        ) : (
          <TurnstileForm key={`${data.enabled}:${data.site_key}:${data.configured}`} data={data} />
        )}
        <p className="tiny muted mt">
          สร้างวิดเจ็ตได้ที่{' '}
          <a href={HELP} target="_blank" rel="noopener noreferrer">
            Cloudflare → Turnstile
          </a>{' '}
          (ใช้ฟรี) แล้วใส่โดเมนของระบบนี้ในช่อง Hostnames · Secret Key ถูกเข้ารหัสเก็บบนเซิร์ฟเวอร์ และไม่แสดงซ้ำ · ถ้า Cloudflare ตอบไม่ได้ชั่วคราว ระบบจะปล่อยให้ส่งฟอร์มได้ตามปกติ
          และบันทึกเหตุการณ์ไว้ในหน้าความปลอดภัย
        </p>
      </div>
    </section>
  );
}

function TurnstileForm({ data }: { data: TurnstileSettings }) {
  const toast = useToast();
  const refresh = useInvalidate();
  const [enabled, setEnabled] = useState(data.enabled);
  const keep = data.configured ? 'เว้นว่างไว้เพื่อใช้ค่าที่บันทึกไว้' : undefined;

  return (
    <Form
      className="stack"
      onSubmit={async (values) => {
        await saveTurnstileSettings({ enabled, site_key: values.site_key ?? '', secret: values.secret ?? '' });
        toast(enabled ? 'เปิดการตรวจบอทหน้าติดต่อแล้ว' : 'ปิดการตรวจบอทหน้าติดต่อแล้ว');
        await refresh(TURNSTILE_PATH);
      }}
    >
      <div className="form-grid">
        <label className="check span-2">
          <input type="checkbox" className="switch" name="enabled" checked={enabled} onChange={(event) => setEnabled(event.currentTarget.checked)} />
          เปิดการตรวจบอทบนฟอร์มเริ่มแชท (ต้องใส่ทั้งสองคีย์ก่อน)
        </label>
        <TextField
          id="turnstile-site-key"
          label="Site Key"
          name="site_key"
          max={80}
          required={enabled}
          defaultValue={data.site_key}
          autoComplete="off"
          hint="คีย์สาธารณะ แสดงบนหน้าเว็บ เช่น 0x4AAAAAAA…"
        />
        <TextField
          id="turnstile-secret"
          label="Secret Key"
          name="secret"
          type="password"
          max={200}
          required={enabled && !data.configured}
          autoComplete="off"
          hint={keep ?? 'คีย์ลับ ใช้ตรวจกับ Cloudflare ฝั่งเซิร์ฟเวอร์'}
        />
      </div>
      <div>
        <button className="btn primary" type="submit">
          บันทึก
        </button>
      </div>
    </Form>
  );
}
