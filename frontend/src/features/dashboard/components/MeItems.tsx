'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import type { MeItem } from '../labels';

/** "ถึงคุณ": up to six things addressed to the member. Markup: pages/dashboard/me-item. */
export function MeItems({ items }: { items: MeItem[] }) {
  if (!items.length) return <div className="empty-mini">ไม่มีรายการรอคุณ ✨</div>;
  return (
    <>
      {items.slice(0, 6).map((n, i) => (
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
    </>
  );
}
