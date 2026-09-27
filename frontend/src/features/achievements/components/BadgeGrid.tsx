import { Icon } from '@/components/Icon';
import { date } from '@/lib/format';
import type { Badge } from '@/lib/types';

/* เหรียญความสำเร็จ: every badge, earned ones first with the day they came, the others with how far along the member
   is. The member's own, never compared with anybody. Markup: pages/team-spirit (badge-). */

export function BadgeGrid({ badges }: { badges: Badge[] }) {
  const sorted = [...badges].sort((a, b) => Number(Boolean(b.earned_at)) - Number(Boolean(a.earned_at)));
  return (
    <ul className="badge-grid">
      {sorted.map((b) => (
        <li key={b.key} className={`badge-tile${b.earned_at ? ' earned' : ''}`}>
          <span className="badge-medal" aria-hidden="true">
            <Icon name={b.icon} />
          </span>
          <span className="badge-text">
            <strong>{b.name}</strong>
            <span>{b.detail}</span>
            {b.earned_at ? (
              <span className="badge-when">ได้เมื่อ {date(b.earned_at)}</span>
            ) : (
              <span className="badge-progress">
                <progress max={b.goal} value={b.progress ?? 0} aria-label={`${b.name} ${b.progress ?? 0} จาก ${b.goal}`} />
                <span>
                  {(b.progress ?? 0).toLocaleString('th-TH')} จาก {b.goal.toLocaleString('th-TH')}
                </span>
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
