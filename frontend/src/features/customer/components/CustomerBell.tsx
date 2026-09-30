'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { date, relative } from '@/lib/format';
import { useCustomerOverview } from '@/lib/customer-session';
import { alertKinds } from '../labels';
import type { CustomerAlert, OverviewData } from '../types';

/* The bell in the customer's top bar: the number of things waiting for them, and the panel that drops down from it -
   what waits for them first, then the latest news of their chats and cases, each a link to where it is done. The
   whole list stays on การแจ้งเตือน (AlertsScreen), reached from the foot. It works like the team's bell
   (features/notifications/NotificationBell) and wears its markup: closes on a click anywhere else, on Escape, on
   opening one of its items and on moving to another screen. Markup: pages/notifications.css (bell-menu, note-*). */

/* What fits without scrolling far; the rest is one press away. */
const SHOWN = 8;

function Row({ alert: a }: { alert: CustomerAlert }) {
  const kind = alertKinds[a.kind];
  if (!kind) return null;
  return (
    <Link className={`note-item note-${kind.tone}`} href={kind.href(a)}>
      <span className="note-icon">
        <Icon name={kind.icon} />
      </span>
      <span className="note-body">
        <strong>{kind.title(a)}</strong>
        <span className="note-detail">{kind.detail(a)}</span>
      </span>
      <time className="note-time" dateTime={a.at} title={date(a.at, true)}>
        {a.kind === 'followup' ? date(a.at) : relative(a.at)}
      </time>
    </Link>
  );
}

function Section({ label, tone, list }: { label: string; tone: string; list: CustomerAlert[] }) {
  if (!list.length) return null;
  return (
    <section className={`note-section note-section-${tone}`}>
      <h3>
        {label}
        <span>{list.length}</span>
      </h3>
      <div className="note-list">
        {list.map((a, i) => (
          <Row key={`${a.kind}:${a.conversation_id ?? a.case_id}:${i}`} alert={a} />
        ))}
      </div>
    </section>
  );
}

export function CustomerBell() {
  // The path the panel was opened on: moving to another screen closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const overview = useCustomerOverview<OverviewData>();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const open = openOn === pathname;
  const setOpen = (next: boolean) => setOpenOn(next ? pathname : null);

  useEffect(() => {
    if (!open) return;
    // Anywhere outside the bell closes the panel, and so does following one of its links.
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!root.current?.contains(target) || target.closest('.note-dropdown a')) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
    // setOpen only writes state; it does not need to re-subscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const alerts = overview.data?.alerts ?? [];
  // What waits for the customer is what the bell counts; it comes first and is never cut for the news under it.
  const waiting = alerts.filter((a) => a.action);
  const news = alerts.filter((a) => !a.action).slice(0, Math.max(0, SHOWN - waiting.length));
  const count = waiting.length;
  const hidden = alerts.length - waiting.length - news.length;

  return (
    <div className="bell-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className="icon-btn bell customer-bell"
        aria-expanded={open}
        aria-controls="customer-notification-menu"
        aria-label={count ? `การแจ้งเตือน ${count} เรื่องรอคุณ` : 'การแจ้งเตือน'}
        title="การแจ้งเตือน"
        onClick={() => {
          setOpen(!open);
          // What is already known shows at once; the latest is asked for behind it.
          if (!open) void overview.refetch();
        }}
      >
        <Icon name="bell" />
        {count > 0 && <span className="bell-count">{count > 99 ? '99+' : count}</span>}
      </button>
      <div className="note-dropdown" id="customer-notification-menu" role="dialog" aria-label="การแจ้งเตือน" hidden={!open}>
        {open && (
          <>
            <div className="note-menu-head">
              <div className="note-menu-title">
                <strong>การแจ้งเตือน</strong>
                <span className="note-menu-summary">{count ? `${count} เรื่องรอคุณ` : alerts.length ? 'ไม่มีเรื่องที่รอคุณ' : 'ยังไม่มีการแจ้งเตือน'}</span>
              </div>
              <span className="note-menu-total" aria-hidden="true">
                {count}
              </span>
            </div>
            <div className="note-menu-body">
              {alerts.length ? (
                <>
                  <Section label="รอคุณ" tone="waiting" list={waiting} />
                  <Section label="ความคืบหน้าล่าสุด" tone="new" list={news} />
                </>
              ) : (
                <div className="note-empty">
                  <span className="note-empty-icon">
                    <Icon name="checkCircle" />
                  </span>
                  <strong>ไม่มีการแจ้งเตือน</strong>
                  <span className="muted">เมื่อทีมงานตอบกลับ ขอข้อมูลเพิ่ม หรือดำเนินการเรื่องของคุณเสร็จ จะแจ้งที่นี่</span>
                </div>
              )}
            </div>
            <Link className="note-menu-foot" href="/customer/alerts">
              {hidden > 0 ? `ดูทั้งหมด (อีก ${hidden} รายการ)` : 'ดูการแจ้งเตือนทั้งหมด'} <Icon name="arrow" />
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
