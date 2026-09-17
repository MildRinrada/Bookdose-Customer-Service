'use client';

import { Icon } from '@/components/Icon';
import { useRunAction } from '@/components/ui/actions';
import { useToast } from '@/components/ui/Toast';
import { date, number, relative } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { acknowledgeAlert, OPEN_ALERTS_PATH, SECURITY_PREFIX } from '../api';
import { alertRuleLabel, eventKindLabel, severityLabels } from '../labels';
import type { SecurityAlert } from '../types';

/* The open alerts, at the top of the page: one row per rule (and IP) coloured by severity, with "รับทราบ". Nothing
   is shown when all is quiet. Refreshes itself every minute. */

export function severityClass(severity: string) {
  return severity === 'critical' || severity === 'warning' ? severity : 'info';
}

export function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`badge severity-badge severity-${severityClass(severity)}`}>{severityLabels[severity] ?? severity}</span>;
}

function detailText(detail: SecurityAlert['detail']): string {
  if (!detail) return '';
  if (typeof detail === 'string') return detail;
  // The rule's own numbers: {kind, window_minutes, threshold}
  if (typeof detail.threshold === 'number' && typeof detail.window_minutes === 'number') {
    const kind = typeof detail.kind === 'string' ? `${eventKindLabel(detail.kind)} · ` : '';
    return `${kind}เกณฑ์ ${number(detail.threshold)} ครั้งภายใน ${number(detail.window_minutes)} นาที`;
  }
  return Object.entries(detail)
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .join(' · ');
}

export function AlertsBanner() {
  const alerts = useApi<{ alerts: SecurityAlert[] }>(OPEN_ALERTS_PATH, { refetchInterval: 60000 });
  const refresh = useInvalidate();
  const toast = useToast();
  const run = useRunAction();
  const list = alerts.data?.alerts ?? [];
  if (alerts.error)
    return (
      <p className="notice warning security-alerts-error" role="status">
        โหลดการแจ้งเตือนไม่สำเร็จ: {alerts.error.message}
      </p>
    );
  if (!list.length) return null;
  const order = { critical: 0, warning: 1, info: 2 } as Record<string, number>;
  const sorted = [...list].sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3) || String(b.last_seen_at).localeCompare(String(a.last_seen_at)));
  return (
    <section className="security-alerts" id="security-alerts" aria-label="การแจ้งเตือนความปลอดภัยที่เปิดอยู่">
      {sorted.map((alert) => {
        const detail = detailText(alert.detail);
        return (
          <div key={alert.id} className={`security-alert severity-${severityClass(alert.severity)}`} role={alert.severity === 'critical' ? 'alert' : 'status'}>
            <Icon name={alert.severity === 'critical' ? 'bolt' : 'shield'} />
            <div className="security-alert-text">
              <strong>
                <SeverityBadge severity={alert.severity} /> {alertRuleLabel(alert.rule) === alert.rule && alert.label ? alert.label : alertRuleLabel(alert.rule)}
              </strong>
              <span>
                {number(alert.count)} ครั้ง{alert.ip ? ` · IP ${alert.ip}` : ''} · เริ่ม {relative(alert.started_at)} · ล่าสุด{' '}
                <time dateTime={alert.last_seen_at} title={date(alert.last_seen_at, true)}>
                  {relative(alert.last_seen_at)}
                </time>
              </span>
              {detail && <span className="tiny security-wrap">{detail}</span>}
              {alert.acknowledged_at && (
                <span className="tiny">
                  รับทราบแล้ว{alert.acknowledged_by ? `โดย ${alert.acknowledged_by}` : ''} {relative(alert.acknowledged_at)}
                </span>
              )}
            </div>
            {!alert.acknowledged_at && (
              <button
                type="button"
                className="btn sm"
                onClick={() =>
                  void run(async () => {
                    await acknowledgeAlert(alert.id);
                    toast('รับทราบการแจ้งเตือนแล้ว');
                    await refresh(`${SECURITY_PREFIX}/alerts`, `${SECURITY_PREFIX}/overview`);
                  })
                }
              >
                <Icon name="check" />
                รับทราบ
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
