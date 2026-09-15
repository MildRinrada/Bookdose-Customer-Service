import type { Capability } from '@/features/contracts/types';
import type { Tone } from '@/features/contracts/labels';
import type { FlowKind, MemberStatus } from './types';

/* Thai words for the client team: what each capability lets a role do, member states and the flow kinds. */

export const capabilityLabels: Record<Capability, string> = {
  documents: 'เปิดเอกสารสัญญา/TOR หน้าโครงการ และคลังเอกสาร',
  billing: 'ดูใบแจ้งหนี้ ใบเสร็จ แนบสลิป และข้อมูลผู้ซื้อ',
  review: 'เป็นผู้ตรวจในขั้นตอนอนุมัติ',
  decide: 'อนุมัติรับงาน ลงนาม หรือขอแก้ไขเอกสาร',
  issues: 'แจ้งปัญหาและขอเปลี่ยนแปลง',
  team: 'จัดการทีมและขั้นตอนอนุมัติ',
};

export const memberStatusLabels: Record<MemberStatus, string> = {
  invited: 'รอตอบรับคำเชิญ',
  active: 'ใช้งานอยู่',
  declined: 'ปฏิเสธคำเชิญ',
  removed: 'นำออกแล้ว',
};

export const memberStatusTones: Record<MemberStatus, Tone> = {
  invited: 'waiting',
  active: 'done',
  declined: 'cancelled',
  removed: 'cancelled',
};

export const flowKindLabels: Record<FlowKind, string> = {
  delivery: 'ตรวจรับงานส่งมอบ',
  contract: 'ตรวจเอกสารสัญญา/TOR ก่อนลงนาม',
};

export const flowKindHints: Record<FlowKind, string> = {
  delivery: 'เมื่อผู้รับจ้างส่งมอบงานแต่ละรอบ ผู้ตรวจตามลำดับนี้ต้องผ่านก่อน ผู้มีสิทธิ์อนุมัติจึงอนุมัติรับงานได้',
  contract: 'เมื่อได้รับเอกสารเวอร์ชันใหม่ ผู้ตรวจตามลำดับนี้ต้องผ่านก่อน ผู้มีสิทธิ์อนุมัติจึงลงนามได้',
};
