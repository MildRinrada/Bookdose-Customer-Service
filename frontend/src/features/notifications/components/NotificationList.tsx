'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { Icon } from '@/components/Icon';
import { FilterPill } from '@/components/ui/filters';
import { date, shortAgo } from '@/lib/format';
import { notificationKinds } from '../items';
import type { NotificationItem, NotificationKind } from '../types';

/* Markup: pages/notifications/notification-item, notifications-clear. The bell's panel and the notifications screen
   share the dark summary head and the groups by urgency (styles/pages/notifications.css). */

type Tone = NotificationItem['tone'];
// Most urgent first: what is late comes before what is waiting, and what is only new comes last.
const TONES: Array<[Tone, string, string]> = [
  ['late', 'ด่วน', 'ต้องรีบจัดการ'],
  ['waiting', 'รอตอบ', 'รอคำตอบ'],
  ['new', 'ใหม่', 'เข้ามาใหม่'],
];

const toneCounts = (items: NotificationItem[]) =>
  TONES.map(([tone, label]) => ({ tone, label, count: items.filter((n) => n.tone === tone).length }));

/** A bar split by how many items are late, waiting and new. Widths are set through the CSSOM (no style attribute). */
function ToneMeter({ items }: { items: NotificationItem[] }) {
  const bar = useRef<HTMLDivElement>(null);
  const tones = toneCounts(items);
  const key = tones.map((t) => t.count).join(',');
  useEffect(() => {
    bar.current?.querySelectorAll<HTMLElement>('[data-count]').forEach((part) => part.style.setProperty('flex-grow', part.dataset.count || '0'));
  }, [key]);
  return (
    <div className="note-meter" ref={bar} aria-hidden="true">
      {tones.map((t) => t.count > 0 && <span key={t.tone} className={`note-meter-${t.tone}`} data-count={t.count} />)}
    </div>
  );
}

/** The dark head: the title, how many are waiting by urgency, the total large and the urgency bar. */
export function NotificationSummary({ items, title, note, className = '' }: { items: NotificationItem[]; title: string; note?: string; className?: string }) {
  const count = items.length;
  const summary = toneCounts(items)
    .filter((t) => t.count)
    .map((t) => `${t.label} ${t.count}`)
    .join(' · ');
  return (
    <div className={`note-menu-head ${className}`}>
      <div className="note-menu-title">
        <strong>{title}</strong>
        <span className="note-menu-summary">{count ? summary : 'ไม่มีเรื่องรอดูแล'}</span>
        {note && <span className="note-menu-note">{note}</span>}
      </div>
      <span className="note-menu-total" aria-hidden="true">
        {count > 99 ? '99+' : count}
      </span>
      {count > 0 && <ToneMeter items={items} />}
    </div>
  );
}

/** The items in groups from most to least urgent, each under a small heading with its number. */
export function NotificationGroups({ items }: { items: NotificationItem[] }) {
  return (
    <>
      {TONES.map(([tone, , title]) => {
        const group = items.filter((n) => n.tone === tone);
        if (!group.length) return null;
        return (
          <section key={tone} className={`note-section note-section-${tone}`}>
            <h3>
              {title} <span>{group.length}</span>
            </h3>
            <NotificationList items={group} />
          </section>
        );
      })}
    </>
  );
}

export function NotificationLink({ item: n }: { item: NotificationItem }) {
  return (
    <Link className={`note-item note-${n.tone}`} href={n.href}>
      <span className="note-icon">
        <Icon name={n.icon} />
      </span>
      <span className="note-body">
        <strong>{n.title}</strong>
        <span className="note-detail">{n.detail}</span>
      </span>
      <time className="note-time" dateTime={n.at} title={date(n.at, true)}>
        {shortAgo(n.at)}
      </time>
    </Link>
  );
}

export function NotificationList({ items }: { items: NotificationItem[] }) {
  return (
    <div className="note-list">
      {items.map((n, i) => (
        <NotificationLink key={`${n.href}:${n.title}:${i}`} item={n} />
      ))}
    </div>
  );
}

export function NotificationsClear({ all }: { all: boolean }) {
  return (
    <div className="note-empty">
      <span className="note-empty-icon">
        <Icon name="checkCircle" />
      </span>
      <strong>{all ? 'ไม่มีเรื่องรอดูแล' : 'หมวดนี้ไม่มีเรื่องรอดูแล'}</strong>
      <span className="muted">เคสเกิน SLA เคสที่ยังไม่มอบหมาย และบทสนทนาที่รอตอบ จะขึ้นที่นี่</span>
    </div>
  );
}

export type NotificationFilter = 'all' | NotificationKind;

/** The pills: "ทั้งหมด" then one per kind. `allCount` false leaves the number off "ทั้งหมด" (the bell's head shows it). */
export function NotificationTabs({
  items,
  filter,
  onChange,
  allCount,
}: {
  items: NotificationItem[];
  filter: NotificationFilter;
  onChange: (filter: NotificationFilter) => void;
  allCount: boolean;
}) {
  const tabs: Array<[NotificationFilter, string, number]> = [
    ['all', 'ทั้งหมด', allCount ? items.length : 0],
    ...(Object.entries(notificationKinds) as Array<[NotificationKind, { label: string }]>).map(
      ([kind, meta]): [NotificationFilter, string, number] => [kind, meta.label, items.filter((n) => n.kind === kind).length],
    ),
  ];
  return (
    <>
      {tabs.map(([key, label, count]) => (
        <FilterPill key={key} value={key} label={label} pressed={filter === key} count={count} onClick={() => onChange(key)} />
      ))}
    </>
  );
}

export const filterItems = (items: NotificationItem[], filter: NotificationFilter) => (filter === 'all' ? items : items.filter((n) => n.kind === filter));
