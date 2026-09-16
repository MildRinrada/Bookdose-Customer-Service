/* The sections of ตั้งค่าบัญชี (/customer/account?tab=), in menu order. */

export const accountTabs = {
  profile: { label: 'ข้อมูลส่วนตัว', hint: 'ชื่อ เบอร์ติดต่อ ความเป็นส่วนตัว และออกจากระบบ', icon: 'at' },
  security: { label: 'ความปลอดภัย', hint: 'รหัสผ่าน การยืนยันสองขั้นตอน และอุปกรณ์ที่เข้าสู่ระบบ', icon: 'shield' },
  organizations: { label: 'องค์กรที่ติดต่อได้', hint: 'องค์กรที่ติดต่อได้ และการเพิ่มองค์กรใหม่', icon: 'users' },
  notifications: { label: 'การแจ้งเตือน', hint: 'อีเมลและ LINE', icon: 'bell' },
} as const;

export type AccountTab = keyof typeof accountTabs;

export const isAccountTab = (value: string | null | undefined): value is AccountTab =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(accountTabs, value);

export const accountTabPath = (tab: AccountTab) => `/customer/account?tab=${tab}`;
