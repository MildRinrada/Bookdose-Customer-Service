import { Icon } from '@/components/Icon';
import { date } from '@/lib/format';

/* The platform's announcement to every organization (คอนโซลระบบกลาง → ภาพรวมระบบ → ประกาศถึงทุกองค์กร), at the top of
   every staff page and, when it was written for customers too, of the customer's pages. The server sends it only
   while it lasts. Markup: pages/platform-health.css (.announcement-bar). */

export type ActiveAnnouncement = { text: string; level: 'info' | 'warning'; ends_at: string | null };

export function AnnouncementBar({ announcement }: { announcement?: ActiveAnnouncement | null }) {
  if (!announcement) return null;
  return (
    <div className={`announcement-bar ${announcement.level}`} role="status">
      <Icon name={announcement.level === 'warning' ? 'bolt' : 'bell'} />
      <span>
        {announcement.text}
        {announcement.ends_at && <span className="tiny"> · ถึง {date(announcement.ends_at, true)}</span>}
      </span>
    </div>
  );
}
