'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { TextSizeControls } from '@/components/shell/TextSize';
import { ApiError } from '@/lib/api/client';
import { useBoot } from '@/lib/session';
import { completeEmailOAuth } from './api';

/* /oauth/email/callback: where the email provider returns after the organization's admin allowed the mailbox
   (old-frontend: public/oauth-callback.html + pages/auth/oauth-callback.js). The code is single-use, so it is sent once and the
   query leaves the address right away. */

export function OAuthCallbackScreen({ state, code, denied }: { state: string | null; code: string | null; denied: boolean }) {
  const boot = useBoot();
  const router = useRouter();
  const [message, setMessage] = useState('กำลังตรวจสอบการอนุญาต…');
  const started = useRef(false);
  // What the provider sent, as first seen (the props empty once the query is removed).
  const sent = useRef({ state, code, denied });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    router.replace('/oauth/email/callback');
  }, [router]);

  const settled = Boolean(boot.data || boot.error);
  const done = useRef(false);
  useEffect(() => {
    if (!settled || done.current) return;
    done.current = true;
    void (async () => {
      try {
        if (sent.current.denied) throw new Error('ไม่ได้อนุญาตการเชื่อมบัญชี กรุณากลับไปตั้งค่าและเริ่มใหม่');
        if (boot.error) throw boot.error;
        if (!boot.data?.user) throw new Error('กรุณาเข้าสู่ระบบ แล้วเริ่มเชื่อมบัญชีใหม่');
        try {
          await completeEmailOAuth(sent.current.state, sent.current.code);
        } catch (error) {
          // The server's reason when it gave one, else the page's own words.
          if (error instanceof ApiError && error.status >= 400 && error.message === 'เกิดข้อผิดพลาด กรุณาลองใหม่') throw new Error('เชื่อมบัญชีไม่สำเร็จ');
          throw error;
        }
        setMessage('เชื่อมบัญชีสำเร็จ กลับไปตั้งค่าองค์กร แล้วเปิดรับและส่ง Email เพื่อเริ่มใช้งาน');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    })();
  }, [settled, boot.data, boot.error]);

  return (
    <main className="single-page">
      <TextSizeControls />
      <h1>เชื่อมบัญชีอีเมล</h1>
      <p id="oauth-result" role="status">
        {message}
      </p>
      <Link className="btn" href="/settings?tab=connections">
        กลับไปตั้งค่าองค์กร
      </Link>
    </main>
  );
}
