'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { FormActions } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { visibleTeams } from '@/components/ui/pickers';
import type { TicketRow } from '@/features/tickets/types';
import { date } from '@/lib/format';
import { useInvalidate } from '@/lib/query';
import { useTeamName, useWork } from '@/lib/session';
import {
  formatMetric,
  GOAL_METRICS,
  GOAL_ORDER,
  metricValue,
  reaches,
  saveGoals,
  targetsFor,
  targetText,
  useGoals,
  type GoalMetric,
  type Goals,
  type Targets,
} from '../goals';
import { longDuration, periodTiles } from '../insights';
import type { ReportFilter } from '../types';

/* เป้าหมาย (goals.ts): each figure the owner set a target for, its value in the period, whether it reaches the target,
   and tile by tile (a day, a week or 30 days, as the other trends) where it fell short. The team picked in the filter
   (an agent's own team) uses its own targets where it has them, the organization's otherwise. Owners set them in a
   form: the organization's, then any team's that differ. Markup: pages/report-insights (report-goal-*, report-weeks). */

/** A tile's figure in a few letters: "92%", "4.6", "45 น.", "2.5 ชม.", "1.5 วัน". */
function shortMetric(metric: GoalMetric, value: number | null): string {
  if (value == null) return '–';
  const kind = GOAL_METRICS[metric].kind;
  if (kind !== 'minutes') return formatMetric(metric, value);
  const one = (n: number) => String(Math.round(n * 10) / 10);
  return value < 60 ? `${Math.round(value)} น.` : value < 1440 ? `${one(value / 60)} ชม.` : `${one(value / 1440)} วัน`;
}

export function GoalsCard({ all, f }: { all: TicketRow[]; f: ReportFilter }) {
  const work = useWork();
  const teamName = useTeamName();
  const goals = useGoals();
  const { openModal } = useDialogs();
  // An agent's report is their team's: so are its goals.
  const team = f.team || (work.role === 'agent' ? (work.team_id ?? '') : '');
  const targets = targetsFor(goals, team);
  const metrics = GOAL_ORDER.filter((m) => targets[m] != null);
  const owner = work.role === 'admin' && !work.read_only;
  const edit = () => openModal('ตั้งเป้าหมายของทีม', <GoalsForm goals={goals} start={team} />);
  if (!metrics.length)
    return owner ? (
      <section className="card report-goals-empty">
        <Icon name="checkCircle" />
        <p>
          <strong>ยังไม่ได้ตั้งเป้าหมาย</strong>
          <span>ตั้งเป้า เช่น ตอบทัน SLA หรือคะแนนความพึงพอใจ แล้วรายงานจะบอกว่าถึงเป้าหรือยัง และหลุดเป้าช่วงไหน</span>
        </p>
        <button type="button" className="btn sm" onClick={edit}>
          ตั้งเป้าหมาย
        </button>
      </section>
    ) : null;

  const tiles = periodTiles(f);
  const rows = metrics.map((metric) => {
    const target = targets[metric] as number;
    const value = metricValue(metric, all, f);
    return { metric, target, value, ok: reaches(metric, value, target) };
  });
  const reached = rows.filter((r) => r.ok).length;
  const own = team && goals.teams[team] && Object.keys(goals.teams[team]).length;
  return (
    <section className="card report-card report-goals">
      <div className="card-header">
        <div>
          <h2 className="report-title">
            <Icon name="checkCircle" />
            เป้าหมาย
          </h2>
          <p>
            ถึงเป้า {reached} จาก {rows.length} ข้อในช่วงนี้ ใช้เป้าของ{own ? `ทีม${teamName(team)}` : 'ทั้งองค์กร'}
          </p>
        </div>
        {owner && (
          <button type="button" className="btn subtle sm" onClick={edit}>
            <Icon name="edit" />
            แก้เป้าหมาย
          </button>
        )}
      </div>
      <div className="card-body">
        <ul className="report-goal-list">
          {rows.map(({ metric, target, value, ok }) => (
            <li key={metric}>
              <div className="report-goal-head">
                <span className="report-goal-name">{GOAL_METRICS[metric].label}</span>
                <strong>{formatMetric(metric, value)}</strong>
                <span className={`report-goal-state${ok ? ' ok' : ok === false ? ' miss' : ''}`}>
                  {ok ? 'ถึงเป้า' : ok === false ? 'ยังไม่ถึงเป้า' : 'ยังไม่มีข้อมูล'}
                </span>
                <span className="report-goal-target">เป้า {targetText(metric, target)}</span>
              </div>
              {tiles.length > 1 && (
                <div className="report-weeks report-goal-tiles" aria-label={`${GOAL_METRICS[metric].label} แต่ละช่วง`}>
                  {tiles.map((tile) => {
                    const part = metricValue(metric, all, tile.f);
                    const hit = reaches(metric, part, target);
                    return (
                      <div
                        key={tile.start.toISOString()}
                        className="report-week"
                        title={`${date(tile.start)} ถึง ${date(tile.f.to + 'T00:00:00')}: ${formatMetric(metric, part)} ${hit ? 'ถึงเป้า' : hit === false ? 'ยังไม่ถึงเป้า' : ''}`}
                      >
                        <span className={`report-week-score${hit === false ? ' low' : hit == null ? ' none' : ''}`}>{shortMetric(metric, part)}</span>
                        <span className="report-week-day">{date(tile.start)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </li>
          ))}
        </ul>
        {tiles.length > 1 && <p className="tiny muted report-goal-note">ช่องสีแดงคือช่วงที่ไม่ถึงเป้า ช่องสีจางคือช่วงที่ยังไม่มีข้อมูล</p>}
      </div>
    </section>
  );
}

/** The owner's form: whose targets (the organization's or a team's), and a target per figure (empty: none; for a team,
    the organization's). Every scope's edits are kept while switching between them, and saved together. */
function GoalsForm({ goals, start }: { goals: Goals; start: string }) {
  const work = useWork();
  const toast = useToast();
  const refresh = useInvalidate();
  const { closeModal } = useDialogs();
  const [scope, setScope] = useState(start);
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>(() => {
    const text = (t: Targets = {}) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, String(v)]));
    return { '': text(goals.org), ...Object.fromEntries(Object.entries(goals.teams).map(([id, t]) => [id, text(t)])) };
  });
  const current = draft[scope] ?? {};
  const set = (metric: GoalMetric, value: string) => setDraft((all) => ({ ...all, [scope]: { ...(all[scope] ?? {}), [metric]: value } }));

  return (
    <Form
      className="report-goal-form"
      onSubmit={async () => {
        const numbers = (t: Record<string, string> = {}) =>
          Object.fromEntries(Object.entries(t).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, Number(v)]));
        const { '': org, ...teams } = draft;
        await saveGoals({ org: numbers(org), teams: Object.fromEntries(Object.entries(teams).map(([id, t]) => [id, numbers(t)])) });
        toast('บันทึกเป้าหมายแล้ว');
        await refresh('/api/workspace');
        closeModal(true);
      }}
    >
      <div className="field">
        <label htmlFor="goal-scope">เป้าหมายของ</label>
        <select id="goal-scope" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="">ทั้งองค์กร</option>
          {visibleTeams(work).map((t) => (
            <option key={t.id} value={t.id}>
              ทีม{t.name}
            </option>
          ))}
        </select>
        <p className="tiny muted">
          {scope ? 'ช่องที่เว้นว่างใช้เป้าของทั้งองค์กร ตั้งเฉพาะข้อที่ทีมนี้ต่างออกไป' : 'ช่องที่เว้นว่างคือไม่ตั้งเป้าข้อนั้น'}
        </p>
      </div>
      <div className="report-goal-fields">
        {GOAL_ORDER.map((metric) => {
          const meta = GOAL_METRICS[metric];
          const value = current[metric] ?? '';
          const fallback = scope ? goalsFallback(draft[''], metric) : '';
          const unit = meta.kind === 'percent' ? '%' : meta.kind === 'minutes' ? 'นาที' : 'จาก 5';
          return (
            <div key={metric} className="field report-goal-field">
              <label htmlFor={`goal-${metric}`}>
                {meta.label} <span className="muted">({meta.better === 'high' ? 'อย่างน้อย' : 'ไม่เกิน'})</span>
              </label>
              <div className="report-goal-input">
                <input
                  id={`goal-${metric}`}
                  type="number"
                  inputMode="decimal"
                  min={meta.min}
                  max={meta.max}
                  step={meta.kind === 'score' ? 0.1 : 1}
                  value={value}
                  placeholder={fallback ? `ตามองค์กร ${fallback}` : 'ไม่ตั้ง'}
                  onChange={(e) => set(metric, e.target.value)}
                />
                <span>{unit}</span>
              </div>
              {meta.kind === 'minutes' && value && Number(value) > 0 && <p className="tiny muted">เท่ากับ {longDuration(Number(value))}</p>}
            </div>
          );
        })}
      </div>
      <FormActions label="บันทึกเป้าหมาย" onCancel={() => closeModal()} />
    </Form>
  );
}

/** The organization's target of a figure as the team's form shows it ("90%", "60 นาที"), or ''. */
function goalsFallback(org: Record<string, string> | undefined, metric: GoalMetric): string {
  const value = org?.[metric]?.trim();
  if (!value) return '';
  const kind = GOAL_METRICS[metric].kind;
  return kind === 'percent' ? `${value}%` : kind === 'minutes' ? `${value} นาที` : value;
}
