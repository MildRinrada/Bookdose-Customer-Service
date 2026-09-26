'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { ErrorState, PageLoading, StatCard } from '@/components/ui/display';
import { FilterPill } from '@/components/ui/filters';
import { number } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { useUiState } from '@/lib/ui-state';
import { VULNS_PATH } from '@/features/platform/api';
import { VulnsCard } from '@/features/platform/components/VulnsCard';
import { overviewPath, SECURITY_PREFIX } from './api';
import { AlertsBanner } from './components/Alerts';
import { CheckupPanel } from './components/Checkup';
import { EventsLog } from './components/EventsLog';
import { HoneypotSettingsCard } from './components/HoneypotSettingsCard';
import { HoneytokensCard } from './components/Honeytokens';
import { IpBlocksCard } from './components/IpBlocks';
import { LocksCard } from './components/Locks';
import { RevokeSessionsCard } from './components/RevokeSessionsCard';
import { SecurityChart } from './components/SecurityChart';
import { SettingsCard } from './components/SettingsCard';
import { TopIpsCard, TopSubjectsCard } from './components/TopTables';
import { TrapEventsCard } from './components/TrapEvents';
import { cardLabels, rangeLabels } from './labels';
import type { SecurityOverview, SecurityRange } from './types';

/* Platform console → ความปลอดภัย (/platform/security, platform admins only; docs/security/monitoring-and-traps.md), in seven
   tabs so each is one thing to look at: ภาพรวม (the numbers and chart of the chosen range, the IPs and accounts under
   attack), ตรวจสุขภาพ (are the headers, the certificate, the key, Turnstile and every organization set up safely),
   เหตุการณ์ (the events log), การเข้าถึง (locked accounts, the IP block list, ending an account's sessions),
   กับดัก (honeytokens, the newest trap events and the honeypot settings; docs/security/monitoring-and-traps.md), ช่องโหว่ (the
   libraries checked against the published vulnerabilities; platform/components/VulnsCard.tsx) and ตั้งค่า. The
   open alerts sit above every tab. The overview, alerts and locks refresh themselves every minute (plain GETs: they
   never count as the admin's activity). Markup: pages/security.css. */

type SecurityTab = 'overview' | 'checkup' | 'events' | 'access' | 'traps' | 'vulns' | 'settings';

const TABS: Array<[SecurityTab, string]> = [
  ['overview', 'ภาพรวม'],
  ['checkup', 'ตรวจสุขภาพ'],
  ['events', 'เหตุการณ์'],
  ['access', 'การเข้าถึง'],
  ['traps', 'กับดัก'],
  ['vulns', 'ช่องโหว่'],
  ['settings', 'ตั้งค่า'],
];
const BASE = '/platform/security';
const tabOf = (tab?: string): SecurityTab => (TABS.some(([key]) => key === tab) ? (tab as SecurityTab) : 'overview');
const tabHref = (tab: SecurityTab) => (tab === 'overview' ? BASE : `${BASE}?tab=${tab}`);

export function SecurityScreen({ tab }: { tab?: string }) {
  const [range, setRange] = useUiState<SecurityRange>('security:range', '24h');
  const refresh = useInvalidate();
  const [current, setCurrent] = useState<SecurityTab>(tabOf(tab));
  // A link to ?tab=… while already here picks that tab.
  const [seenTab, setSeenTab] = useState(tab);
  if (tab !== seenTab) {
    setSeenTab(tab);
    setCurrent(tabOf(tab));
  }
  const select = (key: SecurityTab) => {
    setCurrent(key);
    window.history.replaceState(null, '', tabHref(key));
  };
  return (
    <div className="security-page">
      <div className="page-heading">
        <div>
          <h1>ความปลอดภัย</h1>
          <p>การเข้าสู่ระบบที่ผิดปกติ คำขอที่ถูกปฏิเสธ กับดัก และการตั้งค่าเซสชันของทุกองค์กร</p>
        </div>
        <div className="flex security-heading-actions">
          {current === 'overview' && (
            <div className="filter-pills security-range" role="group" aria-label="ช่วงเวลา">
              {(Object.keys(rangeLabels) as SecurityRange[]).map((value) => (
                <FilterPill key={value} value={value} label={rangeLabels[value]} pressed={range === value} onClick={() => setRange(value)} />
              ))}
            </div>
          )}
          <button type="button" className="btn subtle" onClick={() => void refresh(SECURITY_PREFIX, VULNS_PATH)}>
            <Icon name="clock" />
            รีเฟรช
          </button>
        </div>
      </div>
      <AlertsBanner />
      <div className="tabs platform-tabs security-tabs" role="tablist" aria-label="ความปลอดภัย">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            id={`security-tab-${key}`}
            className={`tab${current === key ? ' active' : ''}`}
            role="tab"
            aria-selected={current === key}
            aria-controls={`security-panel-${key}`}
            onClick={() => select(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div id={`security-panel-${current}`} role="tabpanel" aria-labelledby={`security-tab-${current}`} className="security-panel">
        {current === 'overview' && <Overview range={range} />}
        {current === 'checkup' && <CheckupPanel />}
        {current === 'events' && <EventsLog />}
        {current === 'access' && (
          <>
            <LocksCard />
            <div className="security-grid wide-first security-section">
              <IpBlocksCard />
              <RevokeSessionsCard />
            </div>
          </>
        )}
        {current === 'traps' && <Traps />}
        {current === 'vulns' && <VulnsCard />}
        {current === 'settings' && <SettingsCard />}
      </div>
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
          href={tabHref('events')}
        />
        <StatCard
          label={cardLabels.locked_now}
          value={number(cards.locked_now)}
          icon="users"
          color={cards.locked_now ? 'red' : 'green'}
          foot="ตอนนี้"
          href={tabHref('access')}
          urgent={cards.locked_now > 0}
        />
        <StatCard
          label={cardLabels.rate_limited}
          value={number(cards.rate_limited)}
          icon="bolt"
          color={cards.rate_limited ? 'amber' : 'green'}
          foot={`ใน ${span} ล่าสุด`}
          href={tabHref('events')}
        />
        <StatCard
          label={cardLabels.origin_csrf_rejected}
          value={number(cards.origin_csrf_rejected)}
          icon="shield"
          color={cards.origin_csrf_rejected ? 'amber' : 'green'}
          foot={`ใน ${span} ล่าสุด`}
          href={tabHref('events')}
        />
        <StatCard
          label={cardLabels.cross_tenant_denied}
          value={number(cards.cross_tenant_denied)}
          icon="globe"
          color={cards.cross_tenant_denied ? 'red' : 'green'}
          foot={`ใน ${span} ล่าสุด`}
          href={tabHref('events')}
        />
        <StatCard
          label={cardLabels.open_alerts}
          value={number(cards.open_alerts)}
          icon="bell"
          color={cards.open_alerts ? 'red' : 'green'}
          foot={cards.open_alerts ? 'ต้องตรวจสอบ' : 'ไม่มีเรื่องผิดปกติ'}
          href={cards.open_alerts ? '#security-alerts' : tabHref('settings')}
          urgent={cards.open_alerts > 0}
        />
        <StatCard
          label={cardLabels.honeytoken_triggers}
          value={number(cards.honeytoken_triggers ?? 0)}
          icon="bolt"
          color={cards.honeytoken_triggers ? 'red' : 'green'}
          foot={`ใน ${span} ล่าสุด`}
          href={tabHref('traps')}
          urgent={Boolean(cards.honeytoken_triggers)}
        />
        <StatCard
          label={cardLabels.honeypot_hits}
          value={number(cards.honeypot_hits ?? 0)}
          icon="search"
          color={cards.honeypot_hits ? 'amber' : 'green'}
          foot={`ใน ${span} ล่าสุด`}
          href={tabHref('traps')}
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

/** "กับดัก": honeytokens, the newest trap events and the honeypot settings. */
function Traps() {
  return (
    <section className="security-section security-traps" id="security-traps" aria-labelledby="security-traps-title">
      <div className="security-part-head">
        <h2 id="security-traps-title">กับดัก</h2>
        <p>จับผู้บุกรุก สแกนเนอร์ บอท และคนในที่แอบดูข้อมูล ตั้งแต่ครั้งแรกที่แตะสิ่งที่ผู้ใช้จริงไม่มีวันแตะ ผู้ใช้จริงมองไม่เห็นและไม่ได้รับผลกระทบ</p>
      </div>
      <HoneytokensCard />
      <div className="security-section">
        <TrapEventsCard />
      </div>
      <div className="security-section">
        <HoneypotSettingsCard />
      </div>
    </section>
  );
}
