'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { EmptyState } from '@/components/ui/display';
import { date, relative } from '@/lib/format';
import { useOverview } from './hooks';
import { alertKinds } from './labels';
import type { CustomerAlert } from './types';

/* การแจ้งเตือน: what waits for the customer first (counted on the bell), then the latest news of their cases
   (pages/customer/customer-alerts.html). */

function AlertItem({ alert: a }: { alert: CustomerAlert }) {
  const kind = alertKinds[a.kind];
  if (!kind) return null;
  const ago = a.kind === 'followup' ? date(a.at, true) : a.kind === 'warranty' ? `หมด ${date(a.at)}` : relative(a.at);
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
        {ago}
      </time>
    </Link>
  );
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
          <AlertItem key={`${a.kind}:${a.conversation_id ?? a.case_id ?? a.invoice_id ?? a.contract_id}:${i}`} alert={a} />
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
          <p>สิ่งที่รอคุณ และความคืบหน้าล่าสุดของเรื่องที่ส่งถึงทีมงาน</p>
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
