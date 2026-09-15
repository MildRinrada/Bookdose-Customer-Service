'use client';

import { Icon } from '@/components/Icon';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { FilterPill, SearchInput } from '@/components/ui/filters';
import { Pager, usePager } from '@/components/ui/Pager';
import { useApi } from '@/lib/query';
import { useUiState } from '@/lib/ui-state';
import { AUDIT_PATH } from './api';
import { AuditList } from './components/AuditList';
import { auditEntityName, auditEventGroup, auditGroups, auditLabel } from './labels';
import type { AuditEvent, AuditFilters, AuditPage } from './types';

/* Activity log: who did what, grouped by day, filtered by person, kind and date (admins and team leads).
   Markup: old-frontend/pages/audit/audit.html. */

export function AuditScreen() {
  const page = useApi<AuditPage>(AUDIT_PATH);
  if (page.isPending) return <PageLoading />;
  if (page.error) return <ErrorState error={page.error} onRetry={() => void page.refetch()} />;
  return <AuditView events={page.data.events} />;
}

function matches(e: AuditEvent, f: AuditFilters): boolean {
  const term = (f.actor || '').toLowerCase();
  const label = auditLabel(e.action) || e.action;
  return (
    (!term || [e.actor_display, e.actor, label, auditEntityName(e)].some((v) => String(v || '').toLowerCase().includes(term))) &&
    (!f.group || auditEventGroup(e.action) === f.group) &&
    (!f.from || new Date(e.created_at) >= new Date(f.from + 'T00:00:00')) &&
    (!f.to || new Date(e.created_at) <= new Date(f.to + 'T23:59:59.999'))
  );
}

function AuditView({ events }: { events: AuditEvent[] }) {
  const [f, setFilters] = useUiState<AuditFilters>('audit:filters', {});
  const visible = events.filter((e) => matches(e, f));
  const slice = usePager('audit', visible, { size: 25 });
  const counts = (kind: string) => events.filter((e) => !kind || auditEventGroup(e.action) === kind).length;
  // Any change of filter starts the list again from its first page.
  const update = (next: AuditFilters) => {
    setFilters(next);
    slice.setPage(1);
  };
  const pills = [['', 'ทั้งหมด'] as const, ...Object.entries(auditGroups).map(([key, meta]) => [key, meta.label] as const)].filter(
    ([key]) => !key || counts(key) || f.group === key,
  );
  const filtered = Boolean(f.actor || f.group || f.from || f.to);

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>ประวัติการทำงาน</h1>
          <p>ใครทำอะไรกับข้อมูลในองค์กรนี้ · เก็บกิจกรรมล่าสุดสูงสุด 300 รายการ</p>
        </div>
        <div className="flex" />
      </div>
      <section className="filters audit-filters">
        <SearchInput
          id="audit-search"
          label="ค้นหาในประวัติการทำงาน"
          placeholder="ค้นหาชื่อผู้ทำ กิจกรรม หรือรายการ"
          value={f.actor || ''}
          onChange={(actor) => update({ ...f, actor })}
        />
        <div className="filter-pills" role="group" aria-label="ประเภทกิจกรรม">
          {pills.map(([key, label]) => (
            <FilterPill
              key={key}
              value={key}
              label={label}
              pressed={(f.group || '') === key}
              count={counts(key)}
              onClick={(group) => update({ ...f, group })}
            />
          ))}
        </div>
        <div className="report-fields audit-dates">
          <label className="report-field">
            <span>ตั้งแต่</span>
            <input type="date" id="audit-from" value={f.from || ''} onChange={(e) => update({ ...f, from: e.target.value })} />
          </label>
          <label className="report-field">
            <span>ถึง</span>
            <input type="date" id="audit-to" value={f.to || ''} onChange={(e) => update({ ...f, to: e.target.value })} />
          </label>
          {filtered && (
            <button type="button" className="btn subtle" onClick={() => update({})}>
              <Icon name="close" />
              ล้างตัวกรอง
            </button>
          )}
        </div>
        <span className="muted article-count" role="status">
          {visible.length} กิจกรรม
        </span>
      </section>
      <div id="audit-events">
        <AuditList events={slice.shown} />
        {visible.length > 0 && <Pager slice={slice} unit="กิจกรรม" sizes={[25, 50, 100]} />}
      </div>
    </>
  );
}
