'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
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
import type { IpInfo, SecurityEvent, SecurityEventFilters, SecurityEventsPage } from '../types';
import { countryName, IpWithInfo } from './IpInfo';
import { SeverityBadge, severityClass } from './Alerts';
import { BlockIpDialog } from './IpBlocks';

/* The security events log (newest first, 50 at a time): filters by kind, level, kind of user, IP, organization and
   free text, "โหลดเพิ่ม" for the next page (the server's `next_before` cursor), and a detail drawer per row. Every
   loaded page is its own query (and its own <tbody>), so loading more never reloads what is already shown. */

const toChoices = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

/* A filter with fewer rows shortens the page under an admin scrolled down to the log, and the browser pulls the whole
   page down to fit, which looks like a reload. `hold()` (just before a filter changes) keeps the card as tall as it
   was; after every render and scroll it gives back what staying in place does not need, all of it once the admin
   scrolls back up. */
function useHoldPlace() {
  const ref = useRef<HTMLElement>(null);
  const holding = useRef(false);
  const fit = useCallback(() => {
    const card = ref.current;
    if (!card || !holding.current) return;
    const top = card.getBoundingClientRect().top + window.scrollY;
    const below = document.documentElement.scrollHeight - top - card.offsetHeight;
    const needed = Math.floor(window.scrollY + window.innerHeight - top - below);
    if (needed <= 0) {
      card.style.minHeight = '';
      holding.current = false;
      return;
    }
    card.style.minHeight = `${Math.min(parseFloat(card.style.minHeight) || 0, needed)}px`;
  }, []);
  useLayoutEffect(fit);
  useEffect(() => {
    window.addEventListener('scroll', fit, { passive: true });
    return () => window.removeEventListener('scroll', fit);
  }, [fit]);
  const hold = () => {
    const card = ref.current;
    if (!card) return;
    card.style.minHeight = `${card.offsetHeight}px`;
    holding.current = true;
  };
  return { ref, hold };
}

export function EventsLog() {
  const [filters, setFilters] = useUiState<SecurityEventFilters>('security:events', {});
  const [cursors, setCursors] = useState<string[]>(['']);
  // Filters set from elsewhere on the page (the trap events card) start from the newest page too.
  const [seenFilters, setSeenFilters] = useState(filters);
  if (seenFilters !== filters) {
    setSeenFilters(filters);
    setCursors(['']);
  }
  const tenants = useApi<TenantsPage>(TENANTS_PATH);
  const last = useApi<SecurityEventsPage>(eventsPath(filters, cursors[cursors.length - 1]));
  // A changed filter keeps what is shown until its answer comes, instead of swapping the table for "กำลังโหลด…".
  const first = useApi<SecurityEventsPage>(eventsPath(filters), { keepPrevious: true });
  const { openModal } = useDialogs();
  const { ref: cardRef, hold: holdPlace } = useHoldPlace();

  const update = (next: SecurityEventFilters) => {
    holdPlace();
    setFilters(next);
    setCursors(['']);
  };
  const submitText = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    update({ ...filters, ip: String(data.get('ip') ?? '').trim(), q: String(data.get('q') ?? '').trim() });
  };
  const filtered = Object.values(filters).some(Boolean);
  const openDetail = (e: SecurityEvent, info?: IpInfo) =>
    openModal(eventKindLabel(e.kind), <EventDetail event={e} info={info} onFilterIp={(ip) => update({ ...filters, ip })} />, { drawer: true });

  return (
    <section ref={cardRef} className="card security-card security-section" id="security-events" aria-labelledby="security-events-title">
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
          <div className="table-scroll" aria-busy={first.isPlaceholderData}>
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
        <p className="security-events-empty muted" aria-busy={first.isPlaceholderData}>
          {filtered ? 'ไม่พบเหตุการณ์ที่ตรงกับตัวกรอง' : 'ยังไม่มีเหตุการณ์ความปลอดภัย'}
        </p>
      )}
    </section>
  );
}

function EventRows({ path, onOpen }: { path: string; onOpen: (event: SecurityEvent, info?: IpInfo) => void }) {
  const page = useApi<SecurityEventsPage>(path, { keepPrevious: true });
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
            <button type="button" className="security-event-open" onClick={() => onOpen(e, e.ip ? page.data.ip_info?.[e.ip] : undefined)} aria-haspopup="dialog">
              {eventKindLabel(e.kind)}
            </button>
          </td>
          <td>
            <SeverityBadge severity={e.severity} />
          </td>
          <td>{actorLabels[e.actor] ?? e.actor}</td>
          <td>{e.subject || '-'}</td>
          <td>{e.tenant_name || '-'}</td>
          <td>
            <IpWithInfo ip={e.ip} info={e.ip ? page.data.ip_info?.[e.ip] : undefined} />
          </td>
          <td className="mono">{number(e.count || 1)}</td>
        </tr>
      ))}
    </tbody>
  );
}

/** A detail as a person reads it: yes / no for a flag, a country's name for its code (the sign-in signs). */
function detailValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'ใช่' : 'ไม่ใช่';
  if ((key === 'country' || key === 'previous_country') && typeof value === 'string') return countryName(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** The drawer behind a row: every field, the detail the server kept, and the IP's actions. */
export function EventDetail({ event: e, info, onFilterIp }: { event: SecurityEvent; info?: IpInfo; onFilterIp: (ip: string) => void }) {
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
    ...(info
      ? ([['ประเทศและเครือข่าย', [countryName(info.country), info.org, info.hosting ? '(คลาวด์หรือ VPN)' : ''].filter(Boolean).join(' ') || '-']] as Array<
          [string, string]
        >)
      : []),
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
                <dd className="security-wrap">{detailValue(key, value)}</dd>
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
