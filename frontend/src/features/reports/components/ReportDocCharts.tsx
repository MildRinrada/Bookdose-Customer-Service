/* The printed report's charts (ReportDocument): plain figures for paper, in black and greys only, each with a
   numbered caption under it as a formal document has. One measure per chart and one axis; a goal is a dashed line
   with its value written beside it; a period with nothing to measure is a gap, never a zero. Inline SVG with its
   colours as attributes (the Content-Security-Policy refuses style attributes). Markup: pages/reports
   (report-doc-figure). */

const W = 640;
const FONT = 'Sarabun, sans-serif';
const INK = '#000';
const GREY = '#6b6b6b';
const GRID = '#cfcfcf';
const LEFT = 44;
const RIGHT = 14;
const TOP = 14;
const BOTTOM = 30;

/** The smallest round number at or above `value` (1, 2, 2.5, 5 times a power of ten). */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= value) return step * power;
  return 10 * power;
}

const tickText = (value: number) => (Number.isInteger(value) ? value.toLocaleString('th-TH') : value.toFixed(1));

/** The value axis: three light lines (0, half, top) with their numbers, and the baseline in black. */
function Grid({ top, height, max, unit }: { top: number; height: number; max: number; unit?: string }) {
  return (
    <g>
      {[0, 0.5, 1].map((part) => {
        const y = top + height - part * height;
        return (
          <g key={part}>
            <line x1={LEFT} x2={W - RIGHT} y1={y} y2={y} stroke={part === 0 ? INK : GRID} strokeWidth={part === 0 ? 1 : 0.7} />
            <text x={LEFT - 6} y={y + 3.5} fontSize={10} fontFamily={FONT} fill={INK} textAnchor="end">
              {tickText(part * max)}
            </text>
          </g>
        );
      })}
      {unit && (
        <text x={LEFT - 6} y={top - 4} fontSize={9.5} fontFamily={FONT} fill={GREY} textAnchor="end">
          {unit}
        </text>
      )}
    </g>
  );
}

/** Labels under the axis, thinned so they never run into each other. */
function XLabels({ labels, x, y }: { labels: string[]; x: (i: number) => number; y: number }) {
  const step = Math.max(1, Math.ceil(labels.length / 12));
  return (
    <g>
      {labels.map((label, i) =>
        i % step === 0 || i === labels.length - 1 ? (
          <text key={i} x={x(i)} y={y} fontSize={10} fontFamily={FONT} fill={INK} textAnchor="middle">
            {label}
          </text>
        ) : null,
      )}
    </g>
  );
}

export type Point = { label: string; value: number | null };

/** Counts over time as columns (a day or a period each), the busiest one's value written above it. */
export function ColumnChart({ points, unit, caption }: { points: Point[]; unit: string; caption: string }) {
  const height = 150;
  const plot = height;
  const max = niceMax(Math.max(0, ...points.map((p) => p.value ?? 0)));
  const slot = (W - LEFT - RIGHT) / Math.max(1, points.length);
  const bar = Math.max(2, Math.min(28, slot - 2));
  const x = (i: number) => LEFT + slot * i + slot / 2;
  const peak = points.reduce((best, p, i) => ((p.value ?? 0) > (points[best]?.value ?? 0) ? i : best), 0);
  return (
    <figure className="report-doc-figure">
      <svg viewBox={`0 0 ${W} ${TOP + plot + BOTTOM}`} role="img" aria-label={caption}>
        <Grid top={TOP} height={plot} max={max} unit={unit} />
        {points.map((p, i) => {
          const h = ((p.value ?? 0) / max) * plot;
          return h > 0 ? <rect key={i} x={x(i) - bar / 2} y={TOP + plot - h} width={bar} height={h} fill={GREY} /> : null;
        })}
        {(points[peak]?.value ?? 0) > 0 && (
          <text x={x(peak)} y={TOP + plot - ((points[peak].value as number) / max) * plot - 4} fontSize={10} fontFamily={FONT} fill={INK} textAnchor="middle">
            {tickText(points[peak].value as number)}
          </text>
        )}
        <XLabels labels={points.map((p) => p.label)} x={x} y={TOP + plot + 16} />
      </svg>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

/** One measure over the periods as a line with a dot per period (a gap where there is nothing to measure), each value
    written above its dot, and the goal as a dashed line. */
export function LineChart({
  points,
  max,
  unit,
  goal,
  goalText,
  caption,
}: {
  points: Point[];
  max: number;
  unit: string;
  goal?: number;
  goalText?: string;
  caption: string;
}) {
  const plot = 140;
  const top = TOP + 6;
  const slot = (W - LEFT - RIGHT) / Math.max(1, points.length);
  const x = (i: number) => LEFT + slot * i + slot / 2;
  const y = (value: number) => top + plot - (Math.min(value, max) / max) * plot;
  // Runs of periods that have a value, drawn as separate lines.
  const runs: Array<Array<{ i: number; value: number }>> = [];
  points.forEach((p, i) => {
    if (p.value == null) return;
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1].i === i - 1) last.push({ i, value: p.value });
    else runs.push([{ i, value: p.value }]);
  });
  return (
    <figure className="report-doc-figure">
      <svg viewBox={`0 0 ${W} ${top + plot + BOTTOM}`} role="img" aria-label={caption}>
        <Grid top={top} height={plot} max={max} unit={unit} />
        {goal != null && (
          <g>
            <line x1={LEFT} x2={W - RIGHT} y1={y(goal)} y2={y(goal)} stroke={INK} strokeWidth={1} strokeDasharray="5 4" />
            <text x={W - RIGHT} y={y(goal) - 4} fontSize={10} fontFamily={FONT} fill={INK} textAnchor="end">
              {goalText}
            </text>
          </g>
        )}
        {runs.map((run, r) => (
          <polyline key={r} points={run.map((p) => `${x(p.i)},${y(p.value)}`).join(' ')} fill="none" stroke={INK} strokeWidth={2} />
        ))}
        {points.map((p, i) =>
          p.value == null ? null : (
            <g key={i}>
              <circle cx={x(i)} cy={y(p.value)} r={4} fill="#fff" stroke={INK} strokeWidth={2} />
              <text x={x(i)} y={y(p.value) - 8} fontSize={10} fontFamily={FONT} fill={INK} textAnchor="middle">
                {tickText(Math.round(p.value * 10) / 10)}
              </text>
            </g>
          ),
        )}
        <XLabels labels={points.map((p) => p.label)} x={x} y={top + plot + 16} />
      </svg>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

/** Groups side by side as horizontal bars, largest first as given, each with its count and share at the end. */
export function BarList({ rows, caption }: { rows: Array<{ label: string; n: number; share: number }>; caption: string }) {
  const line = 24;
  const labelWidth = 170;
  const valueWidth = 140;
  const most = Math.max(1, ...rows.map((r) => r.n));
  const room = W - labelWidth - valueWidth;
  const height = rows.length * line + 8;
  return (
    <figure className="report-doc-figure">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={caption}>
        {rows.map((r, i) => {
          const y = 4 + i * line;
          return (
            <g key={r.label}>
              <text x={labelWidth - 10} y={y + 15} fontSize={11} fontFamily={FONT} fill={INK} textAnchor="end">
                {r.label}
              </text>
              <rect x={labelWidth} y={y + 5} width={Math.max(2, (r.n / most) * room)} height={13} fill={GREY} />
              <text x={labelWidth + Math.max(2, (r.n / most) * room) + 8} y={y + 15} fontSize={11} fontFamily={FONT} fill={INK}>
                {`${r.n.toLocaleString('th-TH')} เคส (ร้อยละ ${r.share.toFixed(1)})`}
              </text>
            </g>
          );
        })}
        <line x1={labelWidth} x2={labelWidth} y1={2} y2={height - 2} stroke={INK} strokeWidth={1} />
      </svg>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
