'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import {
  AHEAD_DAYS,
  LEARN_WEEKS,
  NEEDED_DAYS,
  RANGE_SHARE,
  TEST_DAYS,
  type Forecast,
  type ForecastDay,
  type TestedDay,
} from '../forecast';

/* พยากรณ์จำนวนเคส (forecast.ts): the coming days as ranges with their busiest hours, and how the same method did on
   the two weeks just gone. Always from today, whatever period the report shows; the team picked applies. The chart
   is an SVG (its sizes are attributes, which the page's CSP allows where inline styles are not). Markup:
   pages/report-insights (forecast-*). */

const dayName = new Intl.DateTimeFormat('th-TH', { weekday: 'short', day: 'numeric', month: 'short' });
const clock = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
const cases = (d: ForecastDay) => (d.low === d.high ? `${d.low}` : `${d.low}-${d.high}`);
const SHOWN = 7;

/** `f` is forecast() of the team picked (the report works it out once, for this card and the staffing card). */
export function ForecastCard({ forecast: f, team }: { forecast: Forecast; team: string }) {
  const [more, setMore] = useState(false);
  const scope = team ? ' ของทีมที่เลือก' : '';

  if (!f.ready)
    return (
      <section className="card report-card">
        <div className="card-header">
          <div>
            <h2 className="report-title">
              <Icon name="chart" />
              พยากรณ์จำนวนเคส
            </h2>
            <p>คาดการณ์เคสใหม่ {AHEAD_DAYS} วันข้างหน้า จากเคสที่ผ่านมา{scope}</p>
          </div>
        </div>
        <div className="card-body">
          <p className="empty-mini">
            ต้องมีเคสย้อนหลังอย่างน้อย {NEEDED_DAYS / 7} สัปดาห์ จึงจะพยากรณ์และทดสอบความแม่นได้
            {f.had ? ` · ตอนนี้มี ${f.had} วัน พยากรณ์ได้ในอีก ${NEEDED_DAYS - f.had} วัน` : ' · ยังไม่มีเคส'}
          </p>
        </div>
      </section>
    );

  const week = f.ahead.slice(0, SHOWN);
  const busiest = week.reduce((a, b) => (b.expected > a.expected ? b : a), week[0]);
  const shown = more ? f.ahead : week;
  const busiestShown = shown.reduce((a, b) => (b.expected > a.expected ? b : a), shown[0]);
  const t = f.tested;
  const doubtful = t.inside < TEST_DAYS * 0.6 || (t.simpler != null && t.simpler < -0.05);

  return (
    <section className="card report-card forecast-card">
      <div className="card-header">
        <div>
          <h2 className="report-title">
            <Icon name="chart" />
            พยากรณ์จำนวนเคส
          </h2>
          <p>
            คาดการณ์เคสใหม่ {AHEAD_DAYS} วันข้างหน้า จากเคส {f.weeks} สัปดาห์ล่าสุด{scope} · นับจากวันนี้ ไม่ขึ้นกับช่วงวันที่ด้านบน
          </p>
        </div>
      </div>
      <div className="card-body">
        <div className="report-figures">
          <div>
            <span>{SHOWN} วันข้างหน้า</span>
            <strong>ราว {Math.round(week.reduce((n, d) => n + d.expected, 0))} เคส</strong>
            <small>{SHOWN} วันที่ผ่านมา {f.lastWeek} เคส</small>
          </div>
          <div>
            <span>วันที่น่าจะหนักที่สุด</span>
            <strong>{dayName.format(busiest.day)}</strong>
            <small>
              {cases(busiest)} เคส{busiest.peak ? ` · หนักสุด ${clock(busiest.peak.from)}-${clock(busiest.peak.to)}` : ''}
            </small>
          </div>
          <div>
            <span>แนวโน้ม</span>
            <Trend trend={f.trend} weeks={f.weeks} />
          </div>
        </div>

        <ForecastChart tested={t.days} ahead={f.ahead} />

        <h3 className="report-subhead">รายวัน</h3>
        <ul className="forecast-list">
          {shown.map((d, i) => (
            <li key={d.day.toDateString()} className={d === busiestShown && d.expected >= 1 ? 'busiest' : ''}>
              <span className="forecast-day">
                {i === 0 && <span className="muted">พรุ่งนี้ · </span>}
                {dayName.format(d.day)}
                {d === busiestShown && d.expected >= 1 && <span className="badge">วันที่หนักที่สุด</span>}
              </span>
              <strong className="forecast-count">{cases(d)} เคส</strong>
              <span className="forecast-peak">
                {d.expected < 1
                  ? 'น่าจะมีเคสน้อยมาก'
                  : d.peak && (
                      <>
                        หนักสุด {clock(d.peak.from)}-{clock(d.peak.to)}
                        {d.peak.cases >= 1 && <span className="muted"> · ราว {Math.round(d.peak.cases)} เคส</span>}
                      </>
                    )}
              </span>
            </li>
          ))}
        </ul>
        <button type="button" className="btn sm mt" aria-expanded={more} onClick={() => setMore(!more)}>
          {more ? `แสดง ${SHOWN} วัน` : `แสดงถึง ${AHEAD_DAYS} วัน`}
        </button>

        <h3 className="report-subhead">ทำนายแม่นแค่ไหน</h3>
        <p className="forecast-test">
          ระบบลองทำนาย {TEST_DAYS} วันที่ผ่านมา โดยใช้เฉพาะเคสก่อนหน้านั้น แล้วเทียบกับเคสที่เข้ามาจริง (ครึ่งซ้ายของกราฟ)
        </p>
        <div className="report-figures">
          <div className={t.share != null && t.share > 0.35 ? 'warn' : ''}>
            <span>พลาดเฉลี่ย</span>
            <strong>วันละ {t.error.toFixed(1)} เคส</strong>
            <small>{t.share != null ? `ราว ${Math.round(100 * t.share)}% ของเคสที่เข้ามาจริง` : 'ช่วงนั้นไม่มีเคส'}</small>
          </div>
          <div className={t.inside < TEST_DAYS * 0.6 ? 'warn' : ''}>
            <span>เคสจริงอยู่ในช่วงที่ทำนาย</span>
            <strong>
              {t.inside} จาก {TEST_DAYS} วัน
            </strong>
            <small>ถ้าแม่นตามที่ตั้งไว้ ควรได้ราว {Math.round(TEST_DAYS * RANGE_SHARE)} วัน</small>
          </div>
          <div className={t.simpler != null && t.simpler < -0.05 ? 'warn' : ''}>
            <span>เทียบกับเดาว่าเท่าสัปดาห์ก่อน</span>
            <strong>
              {t.simpler == null
                ? '-'
                : t.simpler >= 0.05
                  ? `แม่นกว่า ${Math.round(100 * t.simpler)}%`
                  : t.simpler <= -0.05
                    ? `พลาดมากกว่า ${Math.round(-100 * t.simpler)}%`
                    : 'ใกล้เคียงกัน'}
            </strong>
            <small>วิธีเดาง่าย ๆ ที่ใช้เป็นเกณฑ์</small>
          </div>
        </div>
        {doubtful && (
          <p className="notice warning forecast-doubt">
            <Icon name="clock" />
            <span>ช่วงนี้จำนวนเคสเปลี่ยนไปจากเดิมมาก หรือมีวันที่ผิดปกติ ใช้ตัวเลขพยากรณ์เป็นแนวทางคร่าว ๆ และดูของจริงประกอบ</span>
          </p>
        )}
        <p className="tiny muted mt">
          คิดจากรูปแบบของแต่ละวันในสัปดาห์ ชั่วโมงที่ลูกค้าติดต่อ และแนวโน้มช่วง {Math.min(f.weeks, LEARN_WEEKS)} สัปดาห์ล่าสุด
          วันที่เคสสูงหรือต่ำผิดปกติเพียงไม่กี่วันจะไม่ดึงผลไปมาก · ช่วงที่ทำนายตั้งให้เคสจริงตกอยู่ในช่วงราว {Math.round(10 * RANGE_SHARE)} ใน 10 วัน ·
          ระบบไม่รู้ล่วงหน้าเรื่องวันหยุด แคมเปญ หรือระบบล่ม · นับวันและชั่วโมงตามเวลาเครื่องของคุณ
        </p>
      </div>
    </section>
  );
}

function Trend({ trend, weeks }: { trend: number | null; weeks: number }) {
  if (trend == null)
    return (
      <>
        <strong>ยังบอกไม่ได้</strong>
        <small>เคสยังไม่ถึงวันละ 1 เคส</small>
      </>
    );
  const steady = Math.abs(trend) < 5;
  return (
    <>
      <strong>{steady ? 'ทรงตัว' : `${trend > 0 ? 'เพิ่มขึ้น' : 'ลดลง'} ${Math.round(Math.abs(trend))}%`}</strong>
      <small>{steady ? `เปลี่ยนไม่ถึง 5% ต่อสัปดาห์ ช่วง ${weeks} สัปดาห์ล่าสุด` : `ต่อสัปดาห์ ช่วง ${weeks} สัปดาห์ล่าสุด`}</small>
    </>
  );
}

const W = 10;
const H = 100;

/* Two weeks back (the cases that came, over the range that was foretold for them; a day outside it in amber), today,
   and two weeks ahead (the range, with the likeliest number marked). */
function ForecastChart({ tested, ahead }: { tested: TestedDay[]; ahead: ForecastDay[] }) {
  const top = Math.max(1, ...tested.map((d) => Math.max(d.high, d.actual)), ...ahead.map((d) => d.high));
  const y = (value: number) => H - (value / top) * H;
  const band = (d: ForecastDay, x: number) => (
    <rect className="forecast-band" x={x + 1.5} width={W - 3} y={y(d.high)} height={Math.max(0.8, ((d.high - d.low) / top) * H)} />
  );
  const today = tested.length;
  return (
    <div className="forecast-chart">
      <svg
        viewBox={`0 0 ${(tested.length + 1 + ahead.length) * W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${TEST_DAYS} วันที่ผ่านมาเทียบกับที่ทำนายไว้ และช่วงที่คาดใน ${ahead.length} วันข้างหน้า รายละเอียดอยู่ในรายการรายวันด้านล่าง`}
      >
        {tested.map((d, i) => {
          const x = i * W;
          const miss = d.actual < d.low || d.actual > d.high;
          return (
            <g key={d.day.toDateString()}>
              <title>{`${dayName.format(d.day)} · เข้ามาจริง ${d.actual} เคส · ทำนายไว้ ${cases(d)} เคส`}</title>
              <rect className="forecast-hit" x={x} width={W} y={0} height={H} />
              {band(d, x)}
              {d.actual > 0 && <rect className={`forecast-actual${miss ? ' miss' : ''}`} x={x + 3} width={W - 6} y={y(d.actual)} height={H - y(d.actual)} />}
            </g>
          );
        })}
        <line className="forecast-today" x1={today * W + W / 2} x2={today * W + W / 2} y1={0} y2={H} vectorEffect="non-scaling-stroke" />
        {ahead.map((d, i) => {
          const x = (today + 1 + i) * W;
          return (
            <g key={d.day.toDateString()}>
              <title>{`${dayName.format(d.day)} · คาดว่า ${cases(d)} เคส`}</title>
              <rect className="forecast-hit" x={x} width={W} y={0} height={H} />
              {band(d, x)}
              <rect className="forecast-mark" x={x + 1.5} width={W - 3} y={y(d.expected) - 0.8} height={1.6} />
            </g>
          );
        })}
      </svg>
      <div className="forecast-axis" aria-hidden="true">
        {tested.map((d) => (
          <span key={d.day.toDateString()}>{d.day.getDate()}</span>
        ))}
        <span className="today">วันนี้</span>
        {ahead.map((d) => (
          <span key={d.day.toDateString()}>{d.day.getDate()}</span>
        ))}
      </div>
      <div className="forecast-parts" aria-hidden="true">
        <span>{TEST_DAYS} วันที่ผ่านมา: เคสจริงเทียบกับที่ทำนายไว้</span>
        <span />
        <span>{ahead.length} วันข้างหน้า</span>
      </div>
      <div className="forecast-legend">
        <span className="actual">เคสที่เข้ามาจริง</span>
        <span className="miss">เคสจริงที่อยู่นอกช่วง</span>
        <span className="band">ช่วงที่ทำนาย</span>
        <span className="mark">ตัวเลขที่น่าจะเป็นที่สุด</span>
      </div>
    </div>
  );
}
