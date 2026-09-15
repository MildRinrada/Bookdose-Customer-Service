'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useRunAction } from '@/components/ui/actions';
import { useDialogs } from '@/components/ui/Dialogs';
import { EmptyState } from '@/components/ui/display';
import { useToast } from '@/components/ui/Toast';
import { customerContractApi } from '@/features/contracts';
import { acceptInvite, declineInvite, teamPath } from '@/features/team/api';
import { date, relative } from '@/lib/format';
import { useInvalidate } from '@/lib/query';
import { OVERVIEW_PATH } from './api';
import { useOverview } from './hooks';
import { alertKinds } from './labels';
import type { CustomerAlert } from './types';

/* การแจ้งเตือน: what waits for the customer first (counted on the bell), then the latest news of their cases
   (pages/customer/customer-alerts.html). Every alert has its button: most open the page where it is done; an
   invitation is accepted and an MA renewal asked for right here. Markup: pages/alerts-customer.css. */

/** The alert's button: accept an invitation or ask for the MA renewal in place, otherwise a link to where it is done. */
function AlertAction({ alert: a, href }: { alert: CustomerAlert; href: string }) {
  const [busy, setBusy] = useState(false);
  const run = useRunAction();
  const refresh = useInvalidate();
  const toast = useToast();
  const { confirm } = useDialogs();
  const act = (action: () => Promise<unknown>) =>
    run(async () => {
      setBusy(true);
      try {
        await action();
      } finally {
        setBusy(false);
      }
    });

  if (a.kind === 'invite' && a.invite_id) {
    const id = a.invite_id;
    return (
      <span className="note-actions">
        <button
          className="btn primary"
          type="button"
          disabled={busy}
          onClick={() =>
            act(async () => {
              await acceptInvite(a.org_slug, id);
              toast(`เข้าร่วมทีมกับ ${a.org_name} แล้ว เอกสารที่ได้รับสิทธิ์อยู่ในเมนูสัญญาและโครงการ`);
              await refresh(OVERVIEW_PATH, teamPath(a.org_slug));
            })
          }
        >
          <Icon name="check" />
          {a.action_label}
        </button>
        <button
          className="btn"
          type="button"
          disabled={busy}
          onClick={() =>
            confirm({
              title: 'ปฏิเสธคำเชิญ',
              message: `ไม่เข้าร่วมทีมของคุณ${a.owner_name ?? ''} กับ ${a.org_name} เจ้าของทีมเชิญใหม่ได้ภายหลัง`,
              confirmLabel: 'ปฏิเสธคำเชิญ',
              cancelLabel: 'ยังไม่ตัดสินใจ',
              tone: 'danger',
              run: async () => {
                await declineInvite(a.org_slug, id);
                toast('ปฏิเสธคำเชิญแล้ว');
                await refresh(OVERVIEW_PATH, teamPath(a.org_slug));
              },
            })
          }
        >
          ปฏิเสธ
        </button>
      </span>
    );
  }

  if (a.kind === 'warranty' && a.contract_id) {
    const docApi = customerContractApi(a.org_slug, a.contract_id);
    return (
      <span className="note-actions">
        <button
          className="btn primary"
          type="button"
          disabled={busy}
          onClick={() =>
            confirm({
              title: 'ขอต่อสัญญา MA',
              message: `ส่งคำขอต่อสัญญาบำรุงรักษา (MA) ของ ${a.reference} “${a.subject}” ถึง ${a.org_name} คำขอจะไปที่แชทของโครงการ แล้วทีมงานจะส่งสัญญา MA ให้ตรวจและลงนาม`,
              confirmLabel: 'ส่งคำขอต่อ MA',
              cancelLabel: 'ยังไม่ขอ',
              run: async () => {
                await docApi.requestRenewal('');
                toast('ส่งคำขอต่อ MA แล้ว ทีมงานจะติดต่อกลับในแชทของโครงการ');
                await refresh(OVERVIEW_PATH, docApi.path);
              },
            })
          }
        >
          <Icon name="shield" />
          {a.action_label}
        </button>
      </span>
    );
  }

  return (
    <span className="note-actions">
      <Link className={a.action ? 'btn primary' : 'btn'} href={href}>
        {a.action_label}
      </Link>
    </span>
  );
}

function AlertItem({ alert: a }: { alert: CustomerAlert }) {
  const kind = alertKinds[a.kind];
  if (!kind) return null;
  const ago = a.kind === 'followup' ? date(a.at, true) : a.kind === 'warranty' ? `หมด ${date(a.at)}` : relative(a.at);
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
        {a.action_label && <AlertAction alert={a} href={href} />}
      </span>
    </div>
  );
}

function alertKey(a: CustomerAlert) {
  return `${a.kind}:${a.conversation_id ?? a.case_id ?? a.invoice_id ?? a.invite_id ?? a.contract_id}:${a.milestone_id ?? ''}`;
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
