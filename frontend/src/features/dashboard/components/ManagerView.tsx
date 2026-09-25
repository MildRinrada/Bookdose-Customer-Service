'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { EscalationRow } from '@/features/automation/components/EscalationRow';
import { clockTime, formatDuration, relative, starsText } from '@/lib/format';
import { roleLabels } from '@/lib/labels';
import { useTeamName } from '@/lib/session';
import { presenceLabels, sortedAgents } from '../labels';
import type { ManagerOverview } from '../types';

/* The manager view (admins and team leads): live agent activity, satisfaction in short and automation. The busy
   hours and the full satisfaction figures are in the service report (/reports). Its head and cards glide in from the
   right as they are scrolled to (data-reveal, lib/reveal), so it reads as a board of its own below the member's work.
   Markup: pages/dashboard/manager-view, agent-row, csat-score. */

export function ManagerView({ manager: m }: { manager: ManagerOverview }) {
  const teamName = useTeamName();
  const agents = sortedAgents(m.agents);
  const c = m.csat;
  const a = m.automation;
  const csatAverage = c.average == null ? '' : c.average.toFixed(1);

  return (
    <>
      <div className="manager-head" data-reveal="">
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
        <section className="card agents-card" data-reveal="">
          <div className="card-header">
            <div>
              <h2><Icon name="users" className="card-title-icon" />สถานะเจ้าหน้าที่ Real-time</h2>
              <p>
                Live Agent Activity · กำลังใช้งาน {agents.filter((x) => x.presence === 'online').length} จาก {agents.length} คน
              </p>
            </div>
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
                  <UserAvatar id={x.id} name={x.name} index={i} />
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
        <section className="card csat-card" data-reveal="">
          <div className="card-header">
            <div>
              <h2><Icon name="star" className="card-title-icon" />ความพึงพอใจลูกค้า</h2>
              <p>
                CSAT · 30 วันล่าสุด · ตอบ {c.count} จาก {c.sent} แบบประเมิน
              </p>
            </div>
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
            <Link className="csat-more" href="/reports">
              ดูคะแนนรายสัปดาห์และความเห็นลูกค้าในรายงาน <Icon name="arrow" />
            </Link>
          </div>
        </section>
        <section className="card auto-card" data-reveal="">
          <div className="card-header">
            <div>
              <h2><Icon name="macro" className="card-title-icon" />ระบบอัตโนมัติ</h2>
              <p>Automation &amp; Workflow</p>
            </div>
          </div>
          <div className="card-body auto-body">
            <div className="auto-summary">
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
            </div>
            {m.escalations.length > 0 && (
              <div className="auto-escalations">
                {m.escalations.slice(0, 3).map((e) => (
                  <EscalationRow key={`${e.ticket_id}:${e.escalated_at}`} escalation={e} />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
