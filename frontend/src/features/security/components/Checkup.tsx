'use client';

import Link from 'next/link';
import { Icon, type IconName } from '@/components/Icon';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { date, relative } from '@/lib/format';
import { useApi } from '@/lib/query';
import { CHECKUP_PATH } from '../api';
import type { Checkup, CheckupItem, CheckupLevel, SecurityCheck } from '../types';

/* ความปลอดภัย → ตรวจสุขภาพ (backend security/checkup.py): is this platform set up safely, checked when the tab opens -
   the security headers and the HTTPS certificate the site's visitors get, the encryption key kept apart from the data
   folder, Turnstile, and organizations with no admin or no storage quota. Each check says why it matters and links to
   where it is fixed. Markup: pages/security.css (.checkup-*). */

const GROUPS: Array<[string, SecurityCheck['key'][]]> = [
  ['เว็บไซต์', ['headers', 'https']],
  ['ระบบ', ['key', 'turnstile']],
  ['องค์กร', ['admins', 'quota']],
];

const LOOK: Record<CheckupLevel, [IconName, string]> = {
  ok: ['checkCircle', 'ผ่าน'],
  warning: ['shield', 'ควรแก้'],
  critical: ['bolt', 'ต้องแก้ทันที'],
  info: ['help', 'ไม่เกี่ยวกับเครื่องนี้'],
};

function Item({ item }: { item: CheckupItem }) {
  return (
    <li className={`checkup-item${item.ok ? ' ok' : ''}`}>
      <Icon name={item.ok ? 'check' : 'close'} />
      <span className="checkup-item-text">
        <strong>{item.label}</strong>
        {item.note && <span className="muted">{item.note}</span>}
      </span>
      {item.href && (
        <Link className="btn sm" href={item.href}>
          {item.link}
        </Link>
      )}
    </li>
  );
}

function Check({ check }: { check: SecurityCheck }) {
  const [icon, word] = LOOK[check.level];
  return (
    <li className={`checkup-check is-${check.level}`}>
      <span className="checkup-mark" title={word}>
        <Icon name={icon} />
        <span className="sr-only">{word}</span>
      </span>
      <div className="checkup-text">
        <h3>{check.title}</h3>
        <p>{check.detail}</p>
        {check.items.length > 0 && (
          <ul className="checkup-items">
            {check.items.map((item) => (
              <Item key={item.label + (item.href ?? '')} item={item} />
            ))}
          </ul>
        )}
      </div>
      {check.action && (
        <Link className={`btn sm${check.level === 'critical' ? ' primary' : ''}`} href={check.action.href}>
          {check.action.label}
        </Link>
      )}
    </li>
  );
}

export function CheckupPanel() {
  const checkup = useApi<Checkup>(CHECKUP_PATH);
  if (checkup.error) return <ErrorState error={checkup.error} onRetry={() => void checkup.refetch()} />;
  if (!checkup.data) return <PageLoading />;
  const { checks, counts, site, checked_at } = checkup.data;
  const byKey = new Map<string, SecurityCheck>(checks.map((c) => [c.key, c]));
  const needs = counts.warning + counts.critical;
  return (
    <div className="checkup">
      <section className="card checkup-summary">
        <div>
          <h2>{needs ? `ต้องดูแล ${needs} เรื่อง` : 'ตั้งค่าความปลอดภัยครบแล้ว'}</h2>
          <p className="muted">
            {site ? `ตรวจจาก ${site}` : 'ยังไม่ได้ตั้งโดเมนเว็บไซต์'} · ตรวจเมื่อ <time dateTime={checked_at} title={date(checked_at, true)}>{relative(checked_at)}</time>
          </p>
          <ul className="checkup-counts">
            {(['critical', 'warning', 'ok'] as const).map((level) =>
              counts[level] ? (
                <li key={level} className={`is-${level}`}>
                  {LOOK[level][1]} {counts[level]}
                </li>
              ) : null,
            )}
          </ul>
        </div>
        <button type="button" className="btn" disabled={checkup.isFetching} onClick={() => void checkup.refetch()}>
          <Icon name="restore" />
          {checkup.isFetching ? 'กำลังตรวจ…' : 'ตรวจอีกครั้ง'}
        </button>
      </section>
      {GROUPS.map(([title, keys]) => (
        <section key={title} className="card checkup-group">
          <div className="card-header">
            <h2>{title}</h2>
          </div>
          <ul className="checkup-list">
            {keys.map((key) => {
              const check = byKey.get(key);
              return check ? <Check key={key} check={check} /> : null;
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
