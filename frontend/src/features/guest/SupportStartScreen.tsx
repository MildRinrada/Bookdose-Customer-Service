'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { Brand } from '@/components/shell/chrome';
import { TextSizeMenu } from '@/components/shell/TextSize';
import { EmptyState, ErrorState, InitialLoading } from '@/components/ui/display';
import { useToast } from '@/components/ui/Toast';
import type { PublicOrgInfo } from '@/features/auth/types';
import { useCustomerAccount } from '@/lib/customer-session';
import { replyPromise } from '@/features/customer/labels';
import { useApi, useInvalidate } from '@/lib/query';
import { ORG_CODE } from '@/lib/routes';
import { guestPages, guestPath } from './api';
import { GuestNav, SignedInLink } from './components/GuestFrame';
import { GuestStartForm, linksMessage } from './components/GuestStartForm';
import { OrgBanner, PoweredBy } from './components/OrgBanner';
import { useGuestOverview } from './hooks';

/* Starting a chat without an account, like a help center of its own per organization (Zendesk, Freshdesk): a visitor
   comes in by the organization's link (its website, widget, QR or an email), so the chat always goes to that one
   organization and nobody can list who else uses the service.

     /support/<org>/tickets/new  SupportStartScreen: the start form of that organization
     /support/tickets/new        SupportFindScreen: no link at hand, the organization's code is typed in

   Markup: pages/guest-chat (start-hero, start-layout, start-aside, guest-find). */

type PublicArticle = { id: string; title: string; category: string };

/* An organization's page carries its banner (OrgBanner) and Bookdose at the foot; the page for typing a code in
   belongs to no organization yet, so it keeps the Bookdose header. */
function Frame({ slug, orgName, children }: { slug?: string; orgName?: string; children: ReactNode }) {
  const account = useCustomerAccount();
  return (
    <main className="guest-page">
      {slug ? (
        <OrgBanner slug={slug} name={orgName ?? ''}>
          <GuestNav slug={slug} current="chat" />
          <SignedInLink slug={slug} />
          <TextSizeMenu />
        </OrgBanner>
      ) : (
        <header className="guest-head">
          <Brand />
          <div className="guest-head-actions">
            {!account.data?.signed_in && (
              <Link className="btn subtle" href="/login">
                เข้าสู่ระบบ
              </Link>
            )}
            <TextSizeMenu />
          </div>
        </header>
      )}
      {children}
      <p className="guest-foot tiny muted">
        <Icon name="lock" /> ข้อความส่งถึงทีมงาน{orgName ? `ของ ${orgName}` : 'ขององค์กร'}โดยตรง · อย่าส่งรหัสผ่านหรือข้อมูลสำคัญในแชท
        {slug && (
          <>
            {' '}
            · <PoweredBy />
          </>
        )}
      </p>
    </main>
  );
}

export function SupportStartScreen({ slug }: { slug: string }) {
  const overview = useGuestOverview(slug, false);
  const info = useApi<PublicOrgInfo>(`/api/public/${slug}`);
  const toast = useToast();
  const refresh = useInvalidate();
  const router = useRouter();
  const name = overview.data?.organization.name || info.data?.organization.name || '';
  useEffect(() => {
    if (name) document.title = `เริ่มแชทกับ ${name}`;
  }, [name]);

  let body;
  if (overview.error?.status === 403 || info.error?.status === 404) {
    const closed = overview.error?.status === 403;
    body = (
      <section className="card guest-start-card">
        <EmptyState
          icon={closed ? 'lock' : 'globe'}
          title={closed ? 'ต้องเข้าสู่ระบบก่อนเริ่มแชท' : 'ไม่พบองค์กรนี้'}
          description={closed ? overview.error?.message : 'ตรวจลิงก์หรือรหัสองค์กรอีกครั้ง'}
        >
          {closed ? (
            <Link className="btn primary" href={`/login?org=${encodeURIComponent(slug)}`}>
              เข้าสู่ระบบหรือสมัครสมาชิก
            </Link>
          ) : (
            <Link className="btn" href="/support/tickets/new">
              ใส่รหัสองค์กรใหม่
            </Link>
          )}
        </EmptyState>
      </section>
    );
  } else if (overview.error) body = <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;
  else if (!overview.data) body = <InitialLoading text="กำลังเปิดหน้าเริ่มแชท…" />;
  else {
    const chats = overview.data.conversations.length;
    const promise = replyPromise({
      response_hours: Number(info.data?.response_hours) || undefined,
      response_in_opening_time: Boolean(info.data?.response_in_opening_time),
    });
    const articles = ((info.data?.articles as PublicArticle[] | undefined) ?? []).slice(0, 5);
    body = (
      <>
        <section className="start-hero" aria-labelledby="start-title">
          <p className="start-eyebrow">ศูนย์ช่วยเหลือ {name}</p>
          <h1 id="start-title">มีอะไรให้ทีมงาน {name} ช่วยไหม</h1>
          {info.data?.welcome && <p className="start-welcome">{info.data.welcome}</p>}
          <ul className="start-promises">
            <li>
              <Icon name="clock" />
              {promise ? `ตอบกลับครั้งแรกภายใน ${promise}` : 'ตอบกลับโดยเร็วที่สุด'}
            </li>
            {info.data?.ai_enabled && (
              <li>
                <Icon name="sparkle" />
                AI ช่วยตอบทันที คุยกับเจ้าหน้าที่ได้ตลอด
              </li>
            )}
            <li>
              <Icon name="lock" />
              ไม่ต้องสมัครสมาชิก
            </li>
          </ul>
        </section>
        <div className="start-layout">
          <section className="card guest-start-card" aria-label={`ฟอร์มเริ่มแชทกับ ${name}`}>
            <GuestStartForm
              slug={slug}
              overview={overview.data}
              info={info.data}
              intro={false}
              onStarted={async (id, links, asked) => {
                await refresh(guestPath(slug));
                toast(links.length || asked ? linksMessage(name, links, asked) : `ส่งข้อความถึงทีมงาน ${name} แล้ว ติดตามคำตอบได้ในแชทนี้`, links.some((l) => !l.sent));
                router.push(guestPages.chat(slug, id));
              }}
            />
          </section>
          <aside className="start-aside">
            {chats > 0 && (
              <Link className="start-mine" href={guestPages.chat(slug)}>
                <Icon name="chat" />
                <span>
                  <strong>แชทเดิมของคุณ {chats} เรื่อง</strong>
                  <small>เปิดอ่านคำตอบหรือคุยต่อ</small>
                </span>
                <Icon name="arrow" />
              </Link>
            )}
            {articles.length > 0 && (
              <section className="card start-faq" aria-labelledby="start-faq-title">
                <h2 id="start-faq-title">ลองหาคำตอบก่อน</h2>
                <p className="tiny muted">คำถามที่ลูกค้าของ {name} ถามบ่อย อาจตอบได้เลยโดยไม่ต้องรอ</p>
                <ul>
                  {articles.map((a) => (
                    <li key={a.id}>
                      <Link href={guestPages.article(slug, a.id)}>
                        <Icon name="book" />
                        <span>{a.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link className="start-faq-all" href={guestPages.faq(slug)}>
                  ดูคำถามที่พบบ่อยทั้งหมด <Icon name="arrow" />
                </Link>
              </section>
            )}
          </aside>
        </div>
      </>
    );
  }
  return (
    // The banner from the start (it fills in when the organization's details come); none for a code that is no organization.
    <Frame slug={info.error?.status === 404 ? undefined : slug} orgName={name}>
      {body}
    </Frame>
  );
}

export function SupportFindScreen() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState('');
  return (
    <Frame>
      <section className="card guest-start-card">
        <div className="card-header conv-header new-chat-header">
          <div className="conv-title">
            <h2>ติดต่อทีมงานขององค์กร</h2>
            <p className="conv-meta">เปิดจากลิงก์ “ติดต่อเรา” หรือแชทบนเว็บไซต์ขององค์กรที่ต้องการติดต่อ จะเข้าหน้าแชทขององค์กรนั้นทันที</p>
          </div>
        </div>
        <form
          className="card-body guest-find"
          onSubmit={(event) => {
            event.preventDefault();
            const value = code.trim().toLowerCase();
            if (!ORG_CODE.test(value)) {
              setProblem('รหัสองค์กรใช้ a-z, 0-9 และขีด (-) เช่น bookdose');
              return;
            }
            router.push(guestPages.start(value));
          }}
        >
          <label htmlFor="support-org-code">ไม่มีลิงก์? ใส่รหัสองค์กร</label>
          <div className="guest-find-row">
            <span className="guest-find-prefix" aria-hidden="true">
              /support/
            </span>
            <input
              id="support-org-code"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                setProblem('');
              }}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={60}
              placeholder="เช่น bookdose"
              aria-describedby="support-org-code-help"
              aria-invalid={problem ? 'true' : undefined}
              required
            />
            <button className="btn primary" type="submit">
              ไปที่หน้าแชท
              <Icon name="arrow" />
            </button>
          </div>
          <p className="tiny muted" id="support-org-code-help">
            {problem || 'รหัสองค์กรอยู่ในลิงก์ที่องค์กรให้มา หรือสอบถามจากองค์กรนั้น · สมาชิกที่เข้าสู่ระบบแล้วเริ่มแชทกับทุกองค์กรของตัวเองได้จากหน้า “แชทของฉัน”'}
          </p>
        </form>
      </section>
    </Frame>
  );
}
