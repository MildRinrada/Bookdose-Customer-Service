'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/ui/display';
import { EscalationRow } from '@/features/automation/components/EscalationRow';
import { clockTime, formatDuration, relative, starsText } from '@/lib/format';
import { roleLabels } from '@/lib/labels';
import { useTeamName } from '@/lib/session';
import { heatmapParts, presenceLabels, sortedAgents, type PeakLine } from '../labels';
import type { ManagerOverview } from '../types';

/* The manager view (admins and team leads): live agent activity, satisfaction, automation and the busy hours of
   the week. Markup: pages/dashboard/manager-view, agent-row, csat-bar, heat-row, heat-cell, peak-item. */

function PeakItem({ line }: { line: PeakLine }) {
  return (
    <li>
      <strong>{line.label}</strong>
      <span className="tiny muted">{line.detail}</span>
    </li>
  );
}

export function ManagerView({ manager: m }: { manager: ManagerOverview }) {
  const teamName = useTeamName();
  const agents = sortedAgents(m.agents);
  const c = m.csat;
  const a = m.automation;
  const heat = heatmapParts(m.heatmap);
  const csatAverage = c.average == null ? '' : c.average.toFixed(1);

  return (
    <>
      <div className="manager-head">
        <div>
          <h2 id="manager-title">มุมมองผู้ดูแล</h2>
          <p>Manager View · อัปเดตอัตโนมัติทุก 30 วินาที · ล่าสุด {clockTime(m.generated_at)}</p>
        </div>
        <Link className="btn subtle small" href="/automation">
          <Icon name="macro" />
          จัดการระบบอัตโนมัติ
        </Link>
      </div>
      <div className="manager-grid">
        <section className="card agents-card">
          <div className="card-header">
            <div>
              <h2>สถานะเจ้าหน้าที่ Real-time</h2>
              <p>
                Live Agent Activity · กำลังใช้งาน {agents.filter((x) => x.presence === 'online').length} จาก {agents.length} คน
              </p>
            </div>
            <Icon name="users" />
          </div>
          <div className="agent-table" role="table" aria-label="สถานะเจ้าหน้าที่">
            <div className="agent-row agent-head" role="row">
              <span role="columnheader">เจ้าหน้าที่</span>
              <span role="columnheader">สถานะ</span>
              <span role="columnheader" title="เคสที่ยังไม่ปิดที่รับผิดชอบอยู่">ถืออยู่</span>
              <span role="columnheader">ปิดวันนี้</span>
              <span role="columnheader">ตอบวันนี้</span>
              <span role="columnheader" title="เวลาตอบครั้งแรกเฉลี่ย 30 วันล่าสุด">ตอบแรกเฉลี่ย</span>
              <span role="columnheader">CSAT</span>
            </div>
            {agents.map((x, i) => (
              <div key={x.id} className="agent-row" role="row">
                <span className="agent-who" role="cell">
                  <Avatar name={x.name} index={i} />
                  <span className="agent-name">
                    <strong className="truncate">{x.name}</strong>
                    <span className="tiny muted truncate">
                      {roleLabels[x.role]} · {teamName(x.team_id)}
                    </span>
                  </span>
                </span>
                <span className="agent-state" role="cell">
                  <span className={`presence-label ${x.presence}`}>{presenceLabels[x.presence]}</span>
                  <span className="tiny muted">{x.last_seen ? `ล่าสุด ${relative(x.last_seen)}` : 'ยังไม่เคยเข้าใช้'}</span>
                </span>
                <span className="mono agent-num" role="cell" data-label="เคสที่ถืออยู่">
                  {x.open}
                </span>
                <span className="mono agent-num" role="cell" data-label="ปิดวันนี้">
                  {x.resolved_today}
                </span>
                <span className="mono agent-num" role="cell" data-label="ตอบวันนี้">
                  {x.replies_today}
                </span>
                <span className="mono agent-num" role="cell" data-label="ตอบครั้งแรกเฉลี่ย">
                  {formatDuration(x.avg_first_response)}
                </span>
                <span className="mono agent-num" role="cell" data-label="CSAT">
                  {x.csat == null ? '-' : `${x.csat.toFixed(1)} ★`}
                </span>
              </div>
            ))}
          </div>
          <p className="card-note tiny muted">“กำลังใช้งาน” คือเปิดโปรแกรมภายใน 5 นาทีล่าสุด · ตอบครั้งแรกเฉลี่ยและ CSAT นับ 30 วันล่าสุดจากเคสที่รับผิดชอบ</p>
        </section>
        <section className="card csat-card">
          <div className="card-header">
            <div>
              <h2>ความพึงพอใจลูกค้า</h2>
              <p>
                CSAT · 30 วันล่าสุด · ตอบ {c.count} จาก {c.sent} แบบประเมิน
              </p>
            </div>
            <Icon name="star" />
          </div>
          <div className="card-body">
            {csatAverage ? (
              <>
                <div className="csat-score">
                  <span className="csat-big mono">{csatAverage}</span>
                  <span className="muted">/ 5</span>
                  <span className="csat-stars" aria-hidden="true">
                    {starsText(Math.round(c.average as number))}
                  </span>
                </div>
                <p className="csat-satisfied">
                  <strong>{c.satisfied}%</strong> ของคำตอบพอใจ (4-5 ดาว)
                </p>
              </>
            ) : (
              <div className="empty-mini">ยังไม่มีคำตอบแบบประเมิน · ระบบส่งให้ลูกค้าเมื่อปิดเคส</div>
            )}
            <div className="csat-bars">
              {[5, 4, 3, 2, 1].map((n) => {
                const label = `${n} ★`;
                const count = c.distribution[n] ?? 0;
                return (
                  <div key={n} className="csat-bar">
                    <span className="csat-bar-label">{label}</span>
                    <progress value={count} max={Math.max(1, c.count)} aria-label={`${label} ${count} คำตอบ`} />
                    <span className="mono">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
        <section className="card auto-card">
          <div className="card-header">
            <div>
              <h2>ระบบอัตโนมัติ</h2>
              <p>Automation &amp; Workflow</p>
            </div>
            <Icon name="macro" />
          </div>
          <div className="card-body">
            <div className="auto-stats">
              <Link href="/automation" className="auto-stat">
                <span className="mono">{a.rules}</span>กฎที่เปิดใช้
              </Link>
              <Link href="/automation" className="auto-stat">
                <span className="mono">{a.macros}</span>Macro
              </Link>
              <span className={`auto-stat${a.escalations_today ? ' warn' : ''}`}>
                <span className="mono">{a.escalations_today}</span>ยกระดับวันนี้
              </span>
              <span className={`auto-stat${a.followups_due ? ' warn' : ''}`}>
                <span className="mono">{a.followups_due}</span>ติดตามถึงกำหนด
              </span>
            </div>
            <ul className="auto-status">
              <li className={a.escalation_enabled ? 'on' : ''}>
                {a.escalation_enabled ? `ยกระดับเมื่อไม่มีผู้รับเรื่องใน ${a.escalation_minutes} นาที` : 'ปิดการยกระดับ SLA อัตโนมัติ'}
              </li>
              <li className={a.csat_enabled ? 'on' : ''}>{a.csat_enabled ? 'ส่งแบบประเมินความพึงพอใจเมื่อปิดเคส' : 'ปิดการส่งแบบประเมิน'}</li>
            </ul>
            {m.escalations.slice(0, 3).map((e) => (
              <EscalationRow key={`${e.ticket_id}:${e.escalated_at}`} escalation={e} />
            ))}
          </div>
        </section>
        <section className="card heat-card">
          <div className="card-header">
            <div>
              <h2>ช่วงเวลาที่เรื่องเข้ามามากที่สุด</h2>
              <p>
                Peak Time · เฉลี่ยต่อสัปดาห์จาก {heat.weeks} สัปดาห์ล่าสุด ({heat.total} เรื่อง ทุกช่องทาง) · เวลาตามเครื่องของคุณ
              </p>
            </div>
            <Icon name="calendar" />
          </div>
          <div className="card-body">
            <div className="heatmap-scroll">
              <div className="heatmap" role="img" aria-label={heat.summary}>
                <span className="heat-corner" />
                {Array.from({ length: 24 }, (_, h) => (
                  <span key={`h${h}`} className="heat-hour">
                    {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
                  </span>
                ))}
                {heat.rows.map((row) => [
                  <span key={`d${row.day}`} className="heat-day">
                    {row.day}
                  </span>,
                  ...row.cells.map((cell, h) => <span key={`${row.day}${h}`} className={`heat-cell lv-${cell.level}`} title={cell.tip} />),
                ])}
              </div>
            </div>
            <div className="heat-legend" aria-hidden="true">
              <span>น้อย</span>
              <i className="lv-0" />
              <i className="lv-1" />
              <i className="lv-2" />
              <i className="lv-3" />
              <i className="lv-4" />
              <span>มาก</span>
            </div>
            <div className="peak-grid">
              <div>
                <h3>ช่วงพีค (ช่วงละ 3 ชั่วโมง)</h3>
                <ol className="peak-list">
                  {heat.peaks.map((p) => (
                    <PeakItem key={p.label} line={p} />
                  ))}
                </ol>
                {!heat.peaks.length && <p className="empty-mini">ยังไม่มีเรื่องเข้ามาในช่วงนี้</p>}
              </div>
              <div>
                <h3>คำแนะนำจัดกะ</h3>
                <ul className="peak-list">
                  {heat.advice.map((p) => (
                    <PeakItem key={p.label} line={p} />
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
