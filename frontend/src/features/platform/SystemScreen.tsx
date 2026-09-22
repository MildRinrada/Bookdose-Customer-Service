'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { ChartColumn, ErrorState, PageLoading, StatCard } from '@/components/ui/display';
import { AuditList } from '@/features/audit';
import { date, number, relative } from '@/lib/format';
import { useApi } from '@/lib/query';
import { HEALTH_PATH, SYSTEM_PATH } from './api';
import { AnnouncementCard, BackupsCard, ChannelsCard, SecurityCard, StatusNoticeCard, TodoCard, UsageCard } from './components/HealthCards';
import { apiAreaLabels, bytesText, durationText, logSourceLabels, workerLabels, workerStatus } from './labels';
import type { HealthPage, SystemOverview } from './types';

/* Platform console, ภาพรวมระบบ: what needs doing first (ต้องจัดการ), then is the server healthy, are the backups and
   every organization's channels fine, how busy each organization is, security at a glance, how much the API is used,
   what went wrong lately, and the announcement to every organization. The server's numbers come from the running
   server and start again when it restarts; the page refreshes itself (30 seconds; the cross-organization checks every
   minute). Markup: pages/platform.css (.system-page). */

export function SystemScreen() {
  // A failed refresh keeps what is shown; the next round tries again (like the old refreshSystem).
  const system = useApi<SystemOverview>(SYSTEM_PATH, { refetchInterval: 30000 });
  const health = useApi<HealthPage>(HEALTH_PATH, { refetchInterval: 60000 });
  if (system.data)
    return (
      <SystemView
        data={system.data}
        health={health.data}
        onRefresh={() => {
          void system.refetch();
          void health.refetch();
        }}
      />
    );
  if (system.error) return <ErrorState error={system.error} onRetry={() => void system.refetch()} />;
  return <PageLoading />;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

const pad = (hour: number) => String(hour).padStart(2, '0');
/* The two log cards show their latest few; the platform's whole history is on จัดการองค์กร → กิจกรรม. */
const LOG_ROWS = 5;

function SystemView({ data, health, onRefresh }: { data: SystemOverview; health?: HealthPage; onRefresh: () => void }) {
  const s = data.server;
  const q = data.queues;
  const stopped = data.workers.filter((w) => !w.running).length;
  const errorRate = data.requests ? (data.server_errors / data.requests) * 100 : 0;
  const used = s.disk_total - s.disk_free;
  const lowDisk = s.disk_free < s.disk_total * 0.1;
  const max = Math.max(1, ...data.hours.map((h) => h.requests));
  const facts: Array<[string, string]> = [
    ['ทำงานต่อเนื่อง', durationText(data.uptime_seconds)],
    ['Python', s.python],
    ['ระบบปฏิบัติการ', s.system],
    ['โฟลเดอร์ข้อมูล', s.data_dir],
    ['ฐานข้อมูลทั้งหมด', bytesText(s.database_bytes)],
    ['ไฟล์แนบ', bytesText(s.files_bytes)],
    ['บัญชีผู้ใช้ทีมงาน', number(data.users)],
  ];
  const queues: Array<[string, number]> = [
    ['ข้อความรอส่ง (LINE / Facebook / Email)', q.outbox_waiting],
    ['ข้อความส่งไม่สำเร็จหรือไม่แน่ใจผล', q.outbox_failed],
    ['งาน AI ในคิว', q.ai_pending],
    ['อีเมลแจ้งลูกค้ารอส่ง', q.notices_pending],
  ];
  const errors = data.errors.slice(0, 30);

  return (
    <div className="system-page">
      <div className="page-heading">
        <div>
          <h1>ภาพรวมระบบ</h1>
          <p>สถานะเซิร์ฟเวอร์และการใช้งานของทุกองค์กร · อัปเดตเองทุก 30 วินาที</p>
        </div>
        <div className="flex">
          <button type="button" className="btn subtle" onClick={onRefresh}>
            <Icon name="clock" />
            รีเฟรช
          </button>
        </div>
      </div>
      <StatusNoticeCard />
      {health && <TodoCard items={health.todo} />}
      <div className="stats-grid">
        <StatCard
          label="สถานะเซิร์ฟเวอร์"
          value={stopped ? 'ต้องตรวจสอบ' : 'ปกติ'}
          icon="shield"
          color={stopped ? 'red' : 'green'}
          foot={stopped ? `งานเบื้องหลังหยุด ${stopped} อย่าง` : `เปิดมาแล้ว ${durationText(data.uptime_seconds)}`}
          href="/platform/system"
          urgent={stopped > 0}
        />
        <StatCard
          label="คำขอ API 24 ชม."
          value={number(data.requests)}
          icon="chart"
          color="blue"
          foot={`ชั่วโมงล่าสุด ${number(data.last_hour)} · เฉลี่ย ${data.average_ms} ms`}
          href="/platform/system"
        />
        <StatCard
          label="ข้อผิดพลาดของระบบ"
          value={number(data.server_errors)}
          icon="bolt"
          color={data.server_errors ? 'red' : 'green'}
          foot={`${errorRate.toFixed(2)}% ของคำขอ · คำขอไม่ถูกต้อง ${number(data.client_errors)}`}
          href="/platform/system"
          urgent={data.server_errors > 0}
        />
        <StatCard
          label="องค์กรที่ใช้งาน"
          value={number(data.organizations.active)}
          icon="globe"
          color="blue"
          foot={`ระงับ ${data.organizations.suspended} · สมาชิก ${number(data.organizations.members)} คน`}
          href="/platform/organizations"
        />
      </div>
      <div className="system-grid">
        <section className="card" id="health">
          <div className="card-header">
            <div>
              <h2>Server Health</h2>
              <p>เปิดทำงานเมื่อ {date(data.started_at, true)}</p>
            </div>
            <Icon name="shield" />
          </div>
          <div className="card-body">
            <dl className="system-facts">
              {facts.map(([label, value]) => (
                <Fact key={label} label={label} value={value} />
              ))}
            </dl>
            <div className={`system-disk${lowDisk ? ' low' : ''}`}>
              <div className="system-disk-head">
                <strong>พื้นที่ดิสก์</strong>
                <span className="muted">
                  ว่าง {bytesText(s.disk_free)} จาก {bytesText(s.disk_total)}
                </span>
              </div>
              <progress value={used} max={s.disk_total} aria-label={`ใช้พื้นที่ดิสก์แล้ว ${Math.round((used / s.disk_total) * 100)}%`} />
              {lowDisk && <p className="tiny">พื้นที่เหลือน้อยกว่า 10% ฐานข้อมูลจะเขียนไม่ได้เมื่อดิสก์เต็ม</p>}
            </div>
          </div>
        </section>
        <section className="card" id="workers">
          <div className="card-header">
            <div>
              <h2>งานเบื้องหลัง</h2>
              <p>งานที่ระบบทำเองตลอดเวลา และคิวที่รออยู่ในทุกองค์กรที่เปิดใช้งาน</p>
            </div>
            <Icon name="bolt" />
          </div>
          <div className="card-body">
            <ul className="system-workers">
              {data.workers.map((w) => (
                <li key={w.name} className={`system-worker${w.running ? ' ok' : ''}${w.starting ? ' starting' : ''}`}>
                  <span className="system-dot" aria-hidden="true" />
                  <span className="system-worker-text">
                    <strong>{workerLabels[w.name] || w.name}</strong>
                    <span className="muted">{workerStatus(w)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <dl className="system-facts">
              {queues.map(([label, value]) => (
                <Fact key={label} label={label} value={number(value)} />
              ))}
            </dl>
          </div>
        </section>
      </div>
      {health && (
        <>
          <div className="system-grid system-section">
            <BackupsCard view={health.backups} />
            <SecurityCard summary={health.security} />
          </div>
          <div className="system-section">
            <ChannelsCard orgs={health.channels} />
          </div>
          <div className="system-section">
            <UsageCard orgs={health.usage} />
          </div>
        </>
      )}
      <section className="card system-section">
        <div className="card-header">
          <div>
            <h2>API Usage</h2>
            <p>คำขอ API ของทุกองค์กร 24 ชั่วโมงล่าสุด แท่งละหนึ่งชั่วโมง · นับตั้งแต่เปิดโปรแกรม</p>
          </div>
          <Icon name="chart" />
        </div>
        <div className="card-body system-usage">
          <div>
            <div className="system-chart" role="group" aria-label="คำขอ API รายชั่วโมง">
              {data.hours.map((h, i) => {
                const hour = new Date(h.start).getHours();
                const tip = `${pad(hour)}:00 · ${number(h.requests)} คำขอ${h.errors ? ` · ผิดพลาด ${h.errors}` : ''}`;
                return <ChartColumn key={h.start} tip={tip} count={h.requests} max={max} day={i % 3 === 2 || i === 23 ? pad(hour) : ''} />;
              })}
            </div>
            <p className="tiny muted">
              ชี้หรือแตะที่แท่งเพื่อดูจำนวน · สูงสุด {number(max === 1 && !data.hours.some((h) => h.requests) ? 0 : max)} คำขอต่อชั่วโมง
            </p>
          </div>
          <div className="system-usage-side">
            <h3>แยกตามส่วนของระบบ</h3>
            <dl className="system-facts">
              {Object.entries(apiAreaLabels).map(([key, label]) => (
                <Fact key={key} label={label} value={number(data.areas[key] || 0)} />
              ))}
            </dl>
            <h3>องค์กรที่ใช้มากที่สุด</h3>
            {data.tenant_usage.length ? (
              <ol className="system-tenants">
                {data.tenant_usage.map((t) => (
                  <li key={t.id}>
                    <span className="truncate">{t.name}</span>
                    <strong>{number(t.requests)}</strong>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">ยังไม่มีคำขอจากองค์กร</p>
            )}
          </div>
        </div>
      </section>
      <div className="system-grid system-section">
        <section className="card">
          <div className="card-header">
            <div>
              <h2>ข้อผิดพลาดล่าสุด</h2>
              <p>คำขอที่ล้มเหลว และงานเบื้องหลังที่มีปัญหา</p>
            </div>
            <Icon name="bolt" />
          </div>
          <div className="card-body">
            {errors.length ? (
              <ul className="system-log">
                {errors.slice(0, LOG_ROWS).map((e, i) => (
                  <li key={`${e.at}-${i}`}>
                    <time dateTime={e.at} title={date(e.at, true)}>
                      {relative(e.at)}
                    </time>
                    <span className="system-log-text">
                      <strong>{logSourceLabels[e.source] || e.source}</strong> {e.detail}
                      {e.where && (
                        <>
                          {' '}
                          <code>{e.where}</code>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {errors.length > LOG_ROWS && (
              <p className="tiny muted">
                แสดง {LOG_ROWS} จาก {errors.length} รายการล่าสุด
              </p>
            )}
            {!errors.length && (
              <p className="muted">
                <Icon name="checkCircle" /> ไม่มีข้อผิดพลาดตั้งแต่เปิดโปรแกรม
              </p>
            )}
          </div>
        </section>
        <section className="card">
          <div className="card-header">
            <div>
              <h2>กิจกรรมล่าสุด</h2>
              <p>ใครทำอะไรในคอนโซล</p>
            </div>
            <Link className="btn subtle small" href="/platform/organizations?tab=activity">
              ดูทั้งหมด <Icon name="arrow" />
            </Link>
          </div>
          <div className="card-body">
            <AuditList events={data.audit.slice(0, LOG_ROWS)} />
          </div>
        </section>
      </div>
      {health && (
        <div className="system-section">
          <AnnouncementCard current={health.announcement} />
        </div>
      )}
    </div>
  );
}
