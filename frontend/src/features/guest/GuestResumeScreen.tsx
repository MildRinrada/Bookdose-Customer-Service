'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { CustomerLinkPage } from '@/features/auth/components/Frames';
import { api, ApiError, setGuestCredentials } from '@/lib/api/client';
import type { PublicOrgInfo } from '@/features/auth/types';
import { useApi, useInvalidate } from '@/lib/query';
import { guestPages, guestPath, resumeGuest } from './api';
import type { GuestOverview } from './types';

/* /support/<org>/resume#t=<token>: a follow link from email or SMS. The token is in the fragment, so it never reaches a
   server log; it is read once, dropped from the address, and exchanged for this browser's own guest cookie. */

export function GuestResumeScreen({ slug }: { slug: string }) {
  const router = useRouter();
  const refresh = useInvalidate();
  const [problem, setProblem] = useState('');
  const started = useRef(false);
  const info = useApi<PublicOrgInfo>(`/api/public/${slug}`);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('t') ?? '';
    // Drop the token from the address (and so from history) before anything else.
    window.history.replaceState(null, '', window.location.pathname);
    const fail = (message: string) => setProblem(message);
    if (!token) {
      fail('ลิงก์ไม่ครบ ขอลิงก์ใหม่จากแชทเดิม หรือเริ่มแชทใหม่');
      return;
    }
    // A cookie this browser may already hold for the organization: its csrf goes with the request.
    api<GuestOverview>(guestPath(slug))
      .then((known) => setGuestCredentials(known.guest?.csrf ?? null))
      .catch(() => setGuestCredentials(null))
      .then(() => resumeGuest(slug, token))
      .then(async ({ conversation_id }) => {
        // The new cookie's csrf comes with the next GET …/guest (the chat page reads it first).
        setGuestCredentials(null);
        await refresh(guestPath(slug));
        router.replace(guestPages.chat(slug, conversation_id || undefined));
      })
      .catch((error: unknown) => {
        const expired = error instanceof ApiError && [400, 401, 404, 410].includes(error.status);
        fail(expired ? 'ลิงก์หมดอายุ ขอลิงก์ใหม่จากแชทเดิม หรือเริ่มแชทใหม่' : error instanceof Error ? error.message : String(error));
      });
  }, [slug, router, refresh]);

  return (
    <CustomerLinkPage organization={info.data?.organization.name ?? ''} loginHref={`/login?org=${encodeURIComponent(slug)}`} backLabel="เข้าสู่ระบบด้วยบัญชีสมาชิก">
      <div className="card-body" role="status" aria-live="polite">
        <span className="customer-center-icon">
          <Icon name={problem ? 'clock' : 'chat'} />
        </span>
        {problem ? (
          <>
            <h1>เปิดแชทไม่ได้</h1>
            <p>{problem}</p>
            <Link className="btn primary customer-submit" href={guestPages.chat(slug)}>
              <Icon name="plus" />
              เริ่มแชทใหม่
            </Link>
          </>
        ) : (
          <>
            <h1>กำลังเปิดแชทของคุณ…</h1>
            <p>รอสักครู่ เบราว์เซอร์นี้จะจำแชทไว้ให้กลับมาอ่านได้</p>
          </>
        )}
      </div>
    </CustomerLinkPage>
  );
}
