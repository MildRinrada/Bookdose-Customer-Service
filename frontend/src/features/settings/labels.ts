/* The settings screen's sections (the old settingsTabs), in menu order. */

export const settingsTabs = {
  overview: { label: 'ภาพรวมและบริการ', hint: 'ข้อมูลองค์กร มาตรฐาน SLA และข้อความอัตโนมัติ', icon: 'settings' },
  teams: { label: 'ทีมและสมาชิก', hint: 'ย้ายไปเป็นหน้าของตัวเองแล้ว', icon: 'users' },
  invites: { label: 'ลิงก์และ QR สำหรับลูกค้า', hint: 'ให้ลูกค้าสแกนเพื่อเพิ่มองค์กรนี้', icon: 'link' },
  webchat: { label: 'แชทบนเว็บไซต์', hint: 'แชทโดยไม่ต้องเข้าสู่ระบบ และปุ่มแชทบนเว็บองค์กร', icon: 'chat' },
  issues: { label: 'ประกาศปัญหาถึงลูกค้า', hint: 'แจ้งบนหน้าแชทเมื่อระบบมีปัญหา ลดการถามเรื่องเดิมซ้ำ', icon: 'bell' },
  connections: { label: 'LINE / อีเมล / Facebook / Instagram', hint: 'ช่องทางที่ลูกค้าติดต่อเข้ามา', icon: 'inbox' },
  ai: { label: 'AI Assistant', hint: 'ผู้ช่วยร่างคำตอบและแชทบอทหน้าลูกค้า', icon: 'sparkle' },
} as const;

export type SettingsTab = keyof typeof settingsTabs;

/** The sections too full of fields to share one page: their parts, chosen by an icon (?tab=<part>). */
export const settingsParts = {
  profile: { tab: 'overview', label: 'ข้อมูลองค์กร', hint: 'ชื่อ โลโก้ รหัสองค์กร และลิงก์หน้าลูกค้า', icon: 'globe' },
  service: { tab: 'overview', label: 'มาตรฐานบริการ', hint: 'เวลาตอบกลับ (SLA) ข้อความต้อนรับ และคำตอบสำเร็จรูป', icon: 'clock' },
  categories: { tab: 'overview', label: 'หมวดเรื่อง', hint: 'หมวดที่ลูกค้าเลือกตอนเริ่มแชท และทีมที่ดูแล', icon: 'list' },
  fields: { tab: 'overview', label: 'ช่องข้อมูลของเคส', hint: 'ช่องที่ทีมกรอกในเคส เช่น เลขคำสั่งซื้อ หรือสาขา', icon: 'file' },
  backup: { tab: 'overview', label: 'ข้อมูลและการสำรอง', hint: 'ไฟล์สำรอง ถังขยะ และระยะเวลาเก็บข้อมูล', icon: 'shield' },
  security: { tab: 'overview', label: 'ความปลอดภัยของทีม', hint: 'บังคับเจ้าหน้าที่ยืนยันตัวตน 2 ขั้น', icon: 'lock' },
  line: { tab: 'connections', label: 'LINE', hint: 'LINE Official Account ขององค์กร', icon: 'chat' },
  email: { tab: 'connections', label: 'อีเมล', hint: 'รับและตอบอีเมลของลูกค้าในกล่องข้อความ', icon: 'mail' },
  facebook: { tab: 'connections', label: 'Facebook และ Instagram', hint: 'ข้อความจากเพจ Facebook และ DM Instagram ที่ผูกกับเพจ', icon: 'facebook' },
} as const satisfies Record<string, { tab: SettingsTab; label: string; hint: string; icon: string }>;

export type SettingsPart = keyof typeof settingsParts;

const has = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

export const isSettingsTab = (value: string | null | undefined): value is SettingsTab => typeof value === 'string' && has(settingsTabs, value);

/** Where an address (?tab=) points: a section, and the part of it when it has parts; null when it names nothing. */
export function settingsPlaceOf(value: string | null | undefined): { tab: SettingsTab; part: SettingsPart | null } | null {
  if (isSettingsTab(value)) return { tab: value, part: null };
  if (typeof value === 'string' && has(settingsParts, value)) return { tab: settingsParts[value as SettingsPart].tab, part: value as SettingsPart };
  return null;
}

export const partsOf = (tab: SettingsTab) => (Object.keys(settingsParts) as SettingsPart[]).filter((key) => settingsParts[key].tab === tab);

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
