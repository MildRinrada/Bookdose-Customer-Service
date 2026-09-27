'use client';

import { useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { FilterPill } from '@/components/ui/filters';
import { csvText, saveCSVFile } from '@/features/tickets/csv';
import { useCaseFields } from '@/features/tickets/fields';
import { useCaseTags } from '@/features/tickets/tags';
import type { TicketRow } from '@/features/tickets/types';
import { formatDuration } from '@/lib/format';
import { useMemberName, useTeamName } from '@/lib/session';
import { useUiState } from '@/lib/ui-state';
import {
  dimensionLabel,
  dimensionLabels,
  FEW,
  measure,
  naturalOrder,
  pivot,
  sortRows,
  speedSatisfaction,
  splittableFields,
  type Dimension,
  type Measures,
  type PivotColumn,
  type SpeedBy,
} from '../analysis';

/* The report for people who ask their own questions (analysis.ts): the period's cases split by the dimension picked,
   every measure beside it, sortable and downloadable; and how satisfaction moves with speed. Markup: pages/reports
   (pivot-*, speed-*). */

/** Two sets of figures, so the table stays readable: how fast (first reply, the next reply, solved) and how well
    (solved in one reply, reopened, satisfied, upset). The case count leads both. */
type ColumnSet = 'speed' | 'quality';
const COLUMN_SETS: Record<ColumnSet, string> = { speed: 'ความเร็ว', quality: 'คุณภาพและความรู้สึก' };

const pct = (value: number | null) => (value == null ? '-' : `${value.toFixed(0)}%`);

type Column = { key: PivotColumn; label: string; title: string; set: ColumnSet; cell: (m: Measures) => { text: ReactNode; tone: string } };

const COLUMNS: Column[] = [
  {
    key: 'responseMedian',
    label: 'ตอบครั้งแรก',
    title: 'ค่ากลางของเวลาตอบครั้งแรก: ครึ่งหนึ่งของเคสตอบภายในเวลานี้',
    set: 'speed',
    cell: (m) => ({ text: formatDuration(m.responseMedian), tone: m.answered < FEW ? 'pivot-few' : '' }),
  },
  {
    key: 'responseP90',
    label: '9 ใน 10 ตอบภายใน',
    title: 'P90: 9 ใน 10 เคสตอบครั้งแรกภายในเวลานี้',
    set: 'speed',
    cell: (m) => ({ text: formatDuration(m.responseP90), tone: m.answered < FEW ? 'pivot-few' : '' }),
  },
  {
    key: 'responseSla',
    label: 'ตอบทัน SLA',
    title: 'สัดส่วนเคสที่ตอบครั้งแรกทันกำหนด',
    set: 'speed',
    cell: (m) => ({ text: pct(m.responseSla), tone: m.answered < FEW ? 'pivot-few' : m.responseSla != null && m.responseSla < 80 ? 'report-low' : '' }),
  },
  {
    key: 'nextReplyMedian',
    label: 'รอคำตอบถัดไป',
    title: 'ค่ากลางของเวลาที่ลูกค้ารอคำตอบถัดไป หลังทีมตอบครั้งแรกแล้ว',
    set: 'speed',
    cell: (m) => ({ text: formatDuration(m.nextReplyMedian), tone: m.waits && m.waits < FEW ? 'pivot-few' : '' }),
  },
  {
    key: 'resolutionMedian',
    label: 'แก้ไขเสร็จ',
    title: 'ค่ากลางของเวลาจากเปิดเคสจนแก้ไขเสร็จ',
    set: 'speed',
    cell: (m) => ({ text: formatDuration(m.resolutionMedian), tone: '' }),
  },
  {
    key: 'oneTouchRate',
    label: 'แก้จบครั้งเดียว',
    title: 'สัดส่วนเคสที่แก้ไขเสร็จด้วยคำตอบเดียว และไม่กลับมาเปิดใหม่',
    set: 'quality',
    cell: (m) => ({ text: pct(m.oneTouchRate), tone: m.solvedReplied && m.solvedReplied < FEW ? 'pivot-few' : '' }),
  },
  {
    key: 'reopenRate',
    label: 'เปิดซ้ำ',
    title: 'สัดส่วนเคสที่แก้ไขแล้วแต่กลับมาเปิดใหม่',
    set: 'quality',
    cell: (m) => ({ text: pct(m.reopenRate), tone: m.finished && m.finished < FEW ? 'pivot-few' : '' }),
  },
  {
    key: 'csat',
    label: 'CSAT',
    title: 'คะแนนความพึงพอใจเฉลี่ย และจำนวนคำตอบ',
    set: 'quality',
    cell: (m) => ({
      text: (
        <span>
          {m.csat == null ? '-' : `${m.csat.toFixed(1)} ★`}
          {m.csatCount > 0 && <small className="muted"> ({m.csatCount} คำตอบ)</small>}
        </span>
      ),
      tone: m.csatCount && m.csatCount < FEW ? 'pivot-few' : '',
    }),
  },
  {
    key: 'upsetRate',
    label: 'ลูกค้าไม่พอใจ',
    title: 'สัดส่วนเคสที่ลูกค้าไม่พอใจหรือโกรธอย่างน้อยหนึ่งข้อความ',
    set: 'quality',
    cell: (m) => ({ text: pct(m.upsetRate), tone: m.measured && m.measured < FEW ? 'pivot-few' : '' }),
  },
];

function Cells({ m, label, columns }: { m: Measures & { share?: number }; label: string; columns: Column[] }) {
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
      {columns.map((c) => {
        const { text, tone } = c.cell(m);
        return (
          <td key={c.key} data-label={c.label} className={tone}>
            {text}
          </td>
        );
      })}
    </>
  );
}

export function PivotCard({ tickets }: { tickets: TicketRow[] }) {
  const teamName = useTeamName();
  const memberName = useMemberName();
  const tagList = useCaseTags();
  const caseFields = useCaseFields();
  const [picked, setDimension] = useUiState<Dimension>('reports:pivot', 'channel');
  const [set, setSet] = useUiState<ColumnSet>('reports:pivot-set', 'speed');
  const columns = COLUMNS.filter((c) => c.set === set);
  // ป้ายเคส only once the organization has a list of them; its case fields that split cases into a few groups after.
  const dimensions: Dimension[] = [
    ...(Object.keys(dimensionLabels) as Dimension[]).filter((d) => d !== 'tag' || tagList.length > 0),
    ...splittableFields(caseFields).map((f) => `field:${f.id}` as const),
  ];
  const dimension = dimensions.includes(picked) ? picked : 'channel';
  const label = dimensionLabel(dimension, caseFields);
  const natural = naturalOrder(dimension);
  const [sort, setSort] = useState<{ column: PivotColumn | 'natural'; descending: boolean } | null>(null);
  const current = sort ?? (natural ? { column: 'natural' as const, descending: false } : { column: 'cases' as const, descending: true });
  const rows = sortRows(
    pivot(tickets, dimension, { team: teamName, member: memberName, tags: tagList, fields: caseFields }),
    current.column,
    current.descending,
  );
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
  // The file has every figure, whichever set is on screen.
  const download = () => {
    const round = (n: number | null) => (n == null ? '' : Math.round(n * 10) / 10);
    saveCSVFile(
      csvText([
        [label, 'เคส', 'สัดส่วน (%)', 'ตอบครั้งแรก ค่ากลาง (นาที)', 'ตอบครั้งแรก P90 (นาที)', 'ตอบทัน SLA (%)', 'รอคำตอบถัดไป ค่ากลาง (นาที)',
          'แก้ไขเสร็จ ค่ากลาง (นาที)', 'แก้จบในครั้งเดียว (%)', 'CSAT เฉลี่ย', 'จำนวนคำตอบ CSAT', 'เปิดซ้ำ (%)', 'ลูกค้าไม่พอใจ (%)'],
        ...rows.map((r) => [r.label, r.cases, round(r.share), round(r.responseMedian), round(r.responseP90), round(r.responseSla),
          round(r.nextReplyMedian), round(r.resolutionMedian), round(r.oneTouchRate), round(r.csat), r.csatCount, round(r.reopenRate),
          round(r.upsetRate)]),
      ]),
      `report-by-${dimension.startsWith('field:') ? 'field' : dimension}.csv`,
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
          {dimensions.map((d) => (
            <FilterPill key={d} value={d} label={dimensionLabel(d, caseFields)} pressed={d === dimension} onClick={pick} />
          ))}
        </div>
        <div className="pivot-sets">
          <span id="pivot-set-label">ตัวเลข</span>
          <div className="filter-pills" role="group" aria-labelledby="pivot-set-label">
            {(Object.keys(COLUMN_SETS) as ColumnSet[]).map((key) => (
              <FilterPill
                key={key}
                value={key}
                label={COLUMN_SETS[key]}
                pressed={key === set}
                onClick={(value) => {
                  setSet(value as ColumnSet);
                  if (sort && !['label', 'cases'].includes(sort.column) && !COLUMNS.some((c) => c.key === sort.column && c.set === value)) setSort(null);
                }}
              />
            ))}
          </div>
        </div>
        {worst && (
          <p className="notice warning report-hint">
            <Icon name="clock" />
            <span>
              {label} &ldquo;{worst.label}&rdquo; ตอบทัน SLA เพียง {worst.responseSla!.toFixed(0)}% ต่ำที่สุดในตารางนี้
            </span>
          </p>
        )}
      </div>
      <table className="pivot-table">
        <thead>
          <tr>
            <th aria-sort={current.column === 'label' ? (current.descending ? 'descending' : 'ascending') : 'none'}>
              <button type="button" className="pivot-sort" onClick={() => sortBy('label')}>
                {label}
                {current.column === 'label' && <span aria-hidden="true">{current.descending ? ' ▼' : ' ▲'}</span>}
              </button>
            </th>
            {[{ key: 'cases' as const, label: 'เคส', title: 'จำนวนเคสที่เปิดในช่วงนี้ และสัดส่วนจากทั้งหมด' }, ...columns].map((c) => (
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
              <Cells m={r} label={r.label} columns={columns} />
            </tr>
          ))}
        </tbody>
        {rows.length > 1 && (
          <tfoot>
            <tr>
              <Cells m={total} label="รวมทั้งหมด" columns={columns} />
            </tr>
          </tfoot>
        )}
      </table>
      <p className="card-note tiny muted">
        ตัวเลขสีจางมาจากเคสน้อยกว่า {FEW} เคส ยังใช้ตัดสินอะไรไม่ได้ · ตอบครั้งแรกและแก้ไขเสร็จเป็นค่ากลาง ไม่ใช่ค่าเฉลี่ย · วันและช่วงเวลานับตามนาฬิกาของเครื่องคุณ
        {dimension === 'tag' && ' · เคสที่ติดหลายป้ายนับในทุกป้าย สัดส่วนรวมกันจึงเกิน 100% ได้'}
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
          <h2 className="report-title">
            <Icon name="star" />
            ความเร็วกับความพอใจ
          </h2>
          <p>เคสที่เปิดในช่วงนี้และลูกค้าให้คะแนนแล้ว {s.total} เคส · คะแนนเฉลี่ยแยกตามว่าลูกค้ารอนานแค่ไหน</p>
        </div>
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
