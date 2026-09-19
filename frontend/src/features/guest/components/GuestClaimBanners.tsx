'use client';

import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { useToast } from '@/components/ui/Toast';
import { OVERVIEW_PATH, ORGS_PATH } from '@/features/customer/api';
import { useApi, useInvalidate } from '@/lib/query';
import { claimGuestChats, GUEST_CLAIMS_PATH, guestBase, type GuestClaims } from '../api';

/* For a signed-in customer: chats this browser had with an organization before signing in (its g_<org> cookies).
   One banner per organization; moving them is asked first, because a shared computer must not hand someone else's
   chats to whoever signs in next. `org` limits the banners to one organization (the /support/<org> pages). */

export function GuestClaimBanners({ org }: { org?: string }) {
  const { data } = useApi<GuestClaims>(GUEST_CLAIMS_PATH);
  const { confirm } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const claims = (data?.claims ?? []).filter((c) => c.conversations > 0 && (!org || c.org_slug === org));
  if (!claims.length) return null;
  return (
    <div className="guest-claims">
      {claims.map((claim) => (
        <div key={claim.org_slug} className="notice guest-claim" role="status">
          <span className="guest-claim-icon" aria-hidden="true">
            <Icon name="chat" />
          </span>
          <span className="guest-claim-text">
            พบแชท {claim.conversations} เรื่องที่คุยไว้ก่อนเข้าสู่ระบบกับ <strong>{claim.org_name}</strong>
          </span>
          <button
            type="button"
            className="btn sm primary"
            onClick={() =>
              confirm({
                title: 'ย้ายแชทเข้าบัญชีนี้',
                message: `ย้ายแชท ${claim.conversations} เรื่องกับ ${claim.org_name} ที่คุยไว้ในเบราว์เซอร์นี้เข้าบัญชีที่เข้าสู่ระบบอยู่? ถ้าไม่ใช่แชทของคุณ (เช่น เครื่องที่ใช้ร่วมกัน) ให้กด “ไม่ย้าย”`,
                confirmLabel: 'ย้ายเข้าบัญชีนี้',
                cancelLabel: 'ไม่ย้าย',
                run: async () => {
                  const result = await claimGuestChats(claim.org_slug);
                  toast(`ย้ายแชท ${result.moved} เรื่องเข้าบัญชีแล้ว ดูได้ในแชทของฉัน`);
                  await refresh(GUEST_CLAIMS_PATH, OVERVIEW_PATH, ORGS_PATH, guestBase(claim.org_slug));
                },
              })
            }
          >
            ย้ายเข้าบัญชีนี้
          </button>
        </div>
      ))}
    </div>
  );
}
