'use client';

import { Icon } from '@/components/Icon';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { useStaffAlerts, useStaffTickets } from '@/lib/session';
import { useUiState } from '@/lib/ui-state';
import { filterItems, NotificationList, NotificationTabs, type NotificationFilter } from './components/NotificationList';
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
        </div>
      </div>
      <section className="filters">
        <div className="filter-pills" role="group" aria-label="ประเภทการแจ้งเตือน">
          <NotificationTabs items={items} filter={filter} onChange={setFilter} allCount />
        </div>
        <span className="muted article-count" role="status">
          {shown.length} รายการ
        </span>
      </section>
      <div id="notification-list">
        {shown.length ? (
          <section className="note-group">
            <h3>
              <Icon name="bell" />
              รายการทั้งหมด<span className="tag-count">{shown.length}</span>
            </h3>
            <NotificationList items={shown} />
          </section>
        ) : (
          <EmptyState title="ยังไม่มีเรื่องรอดูแล" description="เมื่อมีเคสเกิน SLA หรือบทสนทนารอตอบ จะแสดงที่นี่" icon="checkCircle" />
        )}
      </div>
    </>
  );
}
