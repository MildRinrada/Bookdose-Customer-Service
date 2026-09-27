import type { Recap } from './api';
import { monthHeading, recapFacts, TITLE_EMOJI } from './recap';

/* บันทึกเป็นรูปภาพ: the month's card drawn on a canvas in the browser and saved as a PNG the member can send anywhere
   (LINE, a chat with friends). Nothing goes to the server and nothing is shared by the system itself. 1080 by 1350,
   the shape a phone shows whole. The same facts as the page (recap.ts), in the card's own colours whatever the theme,
   in the typeface the member reads in. */

const W = 1080;
const H = 1350;
const INK = '#1f2326';
const PANEL = '#2c3237';
const WHITE = '#ffffff';
const SOFT = '#dfe4e2';
const MUTED = '#aab4b1';
const GOLD = '#f5b942';
const PAPER = '#f4efe6';
const DOTS = ['#e5484d', '#f5b942', '#2f9e6b', '#3b82f6', '#ffffff'];

type Ctx = CanvasRenderingContext2D;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function rounded(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, color: string) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = color;
  ctx.fill();
}

/** Lines of `text` no wider than `width` (Thai has no spaces between words: it is cut at word boundaries). */
function wrap(ctx: Ctx, text: string, width: number, most: number): string[] {
  const words =
    typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? [...new Intl.Segmenter('th', { granularity: 'word' }).segment(text)].map((s) => s.segment)
      : [...text];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (ctx.measureText(line + word).width <= width || !line) line += word;
    else {
      lines.push(line.trim());
      line = word.trimStart();
    }
  }
  if (line.trim()) lines.push(line.trim());
  if (lines.length <= most) return lines;
  const kept = lines.slice(0, most);
  let last = kept[most - 1];
  while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
  kept[most - 1] = `${last}…`;
  return kept;
}

export async function saveRecapImage(recap: Recap, organization: string) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('เบราว์เซอร์นี้สร้างรูปภาพไม่ได้');
  const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
  await Promise.all(['400 32px', '700 64px'].map((weight) => document.fonts?.load(`${weight} ${family}`).catch(() => undefined)));
  const logo = await loadImage('/logo.png').catch(() => null);
  const font = (size: number, weight = 400) => `${weight} ${size}px ${family}`;
  const text = (value: string, x: number, y: number, size: number, color: string, weight = 400, align: CanvasTextAlign = 'left') => {
    ctx.font = font(size, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(value, x, y);
  };

  // The paper, the card, and a little confetti in its corners.
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  rounded(ctx, 40, 40, W - 80, H - 80, 48, INK);
  [
    [120, 96, 7],
    [180, 70, 5],
    [900, 90, 8],
    [960, 150, 5],
    [860, 60, 4],
    [990, 1200, 7],
    [930, 1260, 5],
    [110, 1255, 5],
  ].forEach(([x, y, r], i) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = DOTS[i % DOTS.length];
    ctx.fill();
  });

  // Who and when.
  text(organization, 100, 160, 30, MUTED);
  text(monthHeading(recap), 100, 212, 38, GOLD, 700);
  ctx.font = font(76, 700);
  text(wrap(ctx, recap.name, 880, 1)[0], 100, 300, 76, WHITE, 700);

  // The title of the month.
  rounded(ctx, 100, 340, 880, 230, 32, PANEL);
  text(TITLE_EMOJI[recap.title.key] ?? '✨', 170, 490, 104, WHITE, 400, 'center');
  text('ฉายาประจำเดือน', 270, 405, 28, MUTED);
  ctx.font = font(64, 700);
  text(wrap(ctx, recap.title.name, 680, 1)[0], 270, 478, 64, GOLD, 700);
  ctx.font = font(30);
  wrap(ctx, recap.title.reason, 680, 2).forEach((line, i) => text(line, 270, 526 + i * 38, 30, SOFT));

  // Six figures, two by three.
  recapFacts(recap).forEach((fact, i) => {
    const x = 100 + (i % 2) * 450;
    const y = 610 + Math.floor(i / 2) * 170;
    rounded(ctx, x, y, 430, 150, 26, PANEL);
    text(fact.label, x + 30, y + 44, 28, MUTED);
    ctx.font = font(60, 700);
    text(wrap(ctx, fact.value, 370, 1)[0], x + 30, y + 106, 60, WHITE, 700);
    ctx.font = font(24);
    text(wrap(ctx, fact.sub, 370, 1)[0], x + 30, y + 138, 24, MUTED);
  });

  // A customer's words, or the badges of the month.
  const quote = recap.praise.texts[0];
  if (quote) {
    ctx.font = font(30);
    const lines = wrap(ctx, `“${quote}”`, 880, 2);
    lines.forEach((line, i) => text(line, 100, 1146 + i * 40, 30, WHITE));
    text(`คำชมจากลูกค้า${recap.praise.count > 1 ? ` (ทั้งเดือน ${recap.praise.count} ครั้ง)` : ''}`, 100, 1146 + lines.length * 40 + 4, 24, MUTED);
  } else if (recap.badges.length) {
    text('เหรียญที่ได้เดือนนี้', 100, 1146, 26, MUTED);
    ctx.font = font(32, 700);
    text(wrap(ctx, recap.badges.map((b) => b.name).join(', '), 880, 1)[0], 100, 1192, 32, GOLD, 700);
  }

  // The system's mark at the foot.
  if (logo) {
    rounded(ctx, 100, 1228, 60, 60, 14, WHITE);
    ctx.drawImage(logo, 104, 1232, 52, 52);
  }
  text('bookdose customer service', logo ? 176 : 100, 1268, 26, MUTED);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('สร้างรูปภาพไม่สำเร็จ ลองใหม่อีกครั้ง');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `สรุปผลงาน-${recap.month}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
