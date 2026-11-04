import type { Article, ArticleSort } from './types';

export const visibilityLabels: Record<string, string> = { public: 'เผยแพร่ให้ลูกค้า', internal: 'ภายในองค์กร' };

export const articleSorts: Record<ArticleSort, string> = { updated: 'อัปเดตล่าสุด', used: 'ใช้บ่อยที่สุด', title: 'ชื่อ ก-ฮ', category: 'ตามหมวดหมู่' };

/** The editor footer: "12 คำ · 1,234/50,000 ตัวอักษร". */
export function wordCountText(value: string): string {
  const text = value.trim();
  const words = text ? text.split(/\s+/).length : 0;
  return `${words} คำ ${value.length.toLocaleString('th-TH')}/50,000 ตัวอักษร`;
}

/** An article nobody has touched for this long may no longer match how things work. */
export const STALE_DAYS = 180;
const DAY = 86_400_000;

/** "ช่วยได้ 90%" once a customer marked it; null before. */
export function helpfulRate(a: Article): number | null {
  const votes = (a.helpful ?? 0) + (a.unhelpful ?? 0);
  return votes ? Math.round(((a.helpful ?? 0) / votes) * 100) : null;
}

/** Why an article should be looked over, or null: not updated for STALE_DAYS, or customers said it did not help more
    often than it did (at least twice). */
export function reviewReason(a: Article, now = Date.now()): string | null {
  const days = Math.floor((now - new Date(a.updated_at).getTime()) / DAY);
  const unhelpful = a.unhelpful ?? 0;
  if (unhelpful >= 2 && unhelpful > (a.helpful ?? 0)) return `ลูกค้าบอกว่าไม่ช่วย ${unhelpful} ครั้ง`;
  if (days >= STALE_DAYS) return `ไม่ได้อัปเดต ${Math.floor(days / 30)} เดือน`;
  return null;
}

/** Why the AI's rewriting of a draft is not offered (ai_jobs.error; knowledge/importer.py). */
export const rewriteErrors: Record<string, string> = {
  changed_facts: 'ฉบับที่ AI เรียบเรียงมีตัวเลข ลิงก์ หรืออีเมลไม่ตรงกับต้นฉบับ ระบบจึงไม่ใช้',
  invalid_output: 'AI ตอบกลับมาไม่ครบ',
  timeout: 'AI ตอบช้าเกินเวลา',
  quota: 'ใช้ AI ครบจำนวนของวันนี้แล้ว',
  stale: 'การตั้งค่า AI เปลี่ยนระหว่างรอ',
};
