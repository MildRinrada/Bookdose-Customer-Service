/* The sections of a staff account's ตั้งค่าบัญชี (/account?tab=), in menu order: the same frame as a customer's
   (features/customer/settings/tabs.ts). */

export const staffAccountTabs = {
  profile: { label: 'ข้อมูลส่วนตัว', hint: 'รูป ชื่อที่ทีมเห็น และออกจากระบบ', icon: 'at' },
  security: { label: 'ความปลอดภัย', hint: 'รหัสผ่าน การยืนยันสองขั้นตอน และอุปกรณ์ที่เข้าสู่ระบบ', icon: 'shield' },
  organizations: { label: 'องค์กรของฉัน', hint: 'องค์กรที่คุณเป็นทีมงาน บทบาท และการสลับองค์กร', icon: 'users' },
} as const;

export type StaffAccountTab = keyof typeof staffAccountTabs;

export const isStaffAccountTab = (value: string | null | undefined): value is StaffAccountTab =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(staffAccountTabs, value);

export const staffAccountTabPath = (tab: StaffAccountTab) => `/account?tab=${tab}`;
