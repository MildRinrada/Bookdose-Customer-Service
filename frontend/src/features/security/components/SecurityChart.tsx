import { number } from '@/lib/format';
import { seriesLabels, type SeriesKey } from '../labels';
import type { SecurityOverview, SecurityRange } from '../types';

/* Failed sign-ins, rate-limited and rejected requests per bucket (hourly for 24 ชม., 6-hourly for 7 วัน). The app's
   chart column (.chart-col: a <progress> per bar, the tip on hover and keyboard focus) grouped three to a bucket, a
   legend that names each colour, and the same numbers as a table for anyone who cannot read the bars. */

const SERIES: SeriesKey[] = ['failed_logins', 'rate_limited', 'rejected'];

const hourText = (at: Date) => `${String(at.getHours()).padStart(2, '0')}:00`;
const dayText = (at: Date) => new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' }).format(at);

function bucketLabel(at: Date, range: SecurityRange) {
  return range === '24h' ? hourText(at) : `${dayText(at)} ${hourText(at)}`;
}

/** The axis shows a few labels only: every third hour, or each day's first bucket (written from its column onwards,
    so not in the last columns, where it would run out of the chart). */
function axisLabel(at: Date, index: number, count: number, range: SecurityRange) {
  if (range === '24h') return index % 3 === 2 || index === count - 1 ? hourText(at).slice(0, 2) : '';
  return at.getHours() < 6 && index < count - 3 ? dayText(at) : '';
}

export function SecurityChart({ series, range }: { series: SecurityOverview['series']; range: SecurityRange }) {
  const max = Math.max(1, ...series.flatMap((b) => SERIES.map((key) => b[key] || 0)));
  const empty = series.every((b) => SERIES.every((key) => !b[key]));
  return (
    <>
      <ul className="security-legend" aria-label="คำอธิบายสี">
        {SERIES.map((key) => (
          <li key={key}>
            <span className={`security-swatch series-${key}`} aria-hidden="true" />
            {seriesLabels[key]}
          </li>
        ))}
      </ul>
      <div className={`security-chart range-${range}`} role="group" aria-label={`เหตุการณ์ความปลอดภัย ${range === '24h' ? 'รายชั่วโมง' : 'ทุก 6 ชั่วโมง'}`}>
        {series.map((b, i) => {
          const at = new Date(b.at);
          const lines = [bucketLabel(at, range), ...SERIES.map((key) => `${seriesLabels[key]} ${number(b[key] || 0)}`)];
          return (
            <div key={b.at} className="chart-col security-col" tabIndex={0} role="img" aria-label={lines.join(' · ')} data-tip={lines.join('\n')}>
              <span className="security-bars" aria-hidden="true">
                {SERIES.map((key) => (
                  <progress key={key} className={`series-${key}`} value={b[key] || 0} max={max} />
                ))}
              </span>
              <small aria-hidden="true">{axisLabel(at, i, series.length, range)}</small>
            </div>
          );
        })}
      </div>
      <p className="tiny muted">
        {empty ? 'ยังไม่มีเหตุการณ์ในช่วงนี้' : `ชี้หรือแตะที่แท่งเพื่อดูจำนวน · สูงสุด ${number(max)} ครั้งต่อช่วง`}
      </p>
      <details className="security-table-view">
        <summary>ดูเป็นตาราง</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">ช่วงเวลา</th>
                {SERIES.map((key) => (
                  <th key={key} scope="col">
                    {seriesLabels[key]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {series.map((b) => (
                <tr key={b.at}>
                  <th scope="row">{bucketLabel(new Date(b.at), range)}</th>
                  {SERIES.map((key) => (
                    <td key={key} className="mono">
                      {number(b[key] || 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
