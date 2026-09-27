/* The sections of a staff account's ตั้งค่าบัญชี (/account?tab=), in menu order: the same frame as a customer's
   (features/customer/settings/tabs.ts). */

export const staffAccountTabs = {
  profile: { label: 'ข้อมูลส่วนตัว', hint: 'รูป ชื่อ ลายเซ็น และชื่อที่ลูกค้าเห็น', icon: 'at' },
  status: { label: 'สถานะการทำงาน', hint: 'พร้อมรับเรื่อง พัก เวลาทำงาน และวันลา', icon: 'clock' },
  notifications: { label: 'การแจ้งเตือน', hint: 'บนหน้าจอ เสียง อีเมล และเหตุการณ์ที่ต้องการ', icon: 'bell' },
  replies: { label: 'คำตอบด่วนและคีย์ลัด', hint: 'ข้อความที่ใช้บ่อย พิมพ์ / เพื่อแทรก', icon: 'bolt' },
  achievements: { label: 'ผลงานของฉัน', hint: 'สรุปผลงานประจำเดือนและเหรียญความสำเร็จ เห็นเฉพาะคุณ', icon: 'award' },
  security: { label: 'ความปลอดภัย', hint: 'รหัสผ่าน การยืนยันสองขั้นตอน และอุปกรณ์ที่เข้าสู่ระบบ', icon: 'shield' },
  organizations: { label: 'องค์กรของฉัน', hint: 'องค์กรที่คุณเป็นทีมงาน บทบาท และการสลับองค์กร', icon: 'users' },
} as const;

export type StaffAccountTab = keyof typeof staffAccountTabs;

/** A platform admin takes no cases and answers no customers: these sections are only for the organizations' staff. */
export const platformHiddenTabs: StaffAccountTab[] = ['status', 'notifications', 'replies', 'achievements'];

export const isStaffAccountTab = (value: string | null | undefined): value is StaffAccountTab =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(staffAccountTabs, value);

export const staffAccountTabPath = (tab: StaffAccountTab) => `/account?tab=${tab}`;
