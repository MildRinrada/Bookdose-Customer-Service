'use client';

import { Icon } from '@/components/Icon';
import { useCaseTags } from '@/features/tickets/tags';
import type { TicketRow } from '@/features/tickets/types';
import { date } from '@/lib/format';
import { useMemberName, useTeamName, useWork } from '@/lib/session';
import { dimensionLabels, upsetHotspots } from '../analysis';
import { reaches, targetsFor, useGoals } from '../goals';
import { customerMood, longDuration, nextReply, oneTouch, periodTiles } from '../insights';
import { reportTrend } from '../labels';
import type { ReportFilter } from '../types';

/* What the first reply does not show (insights.ts nextReply, oneTouch, customerMood; the figures come from the
   report's extras, backend reports/stats.py): how long customers waited for each next reply once the team had
   answered, how many solved cases took one reply, and how many customers were upset along the way and about what.
   Markup: pages/report-insights (report-figures, report-weeks, report-mood-*). */

const pct = (value: number | null) => (value == null ? '-' : `${value.toFixed(0)}%`);

/** รอคำตอบถัดไป and แก้จบในครั้งเดียว, against the period before. */
export function ConversationCard({ all, f, loading }: { all: TicketRow[]; f: ReportFilter; loading: boolean }) {
  const wait = nextReply(all, f);
  const waitBefore = nextReply(all, f, true);
  const once = oneTouch(all, f);
  const onceBefore = oneTouch(all, f, true);
  return (
    <section className="card report-card">
      <div className="card-header">
        <div>
          <h2 className="report-title">
            <Icon name="chat" />
            ระหว่างการคุย
          </h2>
          <p>หลังตอบครั้งแรกแล้ว ลูกค้ายังรอนานแค่ไหน และทีมตอบจบในครั้งเดียวได้แค่ไหน</p>
        </div>
      </div>
      <div className="card-body">
        {loading ? (
          <p className="empty-mini">กำลังนับจากข้อความของแต่ละเคส…</p>
        ) : (
          <div className="report-figures">
            <div>
              <span>รอคำตอบถัดไป (ค่ากลาง)</span>
              <strong>{longDuration(wait.median)}</strong>
              <small>
                {wait.count
                  ? `9 ใน 10 ครั้งได้คำตอบภายใน ${longDuration(wait.p90)} จาก ${wait.count} ครั้งที่รอ`
                  : 'ยังไม่มีเคสที่ลูกค้าถามต่อหลังได้คำตอบแรก'}
              </small>
              <small>{reportTrend(wait.median, waitBefore.median, 'นาที')}</small>
            </div>
            <div>
              <span>แก้จบในครั้งเดียว</span>
              <strong>{pct(once.rate)}</strong>
              <small>{once.finished ? `${once.once} จาก ${once.finished} เคสที่แก้ไขเสร็จ ตอบครั้งเดียวและไม่เปิดซ้ำ` : 'ยังไม่มีเคสที่แก้ไขเสร็จในช่วงนี้'}</small>
              <small>{reportTrend(once.rate, onceBefore.rate, '%')}</small>
            </div>
          </div>
        )}
        <p className="tiny muted report-conversation-note">
          รอคำตอบถัดไปนับจากข้อความแรกที่ลูกค้าเขียนมาหลังทีมตอบแล้ว จนถึงคำตอบถัดไปของทีม คำตอบของบอตไม่นับ ครั้งที่ยังรออยู่ยังไม่นับ
        </p>
      </div>
    </section>
  );
}

/** อารมณ์ลูกค้า: the share of cases whose customer was upset, tile by tile, and the subjects, tags and channels where
    it happens most (groups of at least FEW cases). */
export function MoodCard({ all, f, tickets, loading }: { all: TicketRow[]; f: ReportFilter; tickets: TicketRow[]; loading: boolean }) {
  const work = useWork();
  const teamName = useTeamName();
  const memberName = useMemberName();
  const tags = useCaseTags();
  const goals = useGoals();
  const team = f.team || (work.role === 'agent' ? (work.team_id ?? '') : '');
  const target = targetsFor(goals, team).upset;
  const mood = customerMood(all, f);
  const before = customerMood(all, f, true);
  const tiles = periodTiles(f);
  const where = upsetHotspots(tickets, { team: teamName, member: memberName, tags });
  const high = target != null && reaches('upset', mood.rate, target) === false;
  return (
    <section className="card report-card">
      <div className="card-header">
        <div>
          <h2 className="report-title">
            <Icon name="frown" />
            อารมณ์ลูกค้า
          </h2>
          <p>เคสที่ลูกค้าไม่พอใจหรือโกรธอย่างน้อยหนึ่งข้อความ รู้ได้ก่อนคะแนนความพึงพอใจ ซึ่งลูกค้าส่วนใหญ่ไม่ได้ตอบ</p>
        </div>
      </div>
      <div className="card-body">
        {loading ? (
          <p className="empty-mini">กำลังนับจากข้อความของแต่ละเคส…</p>
        ) : !mood.total ? (
          <p className="empty-mini">ยังไม่มีเคสที่เปิดในช่วงนี้</p>
        ) : (
          <>
            <div className="report-figures">
              <div className={high ? 'warn' : ''}>
                <span>ลูกค้าไม่พอใจ</span>
                <strong>{pct(mood.rate)}</strong>
                <small>
                  {mood.upset} จาก {mood.total} เคส{target != null ? ` เป้าไม่เกิน ${target}%` : ''}
                </small>
                <small>{reportTrend(mood.rate, before.rate, '%')}</small>
              </div>
              <div>
                <span>โกรธมาก</span>
                <strong>{mood.angry}</strong>
                <small>เคสที่ลูกค้าโกรธมาก เช่น ขู่ร้องเรียนหรือใช้คำรุนแรง</small>
              </div>
            </div>
            {tiles.length > 1 && (
              <div className="report-weeks" aria-label="ลูกค้าไม่พอใจแต่ละช่วง">
                {tiles.map((tile) => {
                  const part = customerMood(all, tile.f);
                  const over = target != null ? reaches('upset', part.rate, target) === false : false;
                  return (
                    <div key={tile.start.toISOString()} className="report-week" title={`${date(tile.start)}: ${part.upset} จาก ${part.total} เคส`}>
                      <span className={`report-week-score${part.rate == null ? ' none' : over ? ' low' : ''}`}>{part.rate == null ? '–' : pct(part.rate)}</span>
                      <span className="report-week-day">{date(tile.start)}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {where.length > 0 && (
              <>
                <h3 className="report-subhead">ลูกค้าไม่พอใจบ่อยในเรื่องไหน</h3>
                {where.map(({ dimension, row }) => (
                  <div key={`${dimension}:${row.key}`} className="bar-row" title={`${row.label}: ${pct(row.upsetRate)} ของ ${row.measured} เคส`}>
                    <span className="bar-label report-mood-label">
                      <small className="muted">{dimensionLabels[dimension]}</small>
                      {row.label}
                    </span>
                    <progress value={row.upsetRate ?? 0} max={100} aria-label={`${row.label} ${pct(row.upsetRate)}`} />
                    <span className="bar-value">
                      {pct(row.upsetRate)}
                      <small className="muted"> ของ {row.measured} เคส</small>
                    </span>
                  </div>
                ))}
              </>
            )}
          </>
        )}
        <p className="tiny muted report-conversation-note">อ่านจากคำในข้อความของลูกค้า และจาก AI เมื่อเปิดอ่านอารมณ์ลูกค้าด้วย AI ข้อความที่ใจเย็นลงทีหลังไม่ลบว่าเคยไม่พอใจ</p>
      </div>
    </section>
  );
}
