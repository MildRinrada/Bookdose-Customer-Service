'use client';

import { useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { FilterSelect } from '@/components/ui/filters';
import { TENANTS_PATH } from '@/features/platform/api';
import type { TenantsPage } from '@/features/platform/types';
import { date, number, relative } from '@/lib/format';
import { useApi } from '@/lib/query';
import { useUiState } from '@/lib/ui-state';
import { eventsPath } from '../api';
import { actorLabels, detailKeyLabels, eventKindLabel, eventKindLabels, severityLabels } from '../labels';
import type { SecurityEvent, SecurityEventFilters, SecurityEventsPage } from '../types';
import { SeverityBadge, severityClass } from './Alerts';
import { BlockIpDialog } from './IpBlocks';

/* The security events log (newest first, 50 at a time): filters by kind, level, kind of user, IP, organization and
   free text, "โหลดเพิ่ม" for the next page (the server's `next_before` cursor), and a detail drawer per row. Every
   loaded page is its own query (and its own <tbody>), so loading more never reloads what is already shown. */

const toChoices = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

export function EventsLog() {
  const [filters, setFilters] = useUiState<SecurityEventFilters>('security:events', {});
  const [cursors, setCursors] = useState<string[]>(['']);
  const tenants = useApi<TenantsPage>(TENANTS_PATH);
  const last = useApi<SecurityEventsPage>(eventsPath(filters, cursors[cursors.length - 1]));
  const first = useApi<SecurityEventsPage>(eventsPath(filters));
  const { openModal } = useDialogs();

  const update = (next: SecurityEventFilters) => {
    setFilters(next);
    setCursors(['']);
  };
  const submitText = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    update({ ...filters, ip: String(data.get('ip') ?? '').trim(), q: String(data.get('q') ?? '').trim() });
  };
  const filtered = Object.values(filters).some(Boolean);
  const openDetail = (e: SecurityEvent) =>
    openModal(eventKindLabel(e.kind), <EventDetail event={e} onFilterIp={(ip) => update({ ...filters, ip })} />, { drawer: true });

  return (
    <section className="card security-card security-section" id="security-events" aria-labelledby="security-events-title">
      <div className="card-header">
        <div>
          <h2 id="security-events-title">บันทึกเหตุการณ์ความปลอดภัย</h2>
          <p>เก็บย้อนหลัง 90 วัน · เหตุการณ์ซ้ำภายในนาทีเดียวกันรวมเป็นแถวเดียวพร้อมจำนวนครั้ง</p>
        </div>
        <Icon name="list" />
      </div>
      <div className="filters security-filters">
        <form className="security-search" role="search" onSubmit={submitText} key={`${filters.ip ?? ''}|${filters.q ?? ''}`}>
          <div className="input-wrap search-input">
            <Icon name="search" />
            <input name="q" type="search" defaultValue={filters.q ?? ''} placeholder="ค้นหาบัญชีหรือรายละเอียด" aria-label="คำค้น" maxLength={200} />
          </div>
          <input
            name="ip"
            className="security-ip-filter"
            defaultValue={filters.ip ?? ''}
            placeholder="IP"
            aria-label="IP"
            maxLength={49}
            spellCheck={false}
            autoComplete="off"
          />
          <button type="submit" className="btn">
            ค้นหา
          </button>
        </form>
        <FilterSelect
          id="security-kind"
          label="ประเภท"
          any="ทุกประเภท"
          value={filters.kind ?? ''}
          options={toChoices(eventKindLabels)}
          onChange={(kind) => update({ ...filters, kind })}
        />
        <FilterSelect
          id="security-severity"
          label="ระดับ"
          any="ทุกระดับ"
          value={filters.severity ?? ''}
          options={toChoices(severityLabels)}
          onChange={(severity) => update({ ...filters, severity })}
        />
        <FilterSelect
          id="security-actor"
          label="ผู้ใช้กลุ่ม"
          any="ทุกกลุ่มผู้ใช้"
          value={filters.actor ?? ''}
          options={toChoices(actorLabels)}
          onChange={(actor) => update({ ...filters, actor })}
        />
        <FilterSelect
          id="security-tenant"
          label="องค์กร"
          any="ทุกองค์กร"
          value={filters.tenant ?? ''}
          options={(tenants.data?.tenants ?? []).map((t) => ({ value: t.id, label: t.name }))}
          onChange={(tenant) => update({ ...filters, tenant })}
        />
        {filtered && (
          <button type="button" className="btn subtle" onClick={() => update({})}>
            <Icon name="close" />
            ล้างตัวกรอง
          </button>
        )}
      </div>
      {first.error ? (
        <ErrorState error={first.error} onRetry={() => void first.refetch()} />
      ) : !first.data ? (
        <PageLoading />
      ) : first.data.events.length ? (
        <>
          <div className="table-scroll">
            <table className="security-table security-events">
              <thead>
                <tr>
                  <th scope="col">เวลา</th>
                  <th scope="col">ประเภท</th>
                  <th scope="col">ระดับ</th>
                  <th scope="col">ผู้ใช้กลุ่ม</th>
                  <th scope="col">บัญชี</th>
                  <th scope="col">องค์กร</th>
                  <th scope="col">IP</th>
                  <th scope="col">ครั้ง</th>
                </tr>
              </thead>
              {cursors.map((cursor) => (
                <EventRows key={cursor || 'first'} path={eventsPath(filters, cursor)} onOpen={openDetail} />
              ))}
            </table>
          </div>
          <div className="table-footer security-more">
            <span role="status">
              {last.isFetching && !last.data ? 'กำลังโหลด…' : last.data?.next_before ? 'ยังมีเหตุการณ์ที่เก่ากว่า' : 'แสดงครบทุกเหตุการณ์แล้ว'}
            </span>
            {last.error && <span className="error-text">{last.error.message}</span>}
            {last.data?.next_before && (
              <button type="button" className="btn" onClick={() => setCursors((list) => [...list, String(last.data!.next_before)])}>
                <Icon name="down" />
                โหลดเพิ่ม
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="card-body muted">{filtered ? 'ไม่พบเหตุการณ์ที่ตรงกับตัวกรอง' : 'ยังไม่มีเหตุการณ์ความปลอดภัย'}</p>
      )}
    </section>
  );
}

function EventRows({ path, onOpen }: { path: string; onOpen: (event: SecurityEvent) => void }) {
  const page = useApi<SecurityEventsPage>(path);
  if (!page.data) return null;
  return (
    <tbody>
      {page.data.events.map((e) => (
        <tr key={e.id} className={`severity-row-${severityClass(e.severity)}`}>
          <td>
            <time dateTime={e.at} title={date(e.at, true)}>
              {date(e.at, true)}
            </time>
          </td>
          <td>
            <button type="button" className="security-event-open" onClick={() => onOpen(e)} aria-haspopup="dialog">
              {eventKindLabel(e.kind)}
            </button>
          </td>
          <td>
            <SeverityBadge severity={e.severity} />
          </td>
          <td>{actorLabels[e.actor] ?? e.actor}</td>
          <td>{e.subject || '-'}</td>
          <td>{e.tenant_name || '-'}</td>
          <td className="mono">{e.ip || '-'}</td>
          <td className="mono">{number(e.count || 1)}</td>
        </tr>
      ))}
    </tbody>
  );
}

function detailValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** The drawer behind a row: every field, the detail the server kept, and the IP's actions. */
function EventDetail({ event: e, onFilterIp }: { event: SecurityEvent; onFilterIp: (ip: string) => void }) {
  const { openModal, closeModal } = useDialogs();
  const detail: Array<[string, unknown]> =
    e.detail && typeof e.detail === 'object' ? Object.entries(e.detail) : e.detail ? [['detail', e.detail]] : [];
  const facts: Array<[string, string]> = [
    ['เวลา', `${date(e.at, true)} (${relative(e.at)})`],
    ['ระดับ', severityLabels[e.severity] ?? e.severity],
    ['ผู้ใช้กลุ่ม', actorLabels[e.actor] ?? e.actor],
    ['บัญชี', e.subject || '-'],
    ['องค์กร', e.tenant_name || '-'],
    ['IP', e.ip || '-'],
    ['จำนวนครั้ง', number(e.count || 1)],
    ['ประเภท (รหัส)', e.kind],
  ];
  return (
    <div className="security-detail">
      <p className={`security-detail-head severity-${severityClass(e.severity)}`}>
        <SeverityBadge severity={e.severity} /> {eventKindLabel(e.kind)}
      </p>
      <dl className="system-facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="security-wrap">{value}</dd>
          </div>
        ))}
      </dl>
      {e.user_agent && (
        <>
          <h3 className="security-subhead">เบราว์เซอร์ / อุปกรณ์</h3>
          <p className="security-wrap small">{e.user_agent}</p>
        </>
      )}
      {detail.length > 0 && (
        <>
          <h3 className="security-subhead">รายละเอียด</h3>
          <dl className="system-facts">
            {detail.map(([key, value]) => (
              <div key={key}>
                <dt>{detailKeyLabels[key] ?? key}</dt>
                <dd className="security-wrap">{detailValue(value)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {e.ip && (
        <div className="security-form-end">
          <button
            type="button"
            className="btn"
            onClick={() => {
              closeModal();
              onFilterIp(e.ip as string);
            }}
          >
            <Icon name="search" />
            ดูเหตุการณ์จาก IP นี้
          </button>
          <button type="button" className="btn danger" onClick={() => openModal('บล็อก IP', <BlockIpDialog ip={e.ip as string} reason={eventKindLabel(e.kind)} />)}>
            <Icon name="shield" />
            บล็อก IP นี้
          </button>
        </div>
      )}
    </div>
  );
}
