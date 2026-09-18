import { formatDuration } from '@/lib/format';
import type { MyDay as MyDayData } from '../types';

/* วันนี้ของฉัน: one thin strip of the member's own figures - replies and cases closed today, cases in hand, and over 30
   days their first response time and satisfaction. Markup: dashboard-extras (myday-card). */

export function MyDay({ day }: { day: MyDayData }) {
  const cells: Array<[string, string, string]> = [
    ['ตอบวันนี้', String(day.replies), 'ข้อความ'],
    ['ปิดเคสวันนี้', String(day.resolved), 'เคส'],
    ['ถืออยู่', String(day.open), 'เคส'],
    ['ตอบครั้งแรกเฉลี่ย', formatDuration(day.avg_first_response), '30 วัน'],
    ['CSAT ของฉัน', day.csat == null ? '-' : `${day.csat.toFixed(1)} ★`, day.csat_count ? `${day.csat_count} คำตอบ` : 'ยังไม่มีคำตอบ'],
  ];
  return (
    <section className="card myday-card" aria-labelledby="myday-title">
      <div className="myday-head">
        <h2 id="myday-title">วันนี้ของฉัน</h2>
        <p className="tiny muted">เวลาตอบและ CSAT นับจากเคสที่คุณรับผิดชอบ</p>
      </div>
      <dl className="myday-grid">
        {cells.map(([label, value, foot]) => (
          <div key={label} className="myday-cell">
            <dt>{label}</dt>
            <dd>
              <span className="mono">{value}</span> <span className="tiny muted">{foot}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
