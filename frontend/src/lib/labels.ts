/* Thai words for the values the API sends, shared by every screen. A feature's own words live in its feature folder. */

export const statusLabels: Record<string, string> = {
  new: 'ใหม่',
  open: 'กำลังดำเนินการ',
  pending_customer: 'รอลูกค้า',
  pending_internal: 'รอทีมภายใน',
  resolved: 'แก้ไขแล้ว',
  closed: 'ปิดเคสแล้ว',
};

export const priorityLabels: Record<string, string> = { low: 'ต่ำ', normal: 'ปกติ', high: 'สูง', urgent: 'เร่งด่วน' };

export const roleLabels: Record<string, string> = { admin: 'ผู้ดูแลองค์กร', manager: 'หัวหน้าทีม', agent: 'เจ้าหน้าที่' };

export const tenantStatusLabels: Record<string, string> = { active: 'เปิดใช้งาน', suspended: 'ระงับใช้งาน' };

export const channelNames: Record<string, string> = {
  web: 'แชทบนเว็บ',
  line: 'LINE',
  email: 'Email',
  facebook: 'Facebook',
  manual: 'บันทึกเอง',
};

export const channelIcons: Record<string, string> = { web: 'globe', line: 'chat', email: 'mail', facebook: 'facebook', manual: 'file' };

export const escalationReasons: Record<string, string> = {
  unclaimed: 'ไม่มีผู้รับเรื่องทันเวลา',
  sla_risk: 'ใกล้ครบเวลาตอบกลับครั้งแรก',
};

export const eventLabels: Record<string, string> = {
  'organization.created': 'สร้างองค์กร',
  'ticket.created': 'เปิดเคสใหม่',
  'ticket.updated': 'อัปเดตเคส',
  'message.reply': 'ตอบกลับลูกค้า',
  'message.note': 'เพิ่มบันทึกภายใน',
  'conversation.created': 'รับเรื่องใหม่ผ่านเว็บ',
  'conversation.linked': 'เชื่อมบทสนทนากับเคส',
  'conversation.closed': 'ปิดบทสนทนา',
  'conversation.open': 'เปิดบทสนทนาอีกครั้ง',
  'contact.created': 'เพิ่มลูกค้า',
  'contact.updated': 'แก้ไขข้อมูลลูกค้า',
  'contact.merged': 'รวมข้อมูลลูกค้าที่ซ้ำ',
  'article.saved': 'บันทึกบทความ',
  'article.deleted': 'ลบบทความ',
  'ticket.deleted': 'ลบเคส',
  'contact.deleted': 'ลบข้อมูลลูกค้า',
  'ticket.restored': 'กู้คืนเคสจากถังขยะ',
  'contact.restored': 'กู้คืนข้อมูลลูกค้า',
  'article.restored': 'กู้คืนบทความ',
  'ticket.purged': 'ลบเคสถาวร',
  'contact.purged': 'ลบข้อมูลลูกค้าถาวร',
  'article.purged': 'ลบบทความถาวร',
  'settings.updated': 'ปรับการตั้งค่า',
  'team.created': 'เพิ่มทีม',
  'member.updated': 'จัดการสมาชิก',
  'tickets.exported': 'ส่งออกรายงานเคส',
  'backup.created': 'สำรองข้อมูลองค์กร',
  'tenant.created': 'สร้างองค์กร',
  'tenant.suspended': 'ระงับองค์กร',
  'tenant.active': 'เปิดใช้งานองค์กร',
  'tenant.support_access': 'ผู้ดูแลแพลตฟอร์มเข้าองค์กรด้วยสิทธิ์ Support Access',
  'auth.login': 'เข้าสู่ระบบ',
  'customer.profile': 'ลูกค้าแก้ไขข้อมูลส่วนตัว',
  'faq.saved': 'บันทึก FAQ กลาง',
  'faq.deleted': 'ลบ FAQ กลาง',
  'platform.admin_added': 'เพิ่มผู้ดูแลระบบกลาง',
  'platform.admin_removed': 'ถอดสิทธิ์ผู้ดูแลระบบกลาง',
  'customer.joined': 'ลูกค้าเริ่มติดต่อองค์กร',
  'automation.rule_applied': 'กฎรับเรื่องอัตโนมัติทำงาน',
  'automation.rule_saved': 'บันทึกกฎรับเรื่อง',
  'automation.rule_deleted': 'ลบกฎรับเรื่อง',
  'automation.macro_saved': 'บันทึก Macro',
  'automation.macro_deleted': 'ลบ Macro',
  'automation.settings_updated': 'ปรับการตั้งค่าอัตโนมัติ',
  'ticket.escalated': 'ยกระดับเคสอัตโนมัติ',
  'macro.run': 'ใช้ Macro',
  'followup.created': 'ตั้งเตือนติดตามผล',
  'followup.done': 'ปิดรายการติดตามผล',
  'csat.sent': 'ส่งแบบประเมินความพึงพอใจ',
  'csat.rated': 'ลูกค้าให้คะแนนความพึงพอใจ',
  'customer.verified': 'ลูกค้าสมัครสมาชิกและยืนยันอีเมล',
  'customer.registered': 'ลูกค้าสมัครสมาชิก (ยังไม่ยืนยันอีเมล)',
};

/* The customer's words for a case (staff words are not customer words): what each state means for the person
   waiting (the old customer.js). Used by the customer screens. */

export type CustomerTone = 'received' | 'working' | 'waiting' | 'done';

export type CustomerState = { label: string; hint: string; step: number; tone: CustomerTone };

export const customerStates: Record<CustomerTone, CustomerState> = {
  received: { label: 'ทีมงานได้รับเรื่องแล้ว', hint: 'เรื่องของคุณเข้าคิวรอเจ้าหน้าที่รับดูแล', step: 1, tone: 'received' },
  working: { label: 'กำลังดำเนินการ', hint: 'เจ้าหน้าที่กำลังดูแลเรื่องของคุณอยู่', step: 2, tone: 'working' },
  waiting: { label: 'รอข้อมูลจากคุณ', hint: 'ทีมงานขอข้อมูลเพิ่มเติม ตอบกลับในแชทได้เลย', step: 2, tone: 'waiting' },
  done: { label: 'ดำเนินการเรียบร้อยแล้ว', hint: 'ถ้ายังไม่เรียบร้อย ตอบกลับในแชทเพื่อให้ทีมดูแลต่อได้', step: 3, tone: 'done' },
};

const caseStateKeys: Record<string, CustomerTone> = {
  new: 'received',
  open: 'working',
  pending_internal: 'working',
  pending_customer: 'waiting',
  resolved: 'done',
  closed: 'done',
};

/** A case status (tickets.status) in the customer's words. */
export function caseState(status: string): CustomerState {
  return customerStates[caseStateKeys[status] ?? 'working'];
}
