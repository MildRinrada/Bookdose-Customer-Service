'use client';

import { useState } from 'react';
import { useRunAction } from '@/components/ui/actions';
import { useToast } from '@/components/ui/Toast';
import { useApi, useInvalidate } from '@/lib/query';
import { savePlatformSwitch, SWITCHES_PATH } from '../api';
import type { PlatformSwitches } from '../types';

/* Platform console → ตั้งค่าระบบ (#features): what is on or off for every organization at once (GET/POST
   /api/platform/switches, backend platform/switches.py). Each switch saves the moment it is flipped. Not the same as
   the per-organization features on an organization's page. */

export function PlatformSwitchesCard() {
  const { data, error } = useApi<PlatformSwitches>(SWITCHES_PATH);
  const run = useRunAction();
  const toast = useToast();
  const refresh = useInvalidate();
  const [busy, setBusy] = useState('');

  const flip = (key: string, label: string, enabled: boolean) =>
    run(async () => {
      setBusy(key);
      try {
        await savePlatformSwitch(key, enabled);
        toast(`${enabled ? 'เปิด' : 'ปิด'}${label}แล้ว`);
        await refresh(SWITCHES_PATH, '/api/bootstrap', '/api/platform/registration');
      } finally {
        setBusy('');
      }
    });

  return (
    <section className="card system-section">
      <div className="card-header">
        <div>
          <h2>ฟีเจอร์ของระบบ</h2>
          <p className="muted">เปิดหรือปิดพร้อมกันทุกองค์กร</p>
        </div>
      </div>
      <div className="card-body">
        {error ? (
          <p className="notice warning">{error.message}</p>
        ) : !data ? (
          <p className="muted">กำลังโหลด…</p>
        ) : (
          <div className="platform-switches">
            {data.items.map((item) => (
              <label key={item.key} className="check">
                <input
                  type="checkbox"
                  className="switch"
                  checked={item.enabled}
                  disabled={busy === item.key}
                  onChange={(event) => void flip(item.key, item.label, event.currentTarget.checked)}
                />
                <span className="check-text">
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                  {item.key === 'org_signup' && item.enabled && !data.mail_ready && (
                    <small className="platform-switch-warn">หน้าสมัครยังไม่เปิดจริงจนกว่าจะตั้งอีเมลของระบบด้านล่าง</small>
                  )}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
