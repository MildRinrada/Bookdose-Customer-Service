'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { FilterPill, SearchInput } from '@/components/ui/filters';
import { Pager, usePager } from '@/components/ui/Pager';
import { number, relative } from '@/lib/format';
import { useApi } from '@/lib/query';
import { useUiState } from '@/lib/ui-state';
import { HEALTH_PATH } from './api';
import type { HealthSignal, OrgUsage } from './types';

/* Platform console, สุขภาพองค์กร — which organizations are fine and which are in trouble.

   Written for a console with a hundred organizations in it, not four. That rules out a card each: a screen you have
   to scroll through to find the one that needs help is a screen nobody opens twice. One row per organization, worst
   first, and the filters above it are the whole point of the page - "show me the ones in trouble" has to be one
   click, not a read.

   Each row carries the score and the four numbers it is made of, each with the raw count under it ("22/50" beneath
   the answering rate). A score nobody can take apart is a score nobody acts on: "62" starts an argument, "ตอบในเวลา
   22 จาก 50" starts a phone call. The four are the four an organization actually fails at - answering within the
   time it promised, what customers said, what is stacking up past its deadline, and whether its channels deliver
   (backend platform/orghealth.py).

   A signal with nothing behind it shows "—", never a zero: a quiet organization is not a failing one, and a score
   that calls it one is a score the console stops trusting. */

const LEVELS: Record<string, string> = {
  risk: 'ต้องดูแล',
  watch: 'เฝ้าดู',
  ok: 'ปกติ',
  new: 'ยังไม่มีข้อมูล',
};

const ORDER: Record<string, number> = { risk: 0, watch: 1, new: 2, ok: 3 };

const tone = (score: number | null | undefined) =>
  score === null || score === undefined ? 'none' : score >= 80 ? 'ok' : score >= 60 ? 'watch' : 'risk';

type Filters = { q?: string; level?: string };

export function OrgHealthScreen() {
  const page = useApi<{ usage: OrgUsage[] }>(HEALTH_PATH);
  const [f, setFilters] = useUiState<Filters>('platform:org-health', {});
  const all = page.data?.usage ?? [];
  const term = (f.q || '').trim().toLowerCase();
  const visible = all.filter(
    (o) =>
      (!f.level || (o.health?.level ?? 'new') === f.level) &&
      (!term || [o.name, o.slug].some((v) => String(v || '').toLowerCase().includes(term))),
  );
  const sorted = [...visible].sort(
    (a, b) =>
      (ORDER[a.health?.level ?? 'new'] ?? 9) - (ORDER[b.health?.level ?? 'new'] ?? 9) ||
      (a.health?.score ?? 101) - (b.health?.score ?? 101) ||
      a.name.localeCompare(b.name, 'th'),
  );
  const slice = usePager('org-health', sorted, { size: 25 });
  const counts = (level: string) => all.filter((o) => !level || (o.health?.level ?? 'new') === level).length;
  const update = (next: Filters) => {
    setFilters(next);
    slice.setPage(1);
  };

  if (page.isPending) return <PageLoading />;
  if (page.error) return <ErrorState error={page.error} onRetry={() => void page.refetch()} />;

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>สุขภาพองค์กร</h1>
          <p>
            คะแนนจาก 4 อย่างใน 30 วันล่าสุด · เวลาตอบ · ความพึงพอใจ · เคสค้างเกินกำหนด · ช่องทางที่ส่งไม่ผ่าน ·
            องค์กรที่ต้องดูแลอยู่บนสุดเสมอ
          </p>
        </div>
      </div>

      <section className="card">
        <div className="card-body member-filters">
          <SearchInput
            id="org-health-search"
            label="ค้นหาองค์กร"
            placeholder="ค้นหาชื่อหรือรหัสองค์กร"
            value={f.q || ''}
            onChange={(q) => update({ ...f, q })}
          />
          <div className="filter-pills" role="group" aria-label="ระดับสุขภาพ">
            <FilterPill value="" label="ทั้งหมด" pressed={!f.level} count={all.length} onClick={() => update({ ...f, level: '' })} />
            {(['risk', 'watch', 'ok', 'new'] as const).map((level) => (
              <FilterPill
                key={level}
                value={level}
                label={LEVELS[level]}
                pressed={f.level === level}
                count={counts(level)}
                warning={level === 'risk'}
                onClick={(value) => update({ ...f, level: value })}
              />
            ))}
          </div>
          <span className="muted article-count" role="status">
            {sorted.length} จาก {all.length} องค์กร
          </span>
        </div>

        {sorted.length ? (
          <>
            <div className="table-scroll health-table">
              <table>
                <colgroup>
                  <col className="col-org" />
                  <col className="col-score" />
                  <col className="col-signal" />
                  <col className="col-signal" />
                  <col className="col-signal" />
                  <col className="col-signal" />
                  <col className="col-seen" />
                </colgroup>
                <thead>
                  <tr>
                    <th>องค์กร</th>
                    <th>คะแนน</th>
                    <th>เวลาตอบ</th>
                    <th>พึงพอใจ</th>
                    <th>เคสค้าง</th>
                    <th>ช่องทาง</th>
                    <th>ใช้งานล่าสุด</th>
                  </tr>
                </thead>
                <tbody>
                  {slice.shown.map((org) => (
                    <OrgRow key={org.id} org={org} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-body">
              <Pager slice={slice} unit="องค์กร" sizes={[25, 50, 100]} />
            </div>
          </>
        ) : (
          <div className="card-body">
            <EmptyState title="ไม่พบองค์กรตามตัวกรอง" description="ลองเปลี่ยนคำค้น หรือเลือกระดับ “ทั้งหมด”" icon="globe" />
          </div>
        )}
      </section>
    </>
  );
}

function OrgRow({ org }: { org: OrgUsage }) {
  const health = org.health;
  const level = health?.level ?? 'new';
  const s = health?.signals ?? {};
  return (
    <tr className={org.status === 'active' ? '' : 'org-suspended'}>
      <td>
        <div className="org-text">
          <Link className="truncate" href="/platform/organizations" title={org.name}>
            {org.name}
          </Link>
          <span className="tiny muted">
            {org.slug}
            {org.status !== 'active' && ' · ระงับ'} · {number(org.open_cases)} เคสเปิด
          </span>
        </div>
      </td>
      <td>
        <span className={`health-chip tone-${tone(health?.score)}`}>
          <strong>{health?.score ?? '—'}</strong>
          {LEVELS[level]}
        </span>
      </td>
      <Cell signal={s.response} under={(x) => (x.total ? `${x.in_time}/${x.total} เคส` : 'ยังไม่มีเคส')} />
      <Cell signal={s.csat} under={(x) => (x.answers ? `${x.average} ดาว · ${x.answers} คำตอบ` : 'ยังไม่มีคำตอบ')} />
      <Cell signal={s.backlog} under={(x) => (x.open_cases ? `เกิน ${x.overdue}/${x.open_cases}` : 'ไม่มีเคสค้าง')} />
      <Cell
        signal={s.channels}
        under={(x) => (x.failing?.length ? x.failing.join(', ') : x.connected ? `${x.connected} ช่องทาง` : 'ยังไม่เชื่อม')}
      />
      <td className="health-seen tiny muted">{org.last_active ? relative(org.last_active) : 'ยังไม่ใช้งาน'}</td>
    </tr>
  );
}

/** One signal: the number, and under it the count it came from - the part that turns a score into something to do. */
function Cell({ signal, under }: { signal?: HealthSignal; under: (s: HealthSignal) => string }) {
  return (
    <td className={`health-cell tone-${tone(signal?.score)}`}>
      <strong>{signal?.score ?? '—'}</strong>
      <span className="tiny muted">{signal ? under(signal) : 'ยังไม่มีข้อมูล'}</span>
    </td>
  );
}
