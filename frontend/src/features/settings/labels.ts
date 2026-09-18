/* The settings screen's sections (the old settingsTabs), in menu order. */

export const settingsTabs = {
  overview: { label: 'ภาพรวมและบริการ', hint: 'ข้อมูลองค์กร มาตรฐาน SLA และข้อความอัตโนมัติ', icon: 'settings' },
  teams: { label: 'ทีมและสมาชิก', hint: 'ใครอยู่ทีมไหน และมีสิทธิ์แค่ไหน', icon: 'users' },
  invites: { label: 'ลิงก์และ QR สำหรับลูกค้า', hint: 'ให้ลูกค้าสแกนเพื่อเพิ่มองค์กรนี้', icon: 'link' },
  webchat: { label: 'แชทบนเว็บไซต์', hint: 'แชทโดยไม่ต้องเข้าสู่ระบบ และปุ่มแชทบนเว็บองค์กร', icon: 'chat' },
  connections: { label: 'LINE / Email / Facebook', hint: 'ช่องทางที่ลูกค้าติดต่อเข้ามา', icon: 'inbox' },
  ai: { label: 'AI Assistant', hint: 'ผู้ช่วยร่างคำตอบและแชทบอทหน้าลูกค้า', icon: 'sparkle' },
} as const;

export type SettingsTab = keyof typeof settingsTabs;

export const isSettingsTab = (value: string | null | undefined): value is SettingsTab =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(settingsTabs, value);

/** Badge words for a member's access (the old badge('active'|'suspended')). */
export const memberStatusLabels: Record<string, string> = { active: 'เปิดใช้งาน', suspended: 'ระงับใช้งาน' };

/** Support access: the lengths that may be asked for and approved, and where a request stands. */
export const supportHours = [1, 4, 8, 24, 72];

export const supportStatusLabels: Record<string, string> = {
  pending: 'รออนุมัติ',
  approved: 'อนุมัติแล้ว',
  denied: 'ปฏิเสธ',
  cancelled: 'ผู้ขอยกเลิก',
  ended: 'หยุดก่อนเวลา',
  expired: 'หมดเวลา',
};

/** Where a staff invitation stands (backend invitations.schema.state_of). */
export const inviteStateLabels: Record<string, string> = {
  pending: 'รอตอบรับ',
  accepted: 'เข้าร่วมแล้ว',
  cancelled: 'ยกเลิกแล้ว',
  expired: 'หมดอายุ',
};
