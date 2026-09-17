import type { GlobalArticleState, GlobalAudience, SystemWorker } from './types';

/* The platform console's own words (system.js and global-faq.js). */

export const workerLabels: Record<string, string> = {
  ai: 'AI ร่างคำตอบและ Chatbot',
  channels: 'ส่งข้อความ LINE / Facebook / Email',
  email: 'รับอีเมลเข้า',
  automation: 'ระบบอัตโนมัติและอีเมลแจ้งลูกค้า',
};

export const apiAreaLabels: Record<string, string> = {
  staff: 'หน้าทีมงานองค์กร',
  customer: 'หน้าลูกค้าปลายทาง',
  platform: 'คอนโซลระบบกลาง',
  webhook: 'Webhook จาก LINE / Facebook',
};

export const logSourceLabels: Record<string, string> = {
  server: 'เซิร์ฟเวอร์',
  ai: 'งาน AI',
  channels: 'ส่งข้อความ',
  email: 'รับอีเมล',
  automation: 'ระบบอัตโนมัติ',
};

export const audienceLabels: Record<GlobalAudience, string> = {
  platform: 'เฉพาะผู้ดูแลระบบกลาง',
  staff: 'แอดมินและทีมงานองค์กร',
  customer: 'ลูกค้าปลายทาง',
};

export const audienceHints: Record<GlobalAudience, string> = {
  platform: 'เห็นเฉพาะในคอนโซลระบบกลาง',
  staff: 'แสดงในเมนู “คู่มือจาก Bookdose” ของทุกองค์กร',
  customer: 'แสดงใน “คำถามที่พบบ่อย” ของลูกค้าทุกองค์กร',
};

export const audiences = Object.keys(audienceLabels) as GlobalAudience[];

export const articleStateLabels: Record<GlobalArticleState, string> = {
  draft: 'ร่าง',
  published: 'เผยแพร่แล้ว',
  changed: 'มีแก้ไขรอเผยแพร่',
};

export const articleStateHints: Record<GlobalArticleState, string> = {
  draft: 'ยังไม่มีใครเห็นบทความนี้ ตรวจให้เรียบร้อยแล้วกด “เผยแพร่”',
  published: 'ผู้อ่านเห็นบทความนี้อยู่ การแก้ไขครั้งต่อไปจะเก็บเป็นร่างจนกว่าจะเผยแพร่',
  changed: 'ผู้อ่านยังเห็นฉบับเดิม การแก้ไขจะขึ้นให้ทุกองค์กรเห็นเมื่อกด “เผยแพร่การแก้ไข”',
};

export const articleStates = Object.keys(articleStateLabels) as GlobalArticleState[];

/** "1.5 GB" */
export function bytesText(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = value;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toLocaleString('th-TH', { maximumFractionDigits: n < 10 && i ? 1 : 0 })} ${units[i]}`;
}

/** "2 วัน 3 ชม.", "3 ชม. 5 นาที", "5 นาที" or "40 วินาที". */
export function durationText(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d ? `${d} วัน ${h} ชม.` : h ? `${h} ชม. ${m} นาที` : m ? `${m} นาที` : `${seconds} วินาที`;
}

export function workerStatus(w: SystemWorker): string {
  if (w.seconds_ago === null) return 'ยังไม่เริ่มทำงาน';
  return w.running ? `ทำงานอยู่ · เริ่มรอบล่าสุด ${durationText(w.seconds_ago)}ที่แล้ว` : `ไม่ตอบสนองมา ${durationText(w.seconds_ago)}`;
}
