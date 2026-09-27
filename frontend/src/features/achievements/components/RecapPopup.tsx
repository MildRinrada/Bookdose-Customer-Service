'use client';

import { useEffect, useRef } from 'react';
import { useDialogs } from '@/components/ui/Dialogs';
import { useStaffAlerts } from '@/lib/session';
import { markRecapSeen } from '../api';
import { RecapMonth } from './RecapCard';

/* สรุปผลงานของเดือนที่แล้ว, popped up once: the alerts say so the first time the member opens the app in a new month
   (when they worked last month and did not switch it off in ตั้งค่าบัญชี → การแจ้งเตือน). It is marked seen as it
   opens, so closing it any way at all is the end of it; ตั้งค่าบัญชี → ผลงานของฉัน opens it again. Runs in the staff
   frame. */

export function RecapPopup() {
  const pending = useStaffAlerts().data?.recap;
  const { openModal } = useDialogs();
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!pending || opened.current === pending.month) return;
    opened.current = pending.month;
    void markRecapSeen(pending.month).catch(() => undefined);
    openModal(`สรุปผลงานเดือน${pending.label} ของคุณ`, <RecapMonth month={pending.month} />);
  }, [pending, openModal]);
  return null;
}
