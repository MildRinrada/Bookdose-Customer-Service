'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { useRunAction } from '@/components/ui/actions';
import { useDialogs } from '@/components/ui/Dialogs';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import { forgetGuest, guestPath, requestGuestLineCode, sendFollowLink, setGuestName, setGuestRemember, unlinkGuestLine } from '../api';
import type { GuestLineCode, GuestOverview } from '../types';

/* "ติดตามแชทนี้": the ways a visitor without an account keeps following the chat, each with a line saying where it
   stands — this browser (a switch), a link by email, a link by SMS (when the platform has SMS), LINE notices (when the
   organization's LINE is connected) — then signing up to keep the history for good, and forgetting this browser.
   It sits in the thread after the newest message, collapsible; the chat header's menu opens it again. */

function useSecondsLeft(until: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return until ? Math.max(0, Math.round((Date.parse(until) - now) / 1000)) : 0;
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

function Option({ icon, title, status, done, children }: { icon: string; title: ReactNode; status: ReactNode; done: boolean; children?: ReactNode }) {
  return (
    <li className={`guest-follow-option${done ? ' done' : ''}`}>
      <span className="guest-follow-icon" aria-hidden="true">
        <Icon name={done ? 'check' : icon} />
      </span>
      <div className="guest-follow-text">
        <strong>{title}</strong>
        <span className="guest-follow-status">{status}</span>
        {children}
      </div>
    </li>
  );
}

/** Email or SMS: type where to, send; the answer names the masked address it went to. */
function LinkOption({ slug, via, verified, masked }: { slug: string; via: 'email' | 'sms'; verified: boolean; masked: string }) {
  const [sentTo, setSentTo] = useState('');
  const [editing, setEditing] = useState(!verified && !masked);
  const toast = useToast();
  const refresh = useInvalidate();
  const email = via === 'email';
  const inputId = `guest-link-${via}`;
  const status = sentTo
    ? `ส่งแล้วไปที่ ${sentTo} เปิดลิงก์ในข้อความเพื่อยืนยัน`
    : verified
      ? `ยืนยันแล้ว ${masked} · ได้รับแจ้งเมื่อทีมงานตอบ พร้อมลิงก์กลับมาที่แชท`
      : masked
        ? `ส่งลิงก์ไปที่ ${masked} แล้ว ยังไม่ได้เปิดลิงก์`
        : email
          ? 'รับลิงก์ไว้เปิดแชทนี้จากเครื่องอื่น และรับแจ้งเมื่อทีมงานตอบ'
          : 'สำหรับคนที่ไม่มีอีเมล รับลิงก์ทาง SMS ไว้เปิดแชทนี้ภายหลัง';
  return (
    <Option
      icon={email ? 'mail' : 'phone'}
      title={email ? 'ส่งลิงก์ทางอีเมล' : 'ส่งลิงก์ทาง SMS'}
      status={status}
      done={verified && !sentTo}
    >
      {editing ? (
        <Form
          className="guest-inline"
          onSubmit={async (values) => {
            const result = await sendFollowLink(slug, via, values.to ?? '');
            setSentTo(result.to_masked);
            setEditing(false);
            toast(`ส่งลิงก์ไปที่ ${result.to_masked} แล้ว`);
            await refresh(guestPath(slug));
          }}
        >
          <label className="sr-only" htmlFor={inputId}>
            {email ? 'อีเมลที่ให้ส่งลิงก์' : 'เบอร์โทรศัพท์มือถือที่ให้ส่งลิงก์'}
          </label>
          <input
            id={inputId}
            name="to"
            type={email ? 'email' : 'tel'}
            inputMode={email ? 'email' : 'tel'}
            autoComplete={email ? 'email' : 'tel'}
            required
            maxLength={email ? 254 : 20}
            placeholder={email ? 'name@example.com' : 'เช่น 081-234-5678'}
          />
          <button className="btn" type="submit">
            <Icon name="send" />
            ส่งลิงก์
          </button>
        </Form>
      ) : (
        <button type="button" className="btn sm subtle guest-follow-again" onClick={() => setEditing(true)}>
          {verified || masked || sentTo ? 'ส่งไปที่อื่น หรือส่งอีกครั้ง' : 'ส่งลิงก์'}
        </button>
      )}
    </Option>
  );
}

function LineOption({ slug, overview }: { slug: string; overview: GuestOverview }) {
  const [code, setCode] = useState<GuestLineCode | null>(null);
  const [busy, setBusy] = useState(false);
  const left = useSecondsLeft(code?.expires_at);
  const run = useRunAction();
  const toast = useToast();
  const refresh = useInvalidate();
  const { confirm } = useDialogs();
  const linked = Boolean(overview.guest?.line_linked);
  const name = code?.oa_name || overview.follow.line_oa_name || 'LINE Official Account';
  const addUrl = code?.add_url || overview.follow.line_add_url;
  const waiting = Boolean(code && left > 0 && !linked);

  // While a code is shown, ask every 5 seconds whether it reached the organization's LINE.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void refresh(guestPath(slug)), 5000);
    return () => clearInterval(timer);
  }, [waiting, refresh, slug]);

  // The code arrived: put it away (adjusted while rendering, not in an effect) and say so once.
  const [justLinked, setJustLinked] = useState(false);
  if (code && linked) {
    setCode(null);
    setJustLinked(true);
  }
  useEffect(() => {
    if (justLinked) toast('เชื่อม LINE แล้ว จะได้รับแจ้งทาง LINE เมื่อทีมงานตอบ');
  }, [justLinked, toast]);

  const ask = () =>
    run(async () => {
      setJustLinked(false);
      setBusy(true);
      try {
        setCode(await requestGuestLineCode(slug));
      } finally {
        setBusy(false);
      }
    });

  return (
    <Option
      icon="chat"
      title="แจ้งเตือนทาง LINE"
      done={linked}
      status={linked ? `เชื่อมกับ ${name} แล้ว · ได้รับแจ้งทาง LINE เมื่อทีมงานตอบ` : `รับแจ้งเตือนในแชท LINE กับ ${name}`}
    >
      {linked ? (
        <button
          type="button"
          className="btn sm subtle guest-follow-again"
          onClick={() =>
            confirm({
              title: 'ยกเลิกการแจ้งเตือนทาง LINE',
              message: `จะไม่ได้รับแจ้งทาง LINE เมื่อทีมงานตอบแชทนี้อีก เชื่อมใหม่ได้ทุกเมื่อ`,
              confirmLabel: 'ยกเลิกการเชื่อม',
              cancelLabel: 'ไม่ยกเลิก',
              tone: 'danger',
              run: async () => {
                await unlinkGuestLine(slug);
                toast('ยกเลิกการแจ้งเตือนทาง LINE แล้ว');
                await refresh(guestPath(slug));
              },
            })
          }
        >
          ยกเลิกการเชื่อม
        </button>
      ) : waiting && code ? (
        <div className="guest-line">
          <div className="line-code-box">
            <span className="line-code" aria-label={`รหัส ${code.code.split('').join(' ')}`}>
              {code.code}
            </span>
            {addUrl && (
              <a className="btn primary" href={addUrl} target="_blank" rel="noopener noreferrer">
                <Icon name="plus" />
                เพิ่มเพื่อน
              </a>
            )}
            <span className="line-expiry" aria-live="polite">
              <Icon name="clock" />
              ใช้ได้อีก {clock(left)} นาที
            </span>
          </div>
          <ol className="line-steps">
            <li>เพิ่มเพื่อน “{name}” ในแอป LINE</li>
            <li>พิมพ์รหัส 6 หลักนี้ส่งในแชทส่วนตัวกับบัญชีนั้น</li>
            <li>รอสักครู่ หน้านี้จะแสดงว่าเชื่อมแล้ว</li>
          </ol>
        </div>
      ) : (
        <button type="button" className="btn sm guest-follow-again" disabled={busy} onClick={ask}>
          {code ? 'รหัสหมดอายุแล้ว ขอรหัสใหม่' : 'ขอรหัสเชื่อม LINE'}
        </button>
      )}
    </Option>
  );
}

function NameRow({ slug, name }: { slug: string; name: string }) {
  const [editing, setEditing] = useState(false);
  const toast = useToast();
  const refresh = useInvalidate();
  if (!editing)
    return (
      <p className="guest-follow-name">
        <span className="muted">ทีมงานเห็นชื่อคุณเป็น</span> <strong>{name || 'ผู้เยี่ยมชม'}</strong>{' '}
        <button type="button" className="btn sm subtle" onClick={() => setEditing(true)}>
          เปลี่ยนชื่อ
        </button>
      </p>
    );
  return (
    <Form
      className="guest-inline guest-follow-name"
      onSubmit={async (values) => {
        await setGuestName(slug, values.name ?? '');
        setEditing(false);
        toast('เปลี่ยนชื่อแล้ว');
        await refresh(guestPath(slug));
      }}
    >
      <label className="sr-only" htmlFor="guest-rename">
        ชื่อที่ให้ทีมงานเรียก
      </label>
      <input id="guest-rename" name="name" defaultValue={name} maxLength={100} required autoComplete="name" />
      <button className="btn" type="submit">
        บันทึก
      </button>
      <button className="btn subtle" type="button" onClick={() => setEditing(false)}>
        ยกเลิก
      </button>
    </Form>
  );
}

export function FollowCard({
  slug,
  overview,
  expanded,
  onToggle,
  onForgotten,
  newWindow = false,
}: {
  slug: string;
  overview: GuestOverview;
  expanded: boolean;
  onToggle: (expanded: boolean) => void;
  onForgotten: () => void;
  /** Inside a website's iframe, the sign-up page opens in a new window. */
  newWindow?: boolean;
}) {
  const guest = overview.guest;
  const follow = overview.follow;
  const run = useRunAction();
  const toast = useToast();
  const refresh = useInvalidate();
  const { confirm } = useDialogs();
  if (!guest) return null;

  const proven = [
    guest.remember && 'เบราว์เซอร์นี้',
    guest.email_verified && 'อีเมล',
    guest.phone_verified && 'SMS',
    guest.line_linked && 'LINE',
  ].filter(Boolean) as string[];
  const signup = `/login?tab=signup&org=${encodeURIComponent(slug)}`;

  return (
    <section className={`guest-follow${expanded ? ' open' : ''}`} id="guest-follow" aria-labelledby="guest-follow-title">
      <button type="button" className="guest-follow-head" aria-expanded={expanded} aria-controls="guest-follow-body" onClick={() => onToggle(!expanded)}>
        <span className="guest-follow-head-icon" aria-hidden="true">
          <Icon name="bell" />
        </span>
        <span className="guest-follow-head-text">
          <strong id="guest-follow-title">ติดตามแชทนี้</strong>
          <span className="tiny muted">{proven.length ? `ติดตามได้ทาง ${proven.join(' · ')}` : 'เลือกวิธีกลับมาอ่านคำตอบของทีมงาน'}</span>
        </span>
        <Icon name="down" />
      </button>
      <div className="guest-follow-body" id="guest-follow-body" hidden={!expanded}>
        <ul className="guest-follow-options">
          <Option
            icon="globe"
            title="จำในเบราว์เซอร์นี้"
            done={guest.remember}
            status={
              guest.remember
                ? 'เปิดหน้านี้ในเบราว์เซอร์นี้เมื่อไรก็เห็นแชทต่อได้ (เฉพาะเครื่องนี้)'
                : 'ปิดอยู่ เบราว์เซอร์จะลืมแชทเมื่อปิดหน้าต่าง ขอลิงก์ไว้ก่อนถ้าต้องการกลับมาอ่าน'
            }
          >
            <label className="check guest-switch">
              <input
                type="checkbox"
                className="switch"
                checked={guest.remember}
                onChange={(event) => {
                  const remember = event.currentTarget.checked;
                  void run(async () => {
                    await setGuestRemember(slug, remember);
                    toast(remember ? 'เบราว์เซอร์นี้จะจำแชทไว้' : 'เบราว์เซอร์จะลืมแชทเมื่อปิดหน้าต่าง');
                    await refresh(guestPath(slug));
                  });
                }}
              />
              <span>{guest.remember ? 'จำไว้' : 'ไม่จำ'}</span>
            </label>
          </Option>
          {follow.email_ready && <LinkOption slug={slug} via="email" verified={guest.email_verified} masked={guest.email_masked} />}
          {follow.sms_ready && <LinkOption slug={slug} via="sms" verified={guest.phone_verified} masked={guest.phone_masked} />}
          {follow.line_ready && <LineOption slug={slug} overview={overview} />}
        </ul>
        <NameRow slug={slug} name={guest.name} />
        <div className="guest-follow-foot">
          <Link className="btn subtle" href={signup} target={newWindow ? '_blank' : undefined} rel={newWindow ? 'noopener' : undefined}>
            <Icon name="users" />
            สมัครสมาชิกเพื่อเก็บประวัติถาวร
          </Link>
          <button
            type="button"
            className="btn subtle guest-forget"
            onClick={() =>
              confirm({
                title: 'ลืมแชทในเบราว์เซอร์นี้',
                message:
                  'เบราว์เซอร์นี้จะไม่แสดงแชทกับทีมงานอีก ทีมงานยังเห็นข้อความเดิม และคุณยังเปิดแชทได้จากลิงก์ในอีเมล SMS หรือ LINE ที่ยืนยันไว้',
                confirmLabel: 'ลืมแชท',
                cancelLabel: 'ไม่ลืม',
                tone: 'danger',
                run: async () => {
                  await forgetGuest(slug);
                  toast('ลืมแชทในเบราว์เซอร์นี้แล้ว');
                  onForgotten();
                },
              })
            }
          >
            <Icon name="trash" />
            ลืมแชทในเบราว์เซอร์นี้
          </button>
        </div>
      </div>
    </section>
  );
}
