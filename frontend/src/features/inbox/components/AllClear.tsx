import type { ReactNode } from 'react';

/* กล่องว่าง: what the inbox shows once nobody is waiting for the team, instead of a blank list - a cup that is still
   warm and a line that says take a breather. Also the overview's แชทรอตอบ when it is empty (`compact`). The steam
   rises slowly; with reduced motion it stays still. Markup: pages/team-spirit (all-clear). */

const LINES: Array<[string, string]> = [
  ['เคลียร์หมดแล้ว', 'ไปพักดื่มน้ำสักแก้วได้เลย'],
  ['ไม่มีใครรอคำตอบ', 'ยืดเส้นยืดสายสักหน่อยไหม'],
  ['กล่องว่างเอี่ยม', 'เก่งมาก พักสายตาสักครู่นะ'],
  ['ตอบครบทุกคนแล้ว', 'ลูกค้าได้คำตอบครบ ได้เวลาจิบกาแฟ'],
];

/** `seed` picks the line (the same one while nothing changes, another after the next chat is answered). */
export function AllClear({ seed = 0, compact = false, children }: { seed?: number; compact?: boolean; children?: ReactNode }) {
  const [title, line] = LINES[Math.abs(seed) % LINES.length];
  return (
    <div className={`all-clear${compact ? ' compact' : ''}`} role="status">
      <svg className="all-clear-art" viewBox="0 0 120 100" aria-hidden="true">
        <path className="all-clear-steam" d="M46 30c-4-5 4-9 0-15 M58 30c-4-5 4-9 0-15 M70 30c-4-5 4-9 0-15" />
        <path className="all-clear-cup" d="M32 40h52v24a20 20 0 0 1-20 20H52a20 20 0 0 1-20-20z M84 47h5a10 10 0 0 1 0 20h-6 M22 90h76" />
        <path className="all-clear-spark" d="M16 22v8 M12 26h8 M104 14v6 M101 17h6 M110 30v6 M107 33h6" />
      </svg>
      <strong>{title}</strong>
      <span>{line}</span>
      {children}
    </div>
  );
}
