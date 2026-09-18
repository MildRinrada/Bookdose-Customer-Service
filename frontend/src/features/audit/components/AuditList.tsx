'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { Icon } from '@/components/Icon';
import { clockTime, date, dayLabel } from '@/lib/format';
import { priorityLabels, statusLabels } from '@/lib/labels';
import { useWorkspace } from '@/lib/session';
import { auditEventGroup, auditFieldLabels, auditGroups, auditIcon, auditLabel, auditLink, auditParties, auditTone } from '../labels';
import type { AuditEvent } from '../types';

/* Events read newest first, in days: the header answers "when", the rows answer "what" (the old auditHTML).
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
            {day.list.map((e, i) => (
              <AuditEventRow key={e.id ?? `${e.created_at}-${i}`} event={e} changes={changesOf(e)} />
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}

function AuditEventRow({ event: e, changes }: { event: AuditEvent; changes: string }) {
  const group = auditEventGroup(e.action);
  // "ชื่อ เข้าสู่ระบบ", not "ชื่อ · อีเมล เข้าสู่ระบบ ชื่อ · อีเมล": each person once, their email only on hover.
  const { actor, actorEmail, target: name, targetEmail } = auditParties(e);
  const href = name ? auditLink(e) : '';
  return (
    <li className={`audit-event tone-${auditTone(e.action)}`}>
      <time dateTime={e.created_at} title={date(e.created_at, true)}>
        {clockTime(e.created_at)}
      </time>
      <span className="audit-icon" title={auditGroups[group].label}>
        <Icon name={auditIcon(e.action)} />
      </span>
      <div className="audit-body">
        <p className="audit-line">
          <strong title={actorEmail || undefined}>{actor}</strong> <span className="audit-label">{auditLabel(e.action) || 'อัปเดตรายการ'}</span>
          {href ? (
            <>
              {' '}
              <Link className="audit-entity" href={href} title={targetEmail || undefined}>
                {name}
                <Icon name="arrow" />
              </Link>
            </>
          ) : name ? (
            <>
              {' '}
              <span className="audit-entity plain" title={targetEmail || undefined}>
                {name}
              </span>
            </>
          ) : null}
        </p>
        {changes && <p className="audit-changes">{changes}</p>}
      </div>
    </li>
  );
}
