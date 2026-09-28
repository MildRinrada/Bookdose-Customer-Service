'use client';

import { useEffect } from 'react';
import { api, setReauthPrompt } from '@/lib/api/client';
import { useDialogs } from './Dialogs';
import { TextField } from './fields';
import { Form } from './Form';

/* ยืนยันรหัสผ่านอีกครั้ง: what the page shows when the server asks for the password before a dangerous act of the
   platform console (backend security/admin_guard.py). The API client waits on it and sends the refused request again
   once the password is right (lib/api/client.ts). Closing the question cancels the act. Mounted once, in Providers. */

export function ReauthPrompt() {
  const { openSheet, closeSheet } = useDialogs();
  useEffect(() => {
    setReauthPrompt(
      () =>
        new Promise<boolean>((resolve) => {
          let settled = false;
          const settle = (confirmed: boolean) => {
            if (settled) return;
            settled = true;
            resolve(confirmed);
          };
          openSheet(
            'ยืนยันรหัสผ่านอีกครั้ง',
            <Form
              onSubmit={async (values) => {
                await api('/api/account/confirm-password', { password: values.password ?? '' });
                settle(true);
                closeSheet();
              }}
            >
              <p className="sheet-message">
                รายการนี้มีผลกับทั้งแพลตฟอร์ม กรุณาใส่รหัสผ่านของบัญชีคุณอีกครั้งเพื่อยืนยันว่าเป็นคุณ ยืนยันแล้วทำรายการสำคัญต่อได้อีก 5 นาทีโดยไม่ต้องถามซ้ำ
              </p>
              <TextField label="รหัสผ่านของบัญชี" name="password" type="password" max={200} minLength={undefined} autoComplete="current-password" autoFocus />
              <div className="form-actions">
                <button type="button" className="btn" onClick={closeSheet}>
                  ยกเลิก
                </button>
                <button type="submit" className="btn primary">
                  ยืนยัน
                </button>
              </div>
            </Form>,
            () => settle(false),
          );
        }),
    );
    return () => setReauthPrompt(null);
  }, [openSheet, closeSheet]);
  return null;
}
