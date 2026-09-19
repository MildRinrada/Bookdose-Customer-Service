'use client';

import Link from 'next/link';
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Icon } from '@/components/Icon';
import { useOpenOnThisPage } from '@/components/shell/chrome';
import { useRunAction } from '@/components/ui/actions';
import type { WorkStatus } from '@/lib/types';
import { usePreferences } from './prefs';
import { useSaveStatus } from './StatusSettings';

/* The work status in the staff top bar (where "Online" used to be): one tap to go on a break and back, so routing
   stops and starts giving the member new cases (ตั้งค่าบัญชี → สถานะการทำงาน). A button opens a menu of the statuses,
   each with its colour and what it means for new cases; when the status is "available" but the hours or leave say
   otherwise, the dot and the menu say so. Markup: pages/account-settings.css (.status-switch, .status-menu). */

const MEANING: Record<WorkStatus, string> = {
  online: 'ระบบส่งเรื่องใหม่ให้คุณตามปกติ',
  break: 'หยุดรับเรื่องใหม่ชั่วคราว กลับมากดพร้อมได้ทันที',
  busy: 'ไม่รับเรื่องใหม่ เคสที่ถืออยู่ยังเป็นของคุณ',
  offline: 'ไม่รับเรื่องใหม่จนกว่าจะกลับมา',
};

export function StatusSwitch() {
  const view = usePreferences();
  const run = useRunAction();
  const save = useSaveStatus();
  const [open, setOpen] = useOpenOnThisPage();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    // On a narrow screen the button sits near the left edge: the menu moves right until it fits (CSSOM, not a style
    // attribute, which the Content-Security-Policy refuses).
    const menu = root.current?.querySelector<HTMLElement>('.status-menu');
    if (menu) {
      menu.style.removeProperty('right');
      const left = menu.getBoundingClientRect().left;
      if (left < 12) menu.style.setProperty('right', `${left - 12}px`);
    }
    // The current status is where the keyboard starts.
    root.current?.querySelector<HTMLButtonElement>('.status-option[aria-checked="true"]')?.focus();
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  const data = view.data;
  if (!data) return null;
  const status = data.preferences.status;
  const available = data.availability.available;
  const tone = available ? 'online' : status === 'online' ? 'offhours' : status;
  const title = available ? 'พร้อมรับเรื่องใหม่' : `ไม่รับเรื่องใหม่: ${data.availability.reason}`;
  const keys = Object.keys(data.statuses) as WorkStatus[];

  const choose = (key: WorkStatus) => {
    setOpen(false);
    button.current?.focus();
    if (key !== status) void run(() => save(key, data.statuses));
  };
  // ↑/↓ move between the statuses inside the open menu.
  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...(root.current?.querySelectorAll<HTMLButtonElement>('.status-option') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  };

  return (
    <div className="status-menu-root" ref={root}>
      <button
        ref={button}
        type="button"
        className={`status-switch status-${tone}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="status-menu"
        title={title}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="status-dot" aria-hidden="true" />
        <span className="sr-only">สถานะการทำงาน: </span>
        <span className="status-switch-label">{data.statuses[status]}</span>
        <Icon name="down" />
      </button>
      <div className="status-menu" id="status-menu" role="menu" aria-label="เปลี่ยนสถานะการทำงาน" hidden={!open} onKeyDown={onMenuKey}>
        <p className="status-menu-title">สถานะการทำงาน</p>
        {keys.map((key) => (
          <button
            key={key}
            type="button"
            role="menuitemradio"
            aria-checked={key === status}
            className={`status-option status-${key}`}
            onClick={() => choose(key)}
          >
            <span className="status-dot" aria-hidden="true" />
            <span className="status-option-text">
              <strong>{data.statuses[key]}</strong>
              <small>{MEANING[key]}</small>
            </span>
            {key === status && <Icon name="check" />}
          </button>
        ))}
        {!available && status === 'online' && (
          <p className="status-menu-note">
            <Icon name="clock" />
            <span>ตอนนี้ยังไม่รับเรื่องใหม่: {data.availability.reason}</span>
          </p>
        )}
        <Link className="status-menu-more" href="/account?tab=status" onClick={() => setOpen(false)}>
          <Icon name="settings" />
          ตั้งเวลาทำงานและวันลา
        </Link>
      </div>
    </div>
  );
}
