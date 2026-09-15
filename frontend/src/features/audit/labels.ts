import { eventLabels } from '@/lib/labels';
import type { AuditEvent, AuditGroup } from './types';

/* Words, icons and links of the activity log (the old old-frontend/pages/audit/audit.js). */

export const auditEventLabels: Record<string, string> = {
  'email.oauth_started': 'เริ่มเชื่อมบัญชีอีเมล',
  'email.oauth_connected': 'เชื่อมบัญชีอีเมลสำเร็จ',
  'channel.settings_updated': 'ปรับการเชื่อมต่อช่องทาง',
  'channel.message_received': 'รับข้อความจากลูกค้า',
  'channel.retry_requested': 'ขอส่งข้อความอีกครั้ง',
  'channel.accepted': 'ผู้ให้บริการรับข้อความแล้ว',
  'channel.failed': 'ส่งข้อความไม่สำเร็จ',
  'channel.unknown': 'ไม่ทราบผลการส่งข้อความ',
  'line.join': 'เข้าร่วมกลุ่ม LINE',
  'line.leave': 'ออกจากกลุ่ม LINE',
  'ai.handoff': 'โอนเคสให้เจ้าหน้าที่ดูแลต่อ',
  'ai.completed': 'AI ประมวลผลคำตอบสำเร็จ',
  'ai.queued': 'นำคำขอ AI เข้าคิว',
  'ai.failed': 'AI ประมวลผลไม่สำเร็จ',
  'ai.cancelled': 'ยกเลิกคำขอ AI',
  'ai.resumed': 'ให้ AI ดูแลต่อ',
  'ai.settings_updated': 'ปรับการตั้งค่า AI',
  'conversation.created': 'รับเรื่องใหม่',
  'conversation.closed': 'ปิดบทสนทนา',
  'conversation.open': 'เปิดบทสนทนาอีกครั้ง',
  'message.reply': 'ตอบกลับลูกค้า',
  'message.note': 'เพิ่มบันทึกภายใน',
  'message.files_revoked': 'ยกเลิกลิงก์ไฟล์แนบ',
  'auth.email_verified': 'ยืนยันอีเมล',
  'tenant.register': 'สมัครองค์กรใหม่',
  'registration.settings_updated': 'ตั้งค่าอีเมลยืนยัน',
  'account.profile_updated': 'ปรับรูปโปรไฟล์และชื่อ',
};

export const auditGroups: Record<AuditGroup, { label: string; icon: string }> = {
  work: { label: 'งานบริการ', icon: 'ticket' },
  ai: { label: 'ระบบ AI', icon: 'sparkle' },
  security: { label: 'บัญชีและสิทธิ์', icon: 'lock' },
  settings: { label: 'ตั้งค่าระบบ', icon: 'settings' },
};

// The icon says what kind of activity it was, so a day of work can be skimmed instead of read.
const auditIcons: Record<string, string> = {
  'message.reply': 'send',
  'message.note': 'lock',
  'message.files_revoked': 'paperclip',
  'conversation.created': 'chat',
  'conversation.closed': 'checkCircle',
  'conversation.open': 'chat',
  'conversation.linked': 'ticket',
  'ticket.created': 'plus',
  'ticket.updated': 'edit',
  'ticket.deleted': 'close',
  'tickets.exported': 'download',
  'contact.created': 'users',
  'contact.updated': 'edit',
  'contact.merged': 'users',
  'contact.deleted': 'close',
  'article.saved': 'book',
  'article.deleted': 'close',
  'ticket.restored': 'restore',
  'contact.restored': 'restore',
  'article.restored': 'restore',
  'ticket.purged': 'trash',
  'contact.purged': 'trash',
  'article.purged': 'trash',
  'auth.login': 'lock',
  'auth.email_verified': 'checkCircle',
  'account.profile_updated': 'edit',
  'member.updated': 'users',
  'team.created': 'users',
  'settings.updated': 'settings',
  'backup.created': 'download',
  'channel.message_received': 'mail',
  'channel.failed': 'close',
  'channel.accepted': 'checkCircle',
};

export function auditEventGroup(action: string): AuditGroup {
  return action.startsWith('ai.')
    ? 'ai'
    : /^(auth|account|member|tenant|registration|team)\./.test(action)
      ? 'security'
      : /settings|channel|oauth|backup|export/.test(action)
        ? 'settings'
        : 'work';
}

export function auditIcon(action: string): string {
  return auditIcons[action] || auditGroups[auditEventGroup(action)].icon;
}

// A removal is not the same as a reply: the log says so at a glance.
export function auditTone(action: string): string {
  return /\.(deleted|purged|suspended|failed|revoked)/.test(action) ? 'danger' : auditEventGroup(action);
}

/** What the event did, in words. */
export function auditLabel(action: string): string | undefined {
  return auditEventLabels[action] || eventLabels[action];
}

/* The audit row points at what it changed, so a question ("who closed this case?") ends on the case itself. */
export function auditLink(event: AuditEvent): string {
  const [kind] = event.action.split('.');
  if (/\.(deleted|purged)$/.test(event.action)) return '';
  if (kind === 'ticket') return `/tickets/${event.entity}`;
  if (kind === 'message' || kind === 'conversation' || kind === 'line') return `/inbox/${event.entity}`;
  if (kind === 'article') return `/knowledge/${event.entity}`;
  if (kind === 'contact') return `/tickets?contact=${encodeURIComponent(event.entity)}`;
  return '';
}

export function auditEntityName(event: AuditEvent): string {
  if (/\.(deleted|purged|restored)$/.test(event.action) && event.detail) return event.detail;
  return event.entity_display && event.entity_display !== 'รายการที่เกี่ยวข้อง' ? event.entity_display : '';
}

// What actually changed on a case, in words: "สถานะ: ใหม่ → กำลังดำเนินการ".
export const auditFieldLabels: Record<string, string> = {
  status: 'สถานะ',
  priority: 'ความเร่งด่วน',
  team_id: 'ทีม',
  assignee_id: 'ผู้รับผิดชอบ',
};
