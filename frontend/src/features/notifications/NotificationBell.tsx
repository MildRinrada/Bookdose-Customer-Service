'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { api } from '@/lib/api/client';
import { useStaffAlerts } from '@/lib/session';
import { useUiState } from '@/lib/ui-state';
import { filterItems, NotificationGroups, NotificationsClear, NotificationSummary, type NotificationFilter } from './components/NotificationList';
import { CONVERSATIONS_PATH, useNotificationItems } from './items';
// Short labels so the four tabs fit on one row of the panel; the notifications screen keeps the long ones.
const BELL_TABS: Array<[NotificationFilter, string]> = [
  ['all', 'ทั้งหมด'],
  ['me', 'ถึงคุณ'],
  ['ticket', 'เคส'],
  ['inbox', 'ข้อความ'],
];

/* The bell in the staff top bar: the number of things waiting for the team (late or unassigned cases, customers
   waiting for a reply, and what is addressed to the member) and the panel that drops down from it, attached to the
   button so the eye does not have to travel. It closes on a click anywhere else, on Escape, on opening one of its
   items and on moving to another screen. Markup: shell/app-shell (bell-menu), pages/notifications/notifications-menu. */

export function NotificationBell() {
  // The path the panel was opened on: moving to another screen closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useUiState<NotificationFilter>('notifications:menuFilter', 'all');
  const items = useNotificationItems();
  const client = useQueryClient();
  const alerts = useStaffAlerts();
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

  // Opening asks again for the conversations and the member's alerts; what is already known shows meanwhile.
  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    setLoading(true);
    try {
      await Promise.all([
        client.fetchQuery({ queryKey: [CONVERSATIONS_PATH], queryFn: () => api(CONVERSATIONS_PATH), staleTime: 0 }),
        alerts.refetch(),
      ]);
    } catch {
      /* The panel keeps what it shows. */
    } finally {
      setLoading(false);
    }
  };

  const count = items.length;
  const shown = filterItems(items, filter);
  const badge = count > 99 ? '99+' : String(count);

  return (
    <div className="bell-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className="icon-btn bell"
        aria-expanded={open}
        aria-controls="notification-menu"
        aria-label={count ? `การแจ้งเตือน ${count} รายการ` : 'การแจ้งเตือน'}
        title="การแจ้งเตือน"
        onClick={() => void toggle()}
      >
        <Icon name="bell" />
        {count > 0 && <span className="bell-count">{badge}</span>}
      </button>
      <div className="note-dropdown" id="notification-menu" role="dialog" aria-label="การแจ้งเตือน" hidden={!open}>
        {open && (
          <>
            <NotificationSummary items={items} title="การแจ้งเตือน" />
            <div className="note-menu-tabs" role="group" aria-label="ประเภทการแจ้งเตือน">
              {BELL_TABS.map(([key, label]) => {
                const n = filterItems(items, key).length;
                return (
                  <button key={key} type="button" className="note-tab" aria-pressed={filter === key} onClick={() => setFilter(key)}>
                    {label}
                    {n > 0 && key !== 'all' && <span className="note-tab-count">{n}</span>}
                  </button>
                );
              })}
            </div>
            <div className="note-menu-body">
              {shown.length ? (
                <NotificationGroups items={shown} />
              ) : loading ? (
                <p className="note-loading" role="status">
                  กำลังตรวจสอบรายการล่าสุด…
                </p>
              ) : (
                <NotificationsClear all={filter === 'all'} />
              )}
            </div>
            <Link className="note-menu-foot" href="/notifications">
              ดูการแจ้งเตือนทั้งหมด <Icon name="arrow" />
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
