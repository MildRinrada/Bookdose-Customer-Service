import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { ApiError } from '@/lib/api/client';
import { channelIcons, channelNames, priorityLabels, statusLabels, tenantStatusLabels } from '@/lib/labels';

/* Small pieces every screen shows the same way. Class names are the stylesheet's (src/styles). */

/** Two letters of the name on one of four colors. */
export function Avatar({ name, index = 0 }: { name: string | null | undefined; index?: number }) {
  return <span className={`avatar a${index % 4}`}>{[...String(name || '?')].slice(0, 2).join('')}</span>;
}

export function ProfilePhoto({ src, alt = 'รูปโปรไฟล์ของคุณ' }: { src: string; alt?: string }) {
  // A data: URL from the server; next/image adds nothing for it.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="avatar profile-avatar" src={src} alt={alt} />;
}

/** A case or organization status. */
export function Badge({ status, label }: { status: string; label?: string }) {
  return <span className={`badge ${status}`}>{label ?? statusLabels[status] ?? tenantStatusLabels[status] ?? status}</span>;
}

export function PriorityTag({ value }: { value: string }) {
  return <span className={`priority ${value}`}>{priorityLabels[value] ?? value}</span>;
}

export function ChannelBadge({ kind }: { kind: string }) {
  const name = channelNames[kind] ?? kind;
  return (
    <span className={`badge channel-${kind}`} title={name}>
      <Icon name={channelIcons[kind] ?? 'chat'} />
      <span>{name}</span>
    </span>
  );
}

/** Nothing to show yet, and what to do about it. */
export function EmptyState({
  title,
  description = '',
  icon = 'inbox',
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: string;
  /** Buttons or links under the text. */
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}

/** One number with its label and trend, shared by the overview and the reports. */
export function StatCard({
  label,
  value,
  icon,
  color = '',
  foot,
  href,
  urgent = false,
}: {
  label: ReactNode;
  value: ReactNode;
  icon: string;
  color?: '' | 'green' | 'amber' | 'red' | 'blue' | (string & {});
  foot: ReactNode;
  href: string;
  urgent?: boolean;
}) {
  return (
    <Link href={href} className={`stat-card${urgent ? ' urgent' : ''}`}>
      <div className="stat-top">
        {label}
        <span className={`stat-icon ${color}`}>
          <Icon name={icon} />
        </span>
      </div>
      <div className="stat-value mono">{value}</div>
      <div className={`stat-foot ${color === 'green' ? 'good' : ''}`}>
        {foot} <Icon name="arrow" />
      </div>
    </Link>
  );
}

/** One bar of a count chart (overview and reports: cases per day; system: API requests per hour).
    Markup: pages/dashboard/chart-column. */
/** One day's column. `tone` marks a day the report found unusual ('high' busier, 'low' quieter than usual). */
export function ChartColumn({ tip, count, max, day, tone }: { tip: string; count: number; max: number; day: ReactNode; tone?: 'high' | 'low' }) {
  return (
    <div className={`chart-col${tone ? ` ${tone}` : ''}`} tabIndex={0} role="img" aria-label={tip} data-tip={tip}>
      <progress value={count} max={max} aria-hidden="true" />
      <small aria-hidden="true">{day}</small>
    </div>
  );
}

/** Nothing in a short list, with what to do instead (pages/customer/customer-none). */
export function CustomerNone({ title, hint }: { title: ReactNode; hint: ReactNode }) {
  return (
    <div className="customer-none">
      <strong>{title}</strong>
      <span className="muted">{hint}</span>
    </div>
  );
}

/** One article in a list of answers: the customer FAQ and the Bookdose guides (pages/customer/customer-article). */
export function CustomerArticleRow({ href, title, category, excerpt }: { href: string; title: ReactNode; category: ReactNode; excerpt: ReactNode }) {
  return (
    <Link className="customer-article" href={href}>
      <span className="customer-article-icon">
        <Icon name="book" />
      </span>
      <span className="customer-article-text">
        <span className="customer-article-head">
          <strong>{title}</strong>
          <span className="customer-article-category">{category}</span>
        </span>
        <span className="customer-article-excerpt">{excerpt}</span>
      </span>
      <span className="customer-article-go" aria-hidden="true">
        <Icon name="arrow" />
      </span>
    </Link>
  );
}

/** Says that a case or conversation is visible to this organization's members only. */
export function PrivacyTag({ org }: { org: string | null | undefined }) {
  const name = org || 'องค์กรนี้';
  return (
    <span
      className="privacy-tag"
      title={`เคสและบทสนทนานี้เปิดได้เฉพาะสมาชิกขององค์กร ${name} · สิทธิ์ผู้ดูแลแพลตฟอร์มอย่างเดียวอ่านไม่ได้`}
    >
      <Icon name="lock" />
      เฉพาะสมาชิก {name}
    </span>
  );
}

/** The whole-screen wait before the first answer from the server. */
export function InitialLoading({ text = 'กำลังเปิดพื้นที่ทำงาน…' }: { text?: string }) {
  return (
    <div className="initial-loading" role="status">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" width={48} height={48} alt="Bookdose" />
      <p>{text}</p>
    </div>
  );
}

/** A screen's own data is still on its way (the frame around it is already there). */
export function PageLoading() {
  return (
    <div className="empty" role="status" aria-live="polite">
      <Icon name="clock" />
      <h3>กำลังโหลด…</h3>
      <p />
    </div>
  );
}

/* What a screen that could not open says. The page that is actually in front of somebody is the one that has to
   explain itself: "เกิดข้อผิดพลาด" beside a padlock tells a visitor they are shut out, when the truth may be that the
   program behind the page is not answering. Each kind of failure gets its own words and its own picture, and the
   server's own sentence is kept underneath whenever it said one. */
const FAILURES: Record<string, { title: string; hint: string; icon: string }> = {
  offline: { title: 'ติดต่อเซิร์ฟเวอร์ไม่ได้', hint: 'ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต แล้วกดลองใหม่', icon: 'cloud' },
  denied: { title: 'เข้าหน้านี้ไม่ได้', hint: 'บัญชีของคุณไม่มีสิทธิ์ดูหน้านี้ หรือเซสชันหมดอายุแล้ว', icon: 'lock' },
  missing: { title: 'ไม่พบหน้านี้', hint: 'ลิงก์อาจหมดอายุ หรือรายการถูกย้าย/ลบไปแล้ว', icon: 'search' },
  busy: { title: 'ขอบ่อยเกินไป', hint: 'รอสักครู่แล้วกดลองใหม่', icon: 'clock' },
  server: { title: 'ระบบขัดข้องชั่วคราว', hint: 'ไม่ใช่ความผิดของคุณ · กดลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งทีมงาน', icon: 'storm' },
  unknown: { title: 'เปิดหน้านี้ไม่สำเร็จ', hint: 'กดลองใหม่อีกครั้ง', icon: 'help' },
};

function failureOf(error: unknown) {
  const status = error instanceof ApiError ? error.status : null;
  if (status === null) return FAILURES.unknown;
  if (status === 0) return FAILURES.offline;
  if (status === 401 || status === 403) return FAILURES.denied;
  if (status === 404) return FAILURES.missing;
  if (status === 429) return FAILURES.busy;
  if (status >= 500) return FAILURES.server;
  return FAILURES.unknown;
}

/** A screen that could not open: what went wrong, the server's own reason under it, and a way to try again. */
export function ErrorState({
  title,
  error,
  onRetry,
  children,
}: {
  /** Said instead of the words chosen for this kind of failure. */
  title?: string;
  error: unknown;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const failure = failureOf(error);
  const message = error instanceof Error ? error.message : String(error ?? '');
  // The server's sentence is worth reading when it said something of its own; its fallback only repeats the heading.
  const said = message && message !== 'เกิดข้อผิดพลาด กรุณาลองใหม่' ? message : '';
  return (
    <EmptyState
      title={title ?? failure.title}
      icon={failure.icon}
      description={
        <>
          {failure.hint}
          {said && <span className="error-said">{said}</span>}
        </>
      }
    >
      {onRetry && (
        <button type="button" className="btn primary" onClick={onRetry}>
          ลองใหม่
        </button>
      )}{' '}
      {children}
    </EmptyState>
  );
}
