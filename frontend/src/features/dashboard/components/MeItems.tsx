'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import type { MeItem } from '../labels';

/** "ถึงคุณ": the first `limit` things addressed to the member, then a link to all of them. Markup: pages/dashboard/me-item. */
export function MeItems({ items, limit = 6 }: { items: MeItem[]; limit?: number }) {
  if (!items.length) return <div className="empty-mini">ไม่มีรายการรอคุณ ✨</div>;
  return (
    <>
      {items.slice(0, limit).map((n, i) => (
        <Link key={`${n.href}:${n.at}:${i}`} className={`me-item ${n.tone}`} href={n.href}>
          <span className="me-icon">
            <Icon name={n.icon} />
          </span>
          <span className="grow">
            <strong>{n.title}</strong>
            <span className="me-detail">{n.detail}</span>
          </span>
          <span className="me-when">{n.when}</span>
        </Link>
      ))}
      {items.length > limit && (
        <Link className="small" href="/notifications">
          ดูอีก {items.length - limit} รายการ →
        </Link>
      )}
    </>
  );
}
