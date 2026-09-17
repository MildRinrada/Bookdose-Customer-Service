'use client';

import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { FilterPill } from '@/components/ui/filters';
import { date, number, relative } from '@/lib/format';
import { useApi } from '@/lib/query';
import { useUiState } from '@/lib/ui-state';
import { eventsPath } from '../api';
import { durationLabels, eventKindLabel, honeypotFormLabels, honeytokenKindLabel, honeytokenWhereLabels, TRAP_EVENT_KINDS } from '../labels';
import type { SecurityEvent, SecurityEventFilters, SecurityEventsPage } from '../types';
import { SeverityBadge, severityClass } from './Alerts';
import { EventDetail } from './EventsLog';

/* The newest trap events (decoy paths, hidden form fields, honeytokens and the blocks they caused), one kind or all
   of them. The events API filters by one kind at a time, so "ทั้งหมด" asks for each kind and merges them. A row opens
   the same detail drawer as the events log; "ดูในบันทึกเหตุการณ์" sets the log's kind filter. Refreshes every minute. */

const PER_KIND = 20;
const SHOWN = 20;

type TrapKind = (typeof TRAP_EVENT_KINDS)[number];

const text = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? String(value) : '');

/** One line of what happened, from the detail the server kept. */
export function trapSummary(e: SecurityEvent): string {
  const d = e.detail && typeof e.detail === 'object' ? e.detail : null;
  if (!d) return typeof e.detail === 'string' ? e.detail : '';
  switch (e.kind) {
    case 'honeypot_path':
      return [text(d.method), text(d.path)].filter(Boolean).join(' ');
    case 'honeypot_form':
      return honeypotFormLabels[text(d.form)] ?? text(d.form);
    case 'honeytoken_triggered': {
      const where = text(d.where);
      return [
        d.test ? 'ทดสอบ' : '',
        text(d.label),
        d.kind ? honeytokenKindLabel(text(d.kind)) : '',
        where ? `พบที่ ${honeytokenWhereLabels[where] ?? where}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
    }
    default: {
      const duration = text(d.duration);
      return [text(d.reason), duration ? `บล็อก ${durationLabels[duration as keyof typeof durationLabels] ?? duration}` : ''].filter(Boolean).join(' · ');
    }
  }
}

function useKindEvents(kind: TrapKind, shown: string) {
  return useApi<SecurityEventsPage>(!shown || shown === kind ? eventsPath({ kind }, '', PER_KIND) : null, { refetchInterval: 60000 });
}

export function TrapEventsCard() {
  const [kind, setKind] = useUiState<string>('security:trap-kind', '');
  const [, setLogFilters] = useUiState<SecurityEventFilters>('security:events', {});
  const { openModal } = useDialogs();
  const pages = [
    useKindEvents('honeytoken_triggered', kind),
    useKindEvents('honeypot_path', kind),
    useKindEvents('honeypot_form', kind),
    useKindEvents('trap_ip_block', kind),
  ];
  const asked = pages.filter((_, i) => !kind || kind === TRAP_EVENT_KINDS[i]);
  const error = asked.find((page) => page.error)?.error;
  const loading = asked.some((page) => !page.data && !page.error);
  const events = asked
    .flatMap((page) => page.data?.events ?? [])
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, SHOWN);

  const openDetail = (e: SecurityEvent) =>
    openModal(
      eventKindLabel(e.kind),
      <EventDetail
        event={e}
        onFilterIp={(ip) => {
          setLogFilters({ ip });
          document.getElementById('security-events')?.scrollIntoView({ block: 'start' });
        }}
      />,
      { drawer: true },
    );

  const showInLog = () => {
    setLogFilters({ kind });
    document.getElementById('security-events')?.scrollIntoView({ block: 'start' });
  };

  return (
    <section className="card security-card" id="security-trap-events" aria-labelledby="security-trap-events-title">
      <div className="card-header">
        <div>
          <h2 id="security-trap-events-title">เหตุการณ์กับดักล่าสุด</h2>
          <p>ผู้ใช้จริงไม่ควรทำให้เกิดเหตุการณ์เหล่านี้ ถ้ามี ให้ตรวจสอบ IP และบัญชีที่เกี่ยวข้อง</p>
        </div>
        <Icon name="bell" />
      </div>
      <div className="filters trap-event-filters">
        <div className="filter-pills" role="group" aria-label="ชนิดเหตุการณ์กับดัก">
          <FilterPill value="" label="ทั้งหมด" pressed={!kind} onClick={() => setKind('')} />
          {TRAP_EVENT_KINDS.map((k) => (
            <FilterPill key={k} value={k} label={eventKindLabel(k)} pressed={kind === k} onClick={() => setKind(k)} />
          ))}
        </div>
        {kind && (
          <button type="button" className="btn subtle" onClick={showInLog}>
            <Icon name="list" />
            ดูในบันทึกเหตุการณ์
          </button>
        )}
      </div>
      {error && !events.length ? (
        <ErrorState error={error} onRetry={() => asked.forEach((page) => void page.refetch())} />
      ) : loading && !events.length ? (
        <PageLoading />
      ) : events.length ? (
        <div className="table-scroll">
          <table className="security-table security-events">
            <thead>
              <tr>
                <th scope="col">เวลา</th>
                <th scope="col">ประเภท</th>
                <th scope="col">ระดับ</th>
                <th scope="col">รายละเอียด</th>
                <th scope="col">IP</th>
                <th scope="col">ครั้ง</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={`${e.kind}-${e.id}`} className={`severity-row-${severityClass(e.severity)}`}>
                  <td>
                    <time dateTime={e.at} title={date(e.at, true)}>
                      {relative(e.at)}
                    </time>
                  </td>
                  <td>
                    <button type="button" className="security-event-open" onClick={() => openDetail(e)} aria-haspopup="dialog">
                      {eventKindLabel(e.kind)}
                    </button>
                  </td>
                  <td>
                    <SeverityBadge severity={e.severity} />
                  </td>
                  <td className="security-wrap">{trapSummary(e) || '-'}</td>
                  <td className="mono">{e.ip || '-'}</td>
                  <td className="mono">{number(e.count || 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="card-body muted">
          <Icon name="checkCircle" /> {kind ? `ยังไม่มีเหตุการณ์ “${eventKindLabel(kind)}”` : 'ยังไม่มีใครติดกับดัก'}
        </p>
      )}
    </section>
  );
}
