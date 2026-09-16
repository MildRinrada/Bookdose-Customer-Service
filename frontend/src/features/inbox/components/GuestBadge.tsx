import { Icon } from '@/components/Icon';
import { reachText } from '@/features/guest/labels';
import type { GuestReach } from '@/features/guest/types';

/* "ผู้เยี่ยมชม": the customer chatted on the web without an account. The badge says so (with how they can be reached
   in its title); `detail` also writes the ways out, for the conversation header and the customer card. */

export function GuestBadge({ guest, detail = false }: { guest: GuestReach | null | undefined; detail?: boolean }) {
  if (!guest) return null;
  const reach = reachText(guest.follow);
  const badge = (
    <span className="badge guest-badge" title={`ลูกค้าแชทโดยไม่ได้เข้าสู่ระบบ · ${reach}`}>
      <Icon name="globe" />
      ผู้เยี่ยมชม
      {!detail && <span className="sr-only"> · {reach}</span>}
    </span>
  );
  if (!detail) return badge;
  return (
    <>
      {badge}
      <span className="guest-reach-text tiny">{reach}</span>
    </>
  );
}
