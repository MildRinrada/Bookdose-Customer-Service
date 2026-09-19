'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Icon } from '@/components/Icon';
import { EmptyState, ErrorState, InitialLoading } from '@/components/ui/display';
import { CaseView } from '@/features/customer/CaseScreen';
import type { CaseDetail } from '@/features/customer/types';
import { useApi } from '@/lib/query';
import { useRealtimeInterval } from '@/lib/realtime-provider';
import { guestCasePath, guestPages } from './api';
import { GuestFrame } from './components/GuestFrame';
import { useGuestOverview } from './hooks';

/* /support/<org>/cases/<id>: a visitor without an account follows the case the team opened from their chat - where it
   stands, what the team did and promised, and the chats in it - like a signed-in customer does. Only a case holding
   one of this browser's chats opens (the guest cookie; GET /api/public/<org>/guest/cases/<id>), and it is read again
   every 30 seconds while open. */

const POLL_MS = 30000;

export function GuestCaseScreen({ slug, id }: { slug: string; id: string }) {
  const overview = useGuestOverview(slug, false);
  const interval = useRealtimeInterval(POLL_MS);
  const detail = useApi<CaseDetail>(guestCasePath(slug, id), { refetchInterval: interval });
  const orgName = overview.data?.organization.name ?? '';
  const subject = detail.data?.case.subject;
  useEffect(() => {
    if (subject) document.title = `เคส ${subject}`;
  }, [subject]);

  let body;
  if (detail.data)
    body = (
      <CaseView
        data={detail.data}
        orgName={orgName}
        back={{ href: guestPages.chat(slug), label: 'กลับไปที่แชท' }}
        chatHref={(conversation) => guestPages.chat(slug, conversation)}
        newChatHref={guestPages.chat(slug)}
      />
    );
  else if (detail.error && [401, 403, 404].includes(detail.error.status))
    body = (
      <section className="card guest-closed">
        <EmptyState
          icon="lock"
          title="เปิดเคสนี้ในเบราว์เซอร์นี้ไม่ได้"
          description="เคสจะเปิดได้ในเบราว์เซอร์ที่ใช้แชทเรื่องนี้เท่านั้น ถ้าเปลี่ยนเครื่อง ให้เปิดลิงก์ติดตามแชทที่ส่งไปทางอีเมลก่อน หรือเข้าสู่ระบบด้วยอีเมลที่ยืนยันไว้"
        >
          <Link className="btn primary" href={guestPages.chat(slug)}>
            <Icon name="chat" />
            ไปที่แชท
          </Link>
        </EmptyState>
      </section>
    );
  else if (detail.error) body = <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  else body = <InitialLoading text="กำลังเปิดเคส…" />;

  return (
    <GuestFrame slug={slug} orgName={orgName} current="case">
      {body}
    </GuestFrame>
  );
}
