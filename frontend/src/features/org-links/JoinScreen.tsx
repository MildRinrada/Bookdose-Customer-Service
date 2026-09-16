'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { ErrorState, InitialLoading } from '@/components/ui/display';
import { useToast } from '@/components/ui/Toast';
import { CustomerLinkPage } from '@/features/auth/components/Frames';
import { ORGS_PATH, OVERVIEW_PATH } from '@/features/customer/api';
import { useCustomerAccount } from '@/lib/customer-session';
import { useApi, useInvalidate } from '@/lib/query';
import { useBoot } from '@/lib/session';
import { joinByLink, joinLinkPath } from './api';
import type { JoinPreview } from './types';

/* /join/<token>: the page an organization's QR or invite link opens. It says whose link it is, then joins the
   organization for the signed-in customer and goes on to their overview. Signed out, sign-in and sign-up come back
   here (?next=), and the sign-up already knows the organization (?org=). Outside the customer layout: a visitor
   without an account must be able to open it. */

export function JoinScreen({ token }: { token: string }) {
  const boot = useBoot();
  const account = useCustomerAccount();
  const preview = useApi<JoinPreview>(joinLinkPath(token));
  const router = useRouter();
  const toast = useToast();
  const refresh = useInvalidate();
  const [joining, setJoining] = useState(false);

  const staffIn = Boolean(boot.data?.user);
  const customerIn = Boolean(account.data?.signed_in);
  const next = `/join/${encodeURIComponent(token)}`;
  const org = preview.data;

  const join = async () => {
    setJoining(true);
    try {
      const { organization } = await joinByLink(token);
      await refresh(ORGS_PATH, OVERVIEW_PATH);
      toast(`เพิ่ม ${organization.name} ในองค์กรที่ติดต่อได้แล้ว`);
      router.replace('/customer/dashboard');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
      setJoining(false);
    }
  };

  if (preview.error)
    return (
      <CustomerLinkPage organization="" loginHref="/login">
        <div className="card-body join-page">
          <span className="customer-center-icon">
            <Icon name="lock" />
          </span>
          <h1>ลิงก์นี้ใช้ไม่ได้</h1>
          <p>{preview.error.message}</p>
          <Link className="btn primary customer-submit" href="/login">
            ไปหน้าเข้าสู่ระบบ
          </Link>
        </div>
      </CustomerLinkPage>
    );
  if (boot.error) return <ErrorState error={boot.error} onRetry={() => void boot.refetch()} />;
  if (!org || !boot.data || !account.data) return <InitialLoading text="กำลังเปิดลิงก์…" />;

  // Someone already signed in is sent back to their own overview, not to the sign-in page.
  const back = staffIn
    ? { href: '/dashboard', label: 'กลับไปหน้าภาพรวมของทีม' }
    : customerIn
      ? { href: '/customer/dashboard', label: 'กลับไปหน้าภาพรวม' }
      : { href: `/login?org=${encodeURIComponent(org.org_slug)}`, label: 'กลับไปหน้าเข้าสู่ระบบ' };

  return (
    <CustomerLinkPage organization={org.org_name} loginHref={back.href} backLabel={back.label}>
      <div className="card-body join-page">
        <span className="customer-center-icon">
          <Icon name={org.valid ? 'globe' : 'lock'} />
        </span>
        <h1>{org.org_name}</h1>
        {!org.valid ? (
          <>
            <p>ลิงก์เชิญนี้{org.reason} กรุณาขอลิงก์ใหม่จากองค์กร หรือเพิ่มองค์กรด้วยรหัส {org.org_slug} ในหน้าตั้งค่าบัญชี</p>
            <Link className="btn primary customer-submit" href="/customer/account?tab=organizations">
              ไปหน้าองค์กรที่ติดต่อได้
            </Link>
          </>
        ) : staffIn ? (
          <>
            <p>ลิงก์นี้สำหรับลูกค้าที่ต้องการติดต่อ {org.org_name} คุณกำลังเข้าใช้งานในฐานะทีมงานอยู่</p>
            <Link className="btn primary customer-submit" href="/dashboard">
              ไปหน้าภาพรวมของทีม
            </Link>
          </>
        ) : customerIn ? (
          <>
            <p>เพิ่ม {org.org_name} ในองค์กรที่ติดต่อได้ แล้วเริ่มแชท เปิดเคส และอ่านคำถามที่พบบ่อยขององค์กรนี้ได้ทันที</p>
            <button className="btn primary customer-submit" type="button" disabled={joining} onClick={() => void join()}>
              <Icon name="check" />
              {joining ? 'กำลังเพิ่มองค์กร…' : 'เข้าร่วมองค์กรนี้'}
            </button>
          </>
        ) : (
          <>
            <p>เข้าสู่ระบบด้วยบัญชีลูกค้า หรือสมัครสมาชิกใหม่ แล้วระบบจะพากลับมาที่หน้านี้เพื่อเพิ่ม {org.org_name} ให้อัตโนมัติ</p>
            <Link className="btn primary customer-submit" href={`/login?org=${encodeURIComponent(org.org_slug)}&next=${encodeURIComponent(next)}`}>
              <Icon name="logout" />
              เข้าสู่ระบบ
            </Link>
            <p className="small muted">
              ยังไม่มีบัญชี?{' '}
              <Link href={`/login?tab=signup&org=${encodeURIComponent(org.org_slug)}&next=${encodeURIComponent(next)}`}>สมัครสมาชิก</Link>{' '}
              ใช้บัญชีเดียวติดต่อได้ทุกองค์กร
            </p>
          </>
        )}
      </div>
    </CustomerLinkPage>
  );
}
