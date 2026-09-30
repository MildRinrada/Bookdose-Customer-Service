'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { SearchInput } from '@/components/ui/filters';
import { Pager, usePager } from '@/components/ui/Pager';
import { useApi } from '@/lib/query';
import { useUiState } from '@/lib/ui-state';
import { AUDIT_PATH } from './api';
import { AuditList } from './components/AuditList';
import { auditAutomated, auditEntityName, auditEventGroup, auditGroups, auditImportant, auditLabel, auditParties, auditRanges } from './labels';
import type { AuditEvent, AuditFilters, AuditPage } from './types';

/* Activity log (admins): who did what, grouped by day. Three figures on top (activity in the period, who did most,
   what matters), then the choices - a search, a period, a person, the system's own work shown or not - and the kinds
   as tabs, "สำคัญ" first. Markup: pages/audit.css (audit-summary, audit-toolbar, audit-tabs). */

export function AuditScreen() {
  const page = useApi<AuditPage>(AUDIT_PATH);
  if (page.isPending) return <PageLoading />;
  if (page.error) return <ErrorState error={page.error} onRetry={() => void page.refetch()} />;
  return <AuditView events={page.data.events} />;
}

const DAY = 86400000;

function inPeriod(e: AuditEvent, f: AuditFilters, now: number): boolean {
  const at = new Date(e.created_at).getTime();
  if (f.range === 'today') return new Date(at).toDateString() === new Date(now).toDateString();
  if (f.range === '7' || f.range === '30') return at >= now - Number(f.range) * DAY;
  if (f.range === 'custom')
    return (!f.from || at >= new Date(f.from + 'T00:00:00').getTime()) && (!f.to || at <= new Date(f.to + 'T23:59:59.999').getTime());
  return true;
}

function base(e: AuditEvent, f: AuditFilters, now: number): boolean {
  const term = (f.actor || '').trim().toLowerCase();
  const label = auditLabel(e.action) || e.action;
  return (
    (f.automated || !auditAutomated(e)) &&
    inPeriod(e, f, now) &&
    (!f.person || auditParties(e).actor === f.person) &&
    (!term || [e.actor_display, e.actor, label, auditEntityName(e)].some((v) => String(v || '').toLowerCase().includes(term)))
  );
}

const inTab = (e: AuditEvent, group: string) => !group || (group === 'important' ? auditImportant(e.action) : auditEventGroup(e.action) === group);

function AuditView({ events }: { events: AuditEvent[] }) {
  const [saved, setFilters] = useUiState<AuditFilters>('audit:filters', { range: '7' });
  // The last 7 days unless another period was chosen.
  const f: AuditFilters = { ...saved, range: saved.range ?? '7' };
  // The periods count back from when the page opened.
  const [now] = useState(() => Date.now());
  const pool = events.filter((e) => base(e, f, now));
  const visible = pool.filter((e) => inTab(e, f.group || ''));
  const slice = usePager('audit', visible, { size: 25 });
  // Any change of filter starts the list again from its first page.
  const update = (next: AuditFilters) => {
    setFilters(next);
    slice.setPage(1);
  };
  const people = [...new Set(events.filter((e) => f.automated || !auditAutomated(e)).map((e) => auditParties(e).actor))].sort((a, b) =>
    a.localeCompare(b, 'th'),
  );
  const tabs: [string, string][] = [['', 'ทั้งหมด'], ['important', 'สำคัญ'], ...Object.entries(auditGroups).map(([k, v]) => [k, v.label] as [string, string])];
  const hidden = events.filter((e) => auditAutomated(e) && inPeriod(e, f, now)).length;

  // The figures on top, for the period and the person chosen.
  const byPerson = new Map<string, number>();
  for (const e of pool) if (!auditAutomated(e)) byPerson.set(auditParties(e).actor, (byPerson.get(auditParties(e).actor) ?? 0) + 1);
  const top = [...byPerson.entries()].sort((a, b) => b[1] - a[1])[0];
  const important = pool.filter((e) => auditImportant(e.action)).length;
  const filtered = Boolean(f.actor || f.group || f.person || (f.range ?? '7') !== '7' || f.automated);

  return (
    <>
      <Link href="/settings" className="back-link">
        <Icon name="back" />
        ตั้งค่าองค์กร
      </Link>
      <div className="page-heading">
        <div>
          <h1>ประวัติการทำงาน</h1>
          <p>ใครทำอะไรกับข้อมูลในองค์กรนี้ · เก็บกิจกรรมล่าสุดสูงสุด 300 รายการ</p>
        </div>
      </div>

      <div className="audit-summary">
        <div className="audit-stat">
          <span>กิจกรรม{f.range ? ` · ${auditRanges[f.range] ?? ''}` : 'ทั้งหมด'}</span>
          <strong>{pool.length}</strong>
          <small>{f.automated ? 'รวมงานอัตโนมัติของระบบและ AI' : `ไม่รวมงานอัตโนมัติ ${hidden} รายการ`}</small>
        </div>
        <div className="audit-stat">
          <span>ทำมากที่สุด</span>
          <strong className="audit-stat-name">{top ? top[0] : '-'}</strong>
          <small>{top ? `${top[1]} กิจกรรมในช่วงนี้` : 'ยังไม่มีกิจกรรมจากทีม'}</small>
        </div>
        <button
          type="button"
          className={`audit-stat audit-stat-important${important ? ' has' : ''}`}
          onClick={() => update({ ...f, group: f.group === 'important' ? '' : 'important' })}
          aria-pressed={f.group === 'important'}
        >
          <span>เรื่องสำคัญ</span>
          <strong>{important}</strong>
          <small>ลบ กู้คืน export สิทธิ์ และการตั้งค่า · กดเพื่อดู</small>
        </button>
      </div>

      <section className="card audit-toolbar">
        <div className="audit-toolbar-row">
          <SearchInput
            id="audit-search"
            label="ค้นหาในประวัติการทำงาน"
            placeholder="ค้นหาชื่อผู้ทำ กิจกรรม หรือรายการ"
            value={f.actor || ''}
            onChange={(actor) => update({ ...f, actor })}
          />
          <label className="audit-person">
            <span className="sr-only">ใครทำ</span>
            <select value={f.person || ''} onChange={(e) => update({ ...f, person: e.target.value })}>
              <option value="">ทุกคน</option>
              {people.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="audit-toolbar-row">
          <div className="audit-ranges" role="group" aria-label="ช่วงเวลา">
            {Object.entries(auditRanges).map(([key, label]) => (
              <button key={key} type="button" className="audit-range" aria-pressed={(f.range ?? '7') === key} onClick={() => update({ ...f, range: key })}>
                {label}
              </button>
            ))}
          </div>
          <label className="audit-auto">
            <input type="checkbox" checked={Boolean(f.automated)} onChange={(e) => update({ ...f, automated: e.target.checked })} />
            <span>แสดงงานอัตโนมัติของระบบและ AI</span>
          </label>
          {filtered && (
            <button type="button" className="btn subtle sm" onClick={() => update({ range: '7' })}>
              <Icon name="close" />
              ล้างตัวกรอง
            </button>
          )}
        </div>
        {f.range === 'custom' && (
          <div className="audit-toolbar-row audit-dates">
            <label className="report-field">
              <span>ตั้งแต่</span>
              <input type="date" id="audit-from" value={f.from || ''} onChange={(e) => update({ ...f, from: e.target.value })} />
            </label>
            <label className="report-field">
              <span>ถึง</span>
              <input type="date" id="audit-to" value={f.to || ''} onChange={(e) => update({ ...f, to: e.target.value })} />
            </label>
          </div>
        )}
      </section>

      <div className="audit-tabs" role="group" aria-label="ประเภทกิจกรรม">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`audit-tab${key === 'important' ? ' important' : ''}`}
            aria-pressed={(f.group || '') === key}
            onClick={() => update({ ...f, group: key })}
          >
            {label}
            <span className="audit-tab-count">{pool.filter((e) => inTab(e, key)).length}</span>
          </button>
        ))}
      </div>

      <div id="audit-events">
        <AuditList events={slice.shown} />
        {visible.length > 0 && <Pager slice={slice} unit="กิจกรรม" sizes={[25, 50, 100]} />}
      </div>
    </>
  );
}
