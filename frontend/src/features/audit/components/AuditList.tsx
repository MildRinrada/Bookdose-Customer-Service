'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { Icon } from '@/components/Icon';
import { clockTime, date, dayLabel } from '@/lib/format';
import { priorityLabels, statusLabels } from '@/lib/labels';
import { useWorkspace } from '@/lib/session';
import { Avatar } from '@/components/ui/display';
import {
  auditAutomated,
  auditEventGroup,
  auditFieldLabels,
  auditGroups,
  auditIcon,
  auditImportant,
  auditLabel,
  auditLink,
  auditParties,
  auditTone,
} from '../labels';
import type { AuditEvent } from '../types';

/* Events read newest first, in days: the header answers "when", the rows answer "who did what" - their avatar (the
   AI's mark for the system's own work), the item, its kind, a "สำคัญ" mark and repeats folded into one row.
   Used by the activity log, a case's history and the platform console. Markup: old-frontend/pages/audit/audit-*.html. */

type Change = { before?: unknown; after?: unknown };

/** The words for a case update's detail ("สถานะ: ใหม่ → กำลังดำเนินการ · …"); '' for other events. Works without a
    workspace too (the platform console), where member and team ids stay as they are. */
export function useAuditChanges() {
  const { data: work } = useWorkspace();
  return useCallback(
    (event: AuditEvent): string => {
      if (event.action !== 'ticket.updated' || !event.detail) return '';
      let changes: unknown;
      try {
        changes = JSON.parse(event.detail);
      } catch {
        return event.detail;
      }
      if (!changes || typeof changes !== 'object') return '';
      const name = (field: string, value: unknown): string => {
        const text = value == null ? '' : String(value);
        if (field === 'status') return statusLabels[text] || text;
        if (field === 'priority') return priorityLabels[text] || text;
        if (field === 'assignee_id') return text ? work?.members.find((m) => m.id === text)?.name || 'ยังไม่มอบหมาย' : 'ยังไม่มอบหมาย';
        return work?.teams.find((t) => t.id === text)?.name || text || '-';
      };
      return Object.entries(changes as Record<string, Change>)
        .map(([field, change]) => `${auditFieldLabels[field] || field}: ${name(field, change?.before)} → ${name(field, change?.after)}`)
        .join(' · ');
    },
    [work],
  );
}

/** Events in a row that are the same (who, what and on which item) read as one line with a count. */
type Run = { first: AuditEvent; all: AuditEvent[] };

function runs(list: AuditEvent[]): Run[] {
  const out: Run[] = [];
  for (const e of list) {
    const last = out[out.length - 1];
    if (last && last.first.actor === e.actor && last.first.action === e.action && last.first.entity === e.entity) last.all.push(e);
    else out.push({ first: e, all: [e] });
  }
  return out;
}

export function AuditList({ events }: { events: AuditEvent[] }) {
  const changesOf = useAuditChanges();
  if (!events.length) return <p className="empty-mini">ไม่พบกิจกรรมตามตัวกรอง ลองล้างตัวกรองหรือขยายช่วงวันที่</p>;
  const days = new Map<string, { when: Date; list: AuditEvent[] }>();
  for (const e of events) {
    const when = new Date(e.created_at);
    const key = when.toDateString();
    const day = days.get(key) ?? days.set(key, { when, list: [] }).get(key)!;
    day.list.push(e);
  }
  return (
    <>
      {[...days.entries()].map(([key, day]) => (
        <section className="audit-day" key={key}>
          <h2 className="audit-day-head">
            {dayLabel(day.when)}
            <span className="muted">{day.list.length} กิจกรรม</span>
          </h2>
          <ol className="audit-list">
            {runs(day.list).map((run, i) => (
              <AuditEventRow key={run.first.id ?? `${run.first.created_at}-${i}`} run={run} changes={changesOf(run.first)} />
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}

function ActorAvatar({ name, automated }: { name: string; automated: boolean }) {
  if (automated)
    return (
      <span className="audit-avatar audit-avatar-system" aria-hidden="true">
        <Icon name="sparkle" />
      </span>
    );
  return (
    <span className="audit-avatar" aria-hidden="true">
      <Avatar name={name} index={[...name].reduce((n, ch) => n + ch.charCodeAt(0), 0)} />
    </span>
  );
}

function AuditEventRow({ run, changes }: { run: Run; changes: string }) {
  const e = run.first;
  const group = auditEventGroup(e.action);
  const important = auditImportant(e.action);
  const automated = auditAutomated(e) || /^Bookdose AI$|^ระบบ/.test(e.actor);
  // "ชื่อ เข้าสู่ระบบ", not "ชื่อ · อีเมล เข้าสู่ระบบ ชื่อ · อีเมล": each person once, their email only on hover.
  const { actor, actorEmail, target: name, targetEmail } = auditParties(e);
  const href = name ? auditLink(e) : '';
  return (
    <li className={`audit-event tone-${auditTone(e.action)}${important ? ' important' : ''}`}>
      <time dateTime={e.created_at} title={date(e.created_at, true)}>
        {clockTime(e.created_at)}
      </time>
      <ActorAvatar name={actor} automated={automated} />
      <div className="audit-body">
        <p className="audit-line">
          <strong title={actorEmail || undefined}>{actor}</strong> <span className="audit-label">{auditLabel(e.action) || 'อัปเดตรายการ'}</span>
          {href ? (
            <>
              {' '}
              <Link className="audit-entity" href={href} title={targetEmail || name}>
                <span className="audit-entity-text">{name}</span>
                <Icon name="arrow" />
              </Link>
            </>
          ) : name ? (
            <>
              {' '}
              <span className="audit-entity plain" title={targetEmail || name}>
                <span className="audit-entity-text">{name}</span>
              </span>
            </>
          ) : null}
        </p>
        {changes && <p className="audit-changes">{changes}</p>}
        <div className="audit-meta">
          <span className={`audit-kind kind-${group}`}>
            <Icon name={auditIcon(e.action)} />
            {auditGroups[group].label}
          </span>
          {important && <span className="audit-important">สำคัญ</span>}
          {run.all.length > 1 && (
            <details className="audit-repeat">
              <summary>{run.all.length} ครั้ง</summary>
              <span className="audit-repeat-times">เวลา {run.all.map((x) => clockTime(x.created_at)).join(', ')}</span>
            </details>
          )}
        </div>
      </div>
    </li>
  );
}
