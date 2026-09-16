/* The settings screen's sections (the old settingsTabs), in menu order. */

export const settingsTabs = {
  overview: { label: 'ภาพรวมและบริการ', hint: 'ข้อมูลองค์กร มาตรฐาน SLA และข้อความอัตโนมัติ', icon: 'settings' },
  teams: { label: 'ทีมและสมาชิก', hint: 'ใครอยู่ทีมไหน และมีสิทธิ์แค่ไหน', icon: 'users' },
  invites: { label: 'ลิงก์และ QR สำหรับลูกค้า', hint: 'ให้ลูกค้าสแกนเพื่อเพิ่มองค์กรนี้', icon: 'link' },
  connections: { label: 'LINE / Email / Facebook', hint: 'ช่องทางที่ลูกค้าติดต่อเข้ามา', icon: 'inbox' },
  ai: { label: 'AI Assistant', hint: 'ผู้ช่วยร่างคำตอบและแชทบอทหน้าลูกค้า', icon: 'sparkle' },
} as const;

export type SettingsTab = keyof typeof settingsTabs;

export const isSettingsTab = (value: string | null | undefined): value is SettingsTab =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(settingsTabs, value);

/** Badge words for a member's access (the old badge('active'|'suspended')). */
export const memberStatusLabels: Record<string, string> = { active: 'เปิดใช้งาน', suspended: 'ระงับใช้งาน' };
