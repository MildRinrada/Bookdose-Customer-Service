'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { FilterPill } from '@/components/ui/filters';
import { csvText, saveCSVFile } from '@/features/tickets/csv';
import type { TicketRow } from '@/features/tickets/types';
import { formatDuration } from '@/lib/format';
import { useMemberName, useTeamName } from '@/lib/session';
import { useUiState } from '@/lib/ui-state';
import {
  dimensionLabels,
  FEW,
  measure,
  orderedDimensions,
  pivot,
  sortRows,
  speedSatisfaction,
  type Dimension,
  type Measures,
  type PivotColumn,
  type SpeedBy,
} from '../analysis';

/* The report for people who ask their own questions (analysis.ts): the period's cases split by the dimension picked,
   every measure beside it, sortable and downloadable; and how satisfaction moves with speed. Markup: pages/reports
   (pivot-*, speed-*). */

const COLUMNS: Array<{ key: PivotColumn; label: string; title: string }> = [
  { key: 'cases', label: 'เคส', title: 'จำนวนเคสที่เปิดในช่วงนี้ และสัดส่วนจากทั้งหมด' },
  { key: 'responseMedian', label: 'ตอบครั้งแรก', title: 'ค่ากลางของเวลาตอบครั้งแรก: ครึ่งหนึ่งของเคสตอบภายในเวลานี้' },
  { key: 'responseP90', label: '9 ใน 10 ตอบภายใน', title: 'P90: 9 ใน 10 เคสตอบครั้งแรกภายในเวลานี้' },
  { key: 'responseSla', label: 'ตอบทัน SLA', title: 'สัดส่วนเคสที่ตอบครั้งแรกทันกำหนด' },
  { key: 'resolutionMedian', label: 'แก้ไขเสร็จ', title: 'ค่ากลางของเวลาจากเปิดเคสจนแก้ไขเสร็จ' },
  { key: 'csat', label: 'CSAT', title: 'คะแนนความพึงพอใจเฉลี่ย และจำนวนคำตอบ' },
  { key: 'reopenRate', label: 'เปิดซ้ำ', title: 'สัดส่วนเคสที่แก้ไขแล้วแต่กลับมาเปิดใหม่' },
];

const pct = (value: number | null) => (value == null ? '-' : `${value.toFixed(0)}%`);

function Cells({ m, label }: { m: Measures & { share?: number }; label: string }) {
  const fewAnswered = m.answered < FEW;
  return (
    <>
      <td data-label={label} className="pivot-name">
        {label}
      </td>
      <td data-label="เคส">
        <span>
          <strong>{m.cases}</strong>
          {m.share != null && <small className="muted"> {m.share.toFixed(0)}%</small>}
        </span>
      </td>
      <td data-label="ตอบครั้งแรก" className={fewAnswered ? 'pivot-few' : ''}>
        {formatDuration(m.responseMedian)}
      </td>
      <td data-label="9 ใน 10 ตอบภายใน" className={fewAnswered ? 'pivot-few' : ''}>
        {formatDuration(m.responseP90)}
      </td>
      <td data-label="ตอบทัน SLA" className={fewAnswered ? 'pivot-few' : m.responseSla != null && m.responseSla < 80 ? 'report-low' : ''}>
        {pct(m.responseSla)}
      </td>
      <td data-label="แก้ไขเสร็จ">{formatDuration(m.resolutionMedian)}</td>
      <td data-label="CSAT" className={m.csatCount && m.csatCount < FEW ? 'pivot-few' : ''}>
        <span>
          {m.csat == null ? '-' : `${m.csat.toFixed(1)} ★`}
          {m.csatCount > 0 && <small className="muted"> ({m.csatCount} คำตอบ)</small>}
        </span>
      </td>
      <td data-label="เปิดซ้ำ" className={m.finished && m.finished < FEW ? 'pivot-few' : ''}>
        {pct(m.reopenRate)}
      </td>
    </>
  );
}

export function PivotCard({ tickets }: { tickets: TicketRow[] }) {
  const teamName = useTeamName();
  const memberName = useMemberName();
  const [dimension, setDimension] = useUiState<Dimension>('reports:pivot', 'channel');
  const natural = orderedDimensions.includes(dimension);
  const [sort, setSort] = useState<{ column: PivotColumn | 'natural'; descending: boolean } | null>(null);
  const current = sort ?? (natural ? { column: 'natural' as const, descending: false } : { column: 'cases' as const, descending: true });
  const rows = sortRows(pivot(tickets, dimension, { team: teamName, member: memberName }), current.column, current.descending);
  const total = measure(tickets);
  const worst = rows
    .filter((r) => r.answered >= FEW && r.responseSla != null && r.responseSla < 80)
    .sort((a, b) => (a.responseSla ?? 100) - (b.responseSla ?? 100))[0];

  const pick = (value: string) => {
    setDimension(value as Dimension);
    setSort(null);
  };
  const sortBy = (column: PivotColumn) =>
    setSort({ column, descending: current.column === column ? !current.descending : column !== 'label' });
  const download = () => {
    const round = (n: number | null) => (n == null ? '' : Math.round(n * 10) / 10);
    saveCSVFile(
      csvText([
        [dimensionLabels[dimension], 'เคส', 'สัดส่วน (%)', 'ตอบครั้งแรก ค่ากลาง (นาที)', 'ตอบครั้งแรก P90 (นาที)', 'ตอบทัน SLA (%)',
          'แก้ไขเสร็จ ค่ากลาง (นาที)', 'CSAT เฉลี่ย', 'จำนวนคำตอบ CSAT', 'เปิดซ้ำ (%)'],
        ...rows.map((r) => [r.label, r.cases, round(r.share), round(r.responseMedian), round(r.responseP90), round(r.responseSla),
          round(r.resolutionMedian), round(r.csat), r.csatCount, round(r.reopenRate)]),
      ]),
      `report-by-${dimension}.csv`,
    );
  };

  return (
    <section className="card report-card pivot-card">
      <div className="card-header">
        <div>
          <h2>วิเคราะห์แยกตามมุมที่เลือก</h2>
          <p>เคสที่เปิดในช่วงนี้ {tickets.length} เคส · เลือกว่าจะแยกตามอะไร แล้วกดหัวคอลัมน์เพื่อเรียงลำดับ</p>
        </div>
        <button type="button" className="btn subtle sm" onClick={download} disabled={!rows.length}>
          <Icon name="download" />
          ดาวน์โหลดตารางนี้
        </button>
      </div>
      <div className="card-body">
        <div className="filter-pills pivot-dimensions" role="group" aria-label="แยกตาม">
          {(Object.keys(dimensionLabels) as Dimension[]).map((d) => (
            <FilterPill key={d} value={d} label={dimensionLabels[d]} pressed={d === dimension} onClick={pick} />
          ))}
        </div>
        {worst && (
          <p className="notice warning report-hint">
            <Icon name="clock" />
            <span>
              {dimensionLabels[dimension]} &ldquo;{worst.label}&rdquo; ตอบทัน SLA เพียง {worst.responseSla!.toFixed(0)}% ต่ำที่สุดในตารางนี้
            </span>
          </p>
        )}
      </div>
      <table className="pivot-table">
        <thead>
          <tr>
            <th aria-sort={current.column === 'label' ? (current.descending ? 'descending' : 'ascending') : 'none'}>
              <button type="button" className="pivot-sort" onClick={() => sortBy('label')}>
                {dimensionLabels[dimension]}
                {current.column === 'label' && <span aria-hidden="true">{current.descending ? ' ▼' : ' ▲'}</span>}
              </button>
            </th>
            {COLUMNS.map((c) => (
              <th key={c.key} aria-sort={current.column === c.key ? (current.descending ? 'descending' : 'ascending') : 'none'}>
                <button type="button" className="pivot-sort" title={c.title} onClick={() => sortBy(c.key)}>
                  {c.label}
                  {current.column === c.key && <span aria-hidden="true">{current.descending ? ' ▼' : ' ▲'}</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key || 'none'}>
              <Cells m={r} label={r.label} />
            </tr>
          ))}
        </tbody>
        {rows.length > 1 && (
          <tfoot>
            <tr>
              <Cells m={total} label="รวมทั้งหมด" />
            </tr>
          </tfoot>
        )}
      </table>
      <p className="card-note tiny muted">
        ตัวเลขสีจางมาจากเคสน้อยกว่า {FEW} เคส ยังใช้ตัดสินอะไรไม่ได้ · ตอบครั้งแรกและแก้ไขเสร็จเป็นค่ากลาง ไม่ใช่ค่าเฉลี่ย · วันและช่วงเวลานับตามนาฬิกาของเครื่องคุณ
      </p>
    </section>
  );
}

const SPEED_BY: Record<SpeedBy, string> = { response: 'ตามเวลาตอบครั้งแรก', resolution: 'ตามเวลาแก้ไขจนเสร็จ' };

export function SpeedSatisfactionCard({ tickets }: { tickets: TicketRow[] }) {
  const [by, setBy] = useUiState<SpeedBy>('reports:speed', 'response');
  const s = speedSatisfaction(tickets, by);
  const waited = by === 'response' ? 'ได้คำตอบแรก' : 'ได้เรื่องแก้ไขเสร็จ';
  return (
    <section className="card report-card">
      <div className="card-header">
        <div>
          <h2>ความเร็วกับความพอใจ</h2>
          <p>เคสที่เปิดในช่วงนี้และลูกค้าให้คะแนนแล้ว {s.total} เคส · คะแนนเฉลี่ยแยกตามว่าลูกค้ารอนานแค่ไหน</p>
        </div>
        <Icon name="star" />
      </div>
      <div className="card-body">
        <div className="filter-pills" role="group" aria-label="แยกตาม">
          {(Object.keys(SPEED_BY) as SpeedBy[]).map((key) => (
            <FilterPill key={key} value={key} label={SPEED_BY[key]} pressed={key === by} onClick={(v) => setBy(v as SpeedBy)} />
          ))}
        </div>
        {s.total ? (
          <>
            {s.compare ? (
              <p className="speed-finding">
                ลูกค้าที่{waited}<strong>{s.compare.fast.label}</strong> ให้คะแนนเฉลี่ย <strong>{s.compare.fast.average!.toFixed(1)}</strong> ส่วนที่รอ
                <strong>{s.compare.slow.label}</strong> ให้ <strong>{s.compare.slow.average!.toFixed(1)}</strong>
              </p>
            ) : (
              <p className="speed-finding muted">ยังสรุปไม่ได้ ต้องมีคำตอบอย่างน้อย {FEW} คำตอบในช่วงเวลาอย่างน้อย 2 ช่วง ลองขยายช่วงวันที่</p>
            )}
            <div className="speed-rows">
              {s.rows.map((r) => (
                <div key={r.label} className={`speed-row${r.count && r.count < FEW ? ' few' : ''}${r.count ? '' : ' none'}`}>
                  <span className="speed-label">{r.label}</span>
                  <progress value={r.average ?? 0} max={5} aria-label={`${r.label}: ${r.average == null ? 'ไม่มีคำตอบ' : r.average.toFixed(1)}`} />
                  <span className="speed-value">
                    {r.average == null ? (
                      <span className="muted">ไม่มีคำตอบ</span>
                    ) : (
                      <>
                        <strong>{r.average.toFixed(1)} ★</strong>
                        <small className="muted">
                          {' '}
                          · พอใจ {r.satisfied!.toFixed(0)}% · {r.count} คำตอบ
                        </small>
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="empty-mini">ยังไม่มีเคสในช่วงนี้ที่ลูกค้าให้คะแนน · ระบบส่งแบบประเมินเมื่อปิดเคส</p>
        )}
        <p className="tiny muted mt">
          ตัวเลขนี้บอกว่าความเร็วกับคะแนนไปด้วยกันแค่ไหน แต่ไม่ได้พิสูจน์ว่าความเร็วเป็นสาเหตุ เพราะเรื่องยากมักทั้งใช้เวลานานและได้คะแนนต่ำ ·
          ช่วงที่มีคำตอบน้อยกว่า {FEW} แสดงเป็นสีจาง
        </p>
      </div>
    </section>
  );
}
