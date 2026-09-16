'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { ChartColumn, PageLoading, PriorityTag, StatCard } from '@/components/ui/display';
import { useModalOpen } from '@/features/inbox/hooks';
import { NewTicketButton } from '@/features/tickets/components/NewTicket';
import { TicketTable } from '@/features/tickets/components/TicketTable';
import type { TicketRow } from '@/features/tickets/types';
import { date, isDone, overdue } from '@/lib/format';
import { useApi } from '@/lib/query';
import { useRealtimeInterval } from '@/lib/realtime-provider';
import { useStaffAlerts, useStaffTickets, useStaffUser, useWork } from '@/lib/session';
import { overviewPath } from './api';
import { ManagerView } from './components/ManagerView';
import { MeItems } from './components/MeItems';
import { actionNeeded, meItems } from './labels';
import type { Overview } from './types';

/* Overview: greeting, stat cards, recent cases, "ถึงคุณ" (mentions, follow-ups, escalations), "Action Needed",
   the new-cases chart and, for admins and team leads, the manager view. The overview's own data
   (/api/automation/overview) refreshes every 30 seconds (every minute while live updates are connected, which refresh it on changes)
   while the screen is visible and no dialog is open; it also
   keeps the bell's alerts current. Markup: pages/dashboard/dashboard. */

const REFRESH_MS = 30000;
const dayNames = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

type Tab = 'all' | 'mine' | 'new';

export function DashboardScreen() {
  const [path] = useState(overviewPath);
  const modalOpen = useModalOpen();
  const interval = useRealtimeInterval(modalOpen ? false : REFRESH_MS);
  const overview = useApi<Overview>(path, { refetchInterval: interval });
  const client = useQueryClient();

  // The overview carries the member's alerts too: the bell counts from the freshest copy.
  useEffect(() => {
    if (overview.data) client.setQueryData(['/api/automation/alerts'], overview.data.me);
  }, [overview.data, client]);

  // Without its own data (a failed first request) the rest of the overview still opens, as before.
  if (overview.isPending) return <PageLoading />;
  return <DashboardView dash={overview.data ?? null} />;
}

function DashboardView({ dash }: { dash: Overview | null }) {
  const user = useStaffUser();
  const work = useWork();
  const alerts = useStaffAlerts().data;
  const tickets = (useStaffTickets().data?.tickets ?? []) as TicketRow[];
  const [tab, setTab] = useState<Tab>('all');

  const active = tickets.filter((t) => !isDone(t));
  const late = tickets.filter(overdue);
  const mine = active.filter((t) => t.assignee_id === user.id);
  const today = new Date().toDateString();
  const resolvedToday = tickets.filter((t) => isDone(t) && new Date(t.resolved_at ?? '').toDateString() === today).length;
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 6 + i);
    return d;
  });
  const counts = dates.map((d) => tickets.filter((t) => new Date(t.created_at).toDateString() === d.toDateString()).length);
  const max = Math.max(...counts, 1);
  const chartMid = max > 1 && max % 2 === 0 ? max / 2 : 0;
  const needed = actionNeeded(tickets);
  const me = meItems(dash?.me ?? alerts);
  const moreNeeded = Math.max(0, needed.length - 5);
  const shownTickets = tickets.filter(
    (t) => tab === 'all' || (tab === 'mine' && t.assignee_id === user.id && !isDone(t)) || (tab === 'new' && t.status === 'new'),
  );
  const tabs: Array<[Tab, string, number]> = [
    ['all', 'ทั้งหมด', tickets.length],
    ['mine', 'มอบหมายให้ฉัน', mine.length],
    ['new', 'เคสใหม่', tickets.filter((t) => t.status === 'new').length],
  ];

  return (
    <>
      <div className="page-heading dashboard-heading">
        <h1>
          สวัสดี {user.name.split(' ')[0]} 👋{' '}
          <span className="dashboard-summary">
            {active.length ? (
              <>
                วันนี้มี <strong>{active.length}</strong> เคสที่รอการดูแล
              </>
            ) : (
              'ยังไม่มีเคสที่รอการดูแล'
            )}
          </span>
        </h1>
        <div className="flex">
          <span className="date-label">
            <Icon name="calendar" /> {new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}
          </span>
          <NewTicketButton />
        </div>
      </div>
      <div className="stats-grid">
        <StatCard label="เคสที่กำลังดูแล" value={active.length} icon="ticket" foot="เคสที่ยังไม่แก้ไขหรือปิด" href="/tickets?filter=active" />
        <StatCard label="เคสที่มอบหมายให้ฉัน" value={mine.length} icon="users" color="amber" foot="งานที่คุณเป็นผู้รับผิดชอบ" href="/tickets?filter=mine" />
        <StatCard label="แก้ไขสำเร็จวันนี้" value={resolvedToday} icon="checkCircle" color="green" foot="นับจากเวลาแก้ไขเคสสำเร็จ" href="/tickets?filter=resolved_today" />
        <StatCard
          label="เคสที่เกิน SLA"
          value={late.length}
          icon="clock"
          color="red"
          foot="เวลาตอบกลับหรือเวลาแก้ไข"
          href="/tickets?filter=overdue"
          urgent={late.length > 0}
        />
      </div>
      <div className="dashboard-grid">
        <section className="card">
          <div className="card-header">
            <div>
              <h2>เคสล่าสุด</h2>
              <p>ติดตามทุกเรื่องให้ได้รับการดูแลอย่างต่อเนื่อง</p>
            </div>
            <Link className="btn subtle small" href="/tickets">
              ดูทั้งหมด <Icon name="arrow" />
            </Link>
          </div>
          <div className="tabs">
            {tabs.map(([key, label, count]) => (
              <button key={key} type="button" className={`tab${tab === key ? ' active' : ''}`} data-filter={key} onClick={() => setTab(key)}>
                {label} <span>{count}</span>
              </button>
            ))}
          </div>
          <div id="dashboard-tickets">
            <TicketTable tickets={shownTickets.slice(0, 6)} compact />
          </div>
          <div className="table-footer">
            <span>แสดงสูงสุด 6 เคสล่าสุด</span>
            <Link href="/tickets">ไปที่เคสบริการ →</Link>
          </div>
        </section>
        <aside className="stack dashboard-aside">
          <section className="card me-card">
            <div className="card-header">
              <div>
                <h2>ถึงคุณ</h2>
                <p>ถูกกล่าวถึง · เตือนติดตามผล · เคสที่ยกระดับ</p>
              </div>
              <span className={`badge${me.length ? ' pending_customer' : ''}`} id="me-count">
                {me.length} รายการ
              </span>
            </div>
            <div className="card-body" id="me-items">
              <MeItems items={me} />
            </div>
          </section>
          <section className="card action-needed">
            <div className="card-header">
              <div>
                <h2>เคสที่ต้องดำเนินการทันที</h2>
                <p>Action Needed</p>
              </div>
              <span className={`badge${needed.length ? ' suspended' : ''}`}>{needed.length} เคส</span>
            </div>
            <div className="card-body">
              {needed.length ? (
                needed.slice(0, 5).map(({ t, reason, tone, symbol }) => (
                  <div key={t.id} className={`sla-item ${tone}`}>
                    <div className="flex between">
                      <span className="ticket-id">BD-{t.number}</span>
                      <PriorityTag value={t.priority} />
                    </div>
                    <Link href={`/tickets/${t.id}`} className="truncate">
                      {t.subject}
                    </Link>
                    <div className="time">
                      <Icon name={symbol} /> {reason}
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-mini">ไม่มีเคสที่ต้องเร่งดำเนินการ ✨</div>
              )}
              {moreNeeded > 0 && (
                <Link className="small" href="/tickets?filter=active">
                  ดูอีก {moreNeeded} เคส →
                </Link>
              )}
            </div>
          </section>
          <section className="card">
            <div className="card-header">
              <div>
                <h2>เคสเข้าใหม่</h2>
                <p>ย้อนหลัง 7 วัน · แกนตั้ง: จำนวนเคส</p>
              </div>
              <Icon name="chart" />
            </div>
            <div className="card-body">
              <div className="case-chart">
                <div className="chart-y" aria-hidden="true">
                  <span className="y-top">{max}</span>
                  {chartMid > 0 && <span className="y-mid">{chartMid}</span>}
                  <span className="y-bottom">0</span>
                </div>
                <div className="mini-chart">
                  {dates.map((d, i) => (
                    <ChartColumn key={d.toDateString()} tip={`${date(d)} · ${counts[i]} เคส`} count={counts[i]} max={max} day={dayNames[d.getDay()]} />
                  ))}
                </div>
              </div>
              <div className="chart-legend">ชี้หรือแตะที่แท่งเพื่อดูจำนวนเคส</div>
            </div>
          </section>
        </aside>
      </div>
      {dash?.manager && (
        <section className="manager-view" id="manager-view" aria-labelledby="manager-title">
          <ManagerView manager={dash.manager} />
        </section>
      )}
      <div className="section-bottom">
        <span>พื้นที่ทำงาน {work.tenant.name} · ข้อมูลตามสิทธิ์ของคุณ</span>
        <span>Made for meaningful support. ♡</span>
      </div>
    </>
  );
}
