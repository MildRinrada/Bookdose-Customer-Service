'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { staffAccountTabPath } from '@/features/staff-account/tabs';
import { useStaffAlerts, useStaffTickets } from '@/lib/session';
import { useUiState } from '@/lib/ui-state';
import { filterItems, NotificationGroups, NotificationSummary, NotificationTabs, type NotificationFilter } from './components/NotificationList';
import { notificationItems, useCachedConversations } from './items';

/* Notifications: what is waiting for the team right now, built from the cases, the member's alerts and the
   conversations (loaded when the screen opens). Markup: pages/notifications/notifications, notification-group. */

export function NotificationsScreen() {
  const conversations = useCachedConversations(true);
  const tickets = useStaffTickets();
  const alerts = useStaffAlerts();
  const [filter, setFilter] = useUiState<NotificationFilter>('notifications:filter', 'all');

  if (conversations.isPending) return <PageLoading />;
  if (conversations.error) return <ErrorState error={conversations.error} onRetry={() => void conversations.refetch()} />;

  const items = notificationItems({ alerts: alerts.data, tickets: tickets.data?.tickets, conversations: conversations.data.conversations });
  const shown = filterItems(items, filter);
  // The old "รีเฟรช" opened the screen again: cases, alerts and conversations are all asked again.
  const refresh = () => {
    void conversations.refetch();
    void tickets.refetch();
    void alerts.refetch();
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>การแจ้งเตือน</h1>
          <p>เรื่องที่รอคุณดูแล รวมจากเคสบริการและกล่องข้อความ</p>
        </div>
        <div className="flex">
          <button type="button" className="btn subtle" onClick={refresh}>
            <Icon name="clock" />
            รีเฟรช
          </button>
          {/* What decides which of these ever reach you - screen, sound, email - is set in the account, so it is one
              click from the list itself instead of a hunt through ตั้งค่าบัญชี. */}
          <Link className="btn" href={staffAccountTabPath('notifications')}>
            <Icon name="settings" />
            ตั้งค่าการแจ้งเตือน
          </Link>
        </div>
      </div>
      <div className="note-page">
        <NotificationSummary items={items} title="เรื่องที่รอคุณดูแลตอนนี้" note="เรียงจากเรื่องเร่งด่วนที่สุดก่อน" className="note-hero" />
        <div className="note-page-tools">
          <div className="filter-pills" role="group" aria-label="ประเภทการแจ้งเตือน">
            <NotificationTabs items={items} filter={filter} onChange={setFilter} allCount />
          </div>
          <span className="muted" role="status">
            {shown.length} รายการ
          </span>
        </div>
        <div id="notification-list" className="note-page-body">
          {shown.length ? (
            <NotificationGroups items={shown} />
          ) : (
            <EmptyState title="ยังไม่มีเรื่องรอดูแล" description="เมื่อมีเคสเกิน SLA หรือบทสนทนารอตอบ จะแสดงที่นี่" icon="checkCircle" />
          )}
        </div>
      </div>
    </>
  );
}
