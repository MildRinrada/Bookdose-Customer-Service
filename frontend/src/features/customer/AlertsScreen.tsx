'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { EmptyState } from '@/components/ui/display';
import { date, relative } from '@/lib/format';
import { useOverview } from './hooks';
import { alertKinds } from './labels';
import type { CustomerAlert } from './types';

/* การแจ้งเตือน: what waits for the customer first (counted on the bell), then the latest news of their chats and
   cases (pages/customer/customer-alerts.html). Every alert has its button, a link to where it is done.
   Markup: pages/alerts-customer.css. */

function AlertItem({ alert: a }: { alert: CustomerAlert }) {
  const kind = alertKinds[a.kind];
  if (!kind) return null;
  const ago = a.kind === 'followup' ? date(a.at, true) : relative(a.at);
  const href = kind.href(a);
  return (
    <div className={`note-item note-actionable note-${kind.tone}`} data-kind={a.kind}>
      <span className="note-icon">
        <Icon name={kind.icon} />
      </span>
      <Link className="note-body note-link" href={href}>
        <strong>{kind.title(a)}</strong>
        <span className="note-detail">{kind.detail(a)}</span>
      </Link>
      <span className="note-side">
        <time className="note-time" dateTime={a.at} title={date(a.at, true)}>
          {ago}
        </time>
        {a.action_label && (
          <span className="note-actions">
            <Link className={a.action ? 'btn primary' : 'btn'} href={href}>
              {a.action_label}
            </Link>
          </span>
        )}
      </span>
    </div>
  );
}

function alertKey(a: CustomerAlert) {
  return `${a.kind}:${a.conversation_id ?? a.case_id}`;
}

function AlertGroup({ label, icon, list }: { label: string; icon: string; list: CustomerAlert[] }) {
  if (!list.length) return null;
  return (
    <section className="note-group">
      <h3>
        <Icon name={icon} />
        {label}
        <span className="tag-count">{list.length}</span>
      </h3>
      <div className="note-list">
        {list.map((a, i) => (
          <AlertItem key={`${alertKey(a)}:${i}`} alert={a} />
        ))}
      </div>
    </section>
  );
}

export function AlertsScreen() {
  const alerts = useOverview().alerts;
  const waiting = alerts.filter((a) => a.action);
  const news = alerts.filter((a) => !a.action);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>การแจ้งเตือน</h1>
          <p>สิ่งที่รอคุณ และความคืบหน้าล่าสุดของเรื่องที่ส่งถึงทีมงาน · เลือกช่องทางรับการแจ้งเตือนได้ที่ <Link href="/customer/account">ตั้งค่าบัญชี</Link></p>
        </div>
      </div>
      {alerts.length ? (
        <div id="notification-list" className="customer-alerts">
          <AlertGroup label="รอคุณ" icon="bell" list={waiting} />
          <AlertGroup label="ความคืบหน้าล่าสุด" icon="clock" list={news} />
        </div>
      ) : (
        <section className="card">
          <EmptyState title="ไม่มีการแจ้งเตือน" description="เมื่อทีมงานตอบกลับ ขอข้อมูลเพิ่ม หรือดำเนินการเรื่องของคุณเสร็จ จะแจ้งที่นี่" icon="bell" />
        </section>
      )}
    </>
  );
}
