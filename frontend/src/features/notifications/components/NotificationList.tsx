'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { FilterPill } from '@/components/ui/filters';
import { date, shortAgo } from '@/lib/format';
import { notificationKinds } from '../items';
import type { NotificationItem, NotificationKind } from '../types';

/* Markup: pages/notifications/notification-item, notifications-clear. */

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
