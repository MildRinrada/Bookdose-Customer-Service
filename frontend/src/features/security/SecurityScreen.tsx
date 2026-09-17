'use client';

import { Icon } from '@/components/Icon';
import { ErrorState, PageLoading, StatCard } from '@/components/ui/display';
import { FilterPill } from '@/components/ui/filters';
import { number } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { useUiState } from '@/lib/ui-state';
import { overviewPath, SECURITY_PREFIX } from './api';
import { AlertsBanner } from './components/Alerts';
import { EventsLog } from './components/EventsLog';
import { IpBlocksCard } from './components/IpBlocks';
import { LocksCard } from './components/Locks';
import { RevokeSessionsCard } from './components/RevokeSessionsCard';
import { SecurityChart } from './components/SecurityChart';
import { SettingsCard } from './components/SettingsCard';
import { TopIpsCard, TopSubjectsCard } from './components/TopTables';
import { cardLabels, rangeLabels } from './labels';
import type { SecurityOverview, SecurityRange } from './types';

/* Platform console → ความปลอดภัย (/platform/security, platform admins only; docs/SECURITY-DESIGN.md §3–4): open
   alerts, the numbers and chart of the chosen range, the IPs and accounts under attack, locked accounts, the events
   log, the IP block list, ending an account's sessions, and the security settings. The overview, alerts and locks
   refresh themselves every minute (plain GETs: they never count as the admin's activity). Markup: pages/security.css. */

export function SecurityScreen() {
  const [range, setRange] = useUiState<SecurityRange>('security:range', '24h');
  const refresh = useInvalidate();
  return (
    <div className="security-page">
      <div className="page-heading">
        <div>
          <h1>ความปลอดภัย</h1>
          <p>การเข้าสู่ระบบที่ผิดปกติ คำขอที่ถูกปฏิเสธ และการตั้งค่าเซสชันของทุกองค์กร</p>
        </div>
        <div className="flex security-heading-actions">
          <div className="filter-pills security-range" role="group" aria-label="ช่วงเวลา">
            {(Object.keys(rangeLabels) as SecurityRange[]).map((value) => (
              <FilterPill key={value} value={value} label={rangeLabels[value]} pressed={range === value} onClick={() => setRange(value)} />
            ))}
          </div>
          <button type="button" className="btn subtle" onClick={() => void refresh(SECURITY_PREFIX)}>
            <Icon name="clock" />
            รีเฟรช
          </button>
        </div>
      </div>
      <AlertsBanner />
      <Overview range={range} />
      <LocksCard />
      <EventsLog />
      <div className="security-grid wide-first security-section">
        <IpBlocksCard />
        <RevokeSessionsCard />
      </div>
      <SettingsCard />
    </div>
  );
}

function Overview({ range }: { range: SecurityRange }) {
  const overview = useApi<SecurityOverview>(overviewPath(range), { refetchInterval: 60000, keepPrevious: true });
  if (overview.error && !overview.data) return <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;
  if (!overview.data) return <PageLoading />;
  const { cards, series, top_ips, top_subjects } = overview.data;
  const span = rangeLabels[range];
  return (
    <>
      <div className="stats-grid security-stats" aria-busy={overview.isFetching}>
        <StatCard
          label={cardLabels.failed_logins}
          value={number(cards.failed_logins)}
          icon="lock"
          color={cards.failed_logins ? 'amber' : 'green'}
          foot={`ใน ${span} ล่าสุด`}
          href="#security-events"
        />
        <StatCard
          label={cardLabels.locked_now}
          value={number(cards.locked_now)}
          icon="users"
          color={cards.locked_now ? 'red' : 'green'}
          foot="ตอนนี้"
          href="#security-locks"
          urgent={cards.locked_now > 0}
        />
        <StatCard
          label={cardLabels.rate_limited}
          value={number(cards.rate_limited)}
          icon="bolt"
          color={cards.rate_limited ? 'amber' : 'green'}
          foot={`ใน ${span} ล่าสุด`}
          href="#security-events"
        />
        <StatCard
          label={cardLabels.origin_csrf_rejected}
          value={number(cards.origin_csrf_rejected)}
          icon="shield"
          color={cards.origin_csrf_rejected ? 'amber' : 'green'}
          foot={`ใน ${span} ล่าสุด`}
          href="#security-events"
        />
        <StatCard
          label={cardLabels.cross_tenant_denied}
          value={number(cards.cross_tenant_denied)}
          icon="globe"
          color={cards.cross_tenant_denied ? 'red' : 'green'}
          foot={`ใน ${span} ล่าสุด`}
          href="#security-events"
        />
        <StatCard
          label={cardLabels.open_alerts}
          value={number(cards.open_alerts)}
          icon="bell"
          color={cards.open_alerts ? 'red' : 'green'}
          foot={cards.open_alerts ? 'ต้องตรวจสอบ' : 'ไม่มีเรื่องผิดปกติ'}
          href={cards.open_alerts ? '#security-alerts' : '#security-settings'}
          urgent={cards.open_alerts > 0}
        />
      </div>
      <section className="card security-card" aria-labelledby="security-chart-title">
        <div className="card-header">
          <div>
            <h2 id="security-chart-title">แนวโน้มเหตุการณ์</h2>
            <p>{range === '24h' ? '24 ชั่วโมงล่าสุด แท่งละหนึ่งชั่วโมง' : '7 วันล่าสุด แท่งละ 6 ชั่วโมง'}</p>
          </div>
          <Icon name="chart" />
        </div>
        <div className="card-body">
          <SecurityChart series={series} range={range} />
        </div>
      </section>
      <div className="security-grid security-section">
        <TopIpsCard rows={top_ips} />
        <TopSubjectsCard rows={top_subjects} />
      </div>
    </>
  );
}
