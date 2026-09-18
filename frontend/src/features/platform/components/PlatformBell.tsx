'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { date, shortAgo } from '@/lib/format';
import { useApi } from '@/lib/query';
import { NOTIFICATIONS_PATH } from '../api';
import type { PlatformNotice } from '../types';

/* The bell of the platform console: a platform admin has no cases, so it carries what the server needs from them
   (ภาพรวมระบบ → ต้องจัดการ) and the organizations' answers to their support requests. The number counts what needs
   them; advice and a request still waiting are listed without adding to it. Same panel as the organization's bell
   (shell/app-shell bell-menu, pages/notifications/notifications-menu); it closes on a click elsewhere, on Escape, on
   following one of its links and on moving to another screen. */

const tones = { critical: 'late', warning: 'waiting', info: 'new' } as const;

export function PlatformBell() {
  const [openOn, setOpenOn] = useState<string | null>(null);
  const notices = useApi<{ items: PlatformNotice[] }>(NOTIFICATIONS_PATH, { refetchInterval: 60000 });
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const open = openOn === pathname;
  const setOpen = (next: boolean) => setOpenOn(next ? pathname : null);

  useEffect(() => {
    if (!open) return;
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

  const items = notices.data?.items ?? [];
  const count = items.filter((n) => n.notify).length;
  const badge = count > 99 ? '99+' : String(count);

  const toggle = () => {
    if (open) return setOpen(false);
    setOpen(true);
    void notices.refetch();
  };

  return (
    <div className="bell-menu platform-bell" ref={root}>
      <button
        ref={button}
        type="button"
        className="icon-btn bell"
        aria-expanded={open}
        aria-controls="platform-notification-menu"
        aria-label={count ? `การแจ้งเตือน ${count} รายการ` : 'การแจ้งเตือน'}
        title="การแจ้งเตือน"
        onClick={toggle}
      >
        <Icon name="bell" />
        {count > 0 && <span className="bell-count">{badge}</span>}
      </button>
      <div className="note-dropdown" id="platform-notification-menu" role="dialog" aria-label="การแจ้งเตือน" hidden={!open}>
        {open && (
          <>
            <div className="note-menu-head">
              <strong>การแจ้งเตือน</strong>
              {count ? <span className="tag-count">{count}</span> : <span className="muted">ไม่มีเรื่องรอจัดการ</span>}
            </div>
            <div className="note-menu-body">
              {items.length ? (
                <div className="note-list">
                  {items.map((n) => (
                    <Link key={n.key} className={`note-item note-${tones[n.level]}`} href={n.href}>
                      <span className="note-icon">
                        <Icon name={n.icon} />
                      </span>
                      <span className="note-body">
                        <strong>{n.title}</strong>
                        <span className="note-detail">
                          {n.detail}
                          {n.until && ` · ถึง ${date(n.until, true)}`}
                        </span>
                      </span>
                      {n.at && (
                        <time className="note-time" dateTime={n.at} title={date(n.at, true)}>
                          {shortAgo(n.at)}
                        </time>
                      )}
                    </Link>
                  ))}
                </div>
              ) : notices.isPending ? (
                <p className="note-loading" role="status">
                  กำลังตรวจสอบรายการล่าสุด…
                </p>
              ) : (
                <div className="note-empty">
                  <span className="note-empty-icon">
                    <Icon name="checkCircle" />
                  </span>
                  <strong>ระบบไม่มีเรื่องรอจัดการ</strong>
                  <span className="muted">งานเบื้องหลังหยุด ดิสก์ใกล้เต็ม การสำรองข้อมูล และคำตอบของคำขอเข้าช่วยเหลือ จะขึ้นที่นี่</span>
                </div>
              )}
            </div>
            <Link className="note-menu-foot" href="/platform/system">
              ดูภาพรวมระบบ <Icon name="arrow" />
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
