import type { ArticleSort } from './types';

export const visibilityLabels: Record<string, string> = { public: 'เผยแพร่ให้ลูกค้า', internal: 'ภายในองค์กร' };

export const articleSorts: Record<ArticleSort, string> = { updated: 'อัปเดตล่าสุด', title: 'ชื่อ ก-ฮ', category: 'ตามหมวดหมู่' };

/** The editor footer: "12 คำ · 1,234/50,000 ตัวอักษร". */
export function wordCountText(value: string): string {
  const text = value.trim();
  const words = text ? text.split(/\s+/).length : 0;
  return `${words} คำ · ${value.length.toLocaleString('th-TH')}/50,000 ตัวอักษร`;
}
