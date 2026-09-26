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
  'line.follow': 'ส่งข้อความต้อนรับเพื่อนใหม่ LINE',
  'ai.handoff': 'โอนเคสให้เจ้าหน้าที่ดูแลต่อ',
  'ai.completed': 'AI ประมวลผลคำตอบสำเร็จ',
  'ai.queued': 'นำคำขอ AI เข้าคิว',
  'ai.failed': 'AI ประมวลผลไม่สำเร็จ',
  'ai.cancelled': 'ยกเลิกคำขอ AI',
  'ai.resumed': 'ให้ AI ดูแลต่อ',
  'ai.settings_updated': 'ปรับการตั้งค่า AI',
  'ai.actions_run': 'สั่งงานผ่านผู้ช่วย AI',
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
  'retention.cleared': 'ลบเนื้อหาบทสนทนาเก่าตามระยะเวลาเก็บข้อมูล',
  'reports.dataset_exported': 'ส่งออกชุดข้อมูลสำหรับวิเคราะห์',
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
  'ticket.snoozed': 'clock',
  'ticket.tagged': 'tag',
  'ticket.auto_assigned': 'users',
  'ticket.woken': 'bell',
  'ticket.quiet_reminded': 'send',
  'ticket.quiet_closed': 'checkCircle',
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
  'retention.cleared': 'trash',
  'reports.dataset_exported': 'download',
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
      : /settings|channel|oauth|backup|export|retention/.test(action)
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

/* The server names a person "ชื่อ · อีเมล" (audit.with_names). The row shows the name; the email is only a tooltip.
   A case is named "BD-12 · หัวข้อ", so that is never read as a person. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function auditPerson(display: string | undefined): { name: string; email: string } | null {
  if (!display) return null;
  const at = display.lastIndexOf(' · ');
  if (at < 1) return null;
  const name = display.slice(0, at).trim();
  const email = display.slice(at + 3).trim();
  return EMAIL.test(email) && !/^BD-\d+$/.test(name) ? { name, email } : null;
}

/** Who did it and what it was done to, each said once: when the event is about the actor themself (signing in,
    their own profile), the target is left out instead of repeating the same person. */
export function auditParties(event: AuditEvent): { actor: string; actorEmail: string; target: string; targetEmail: string } {
  const person = auditPerson(event.actor_display);
  const actor = person?.name || event.actor_display || (/^[a-f0-9]{32}$/.test(event.actor) ? 'ผู้ใช้งาน' : event.actor);
  const self = event.entity === event.actor || (Boolean(event.entity_display) && event.entity_display === event.actor_display);
  const text = self ? '' : auditEntityName(event);
  const target = auditPerson(text);
  return { actor, actorEmail: person?.email ?? '', target: target?.name ?? text, targetEmail: target?.email ?? '' };
}

// What actually changed on a case, in words: "สถานะ: ใหม่ → กำลังดำเนินการ".
export const auditFieldLabels: Record<string, string> = {
  status: 'สถานะ',
  priority: 'ความเร่งด่วน',
  team_id: 'ทีม',
  assignee_id: 'ผู้รับผิดชอบ',
};

/* What an owner looks for first: data removed or put back, exports, who may do what, and how the organization is set
   up. Such rows carry a "สำคัญ" mark and have their own tab. */
export function auditImportant(action: string): boolean {
  return (
    /\.(deleted|purged|restored|exported|suspended|revoked|merged)$/.test(action) ||
    /^(member|team|tenant|support_access)\./.test(action) ||
    /settings/.test(action) ||
    ['auth.account_linked', 'backup.created', 'tickets.exported'].includes(action)
  );
}

/** Done by the system rather than a person: the AI's own work and a channel's delivery reports. Hidden unless asked.
    What a member told the assistant to do (ai.actions_run) is the member's own doing. */
export function auditAutomated(event: AuditEvent): boolean {
  return (
    (auditEventGroup(event.action) === 'ai' && !['ai.settings_updated', 'ai.actions_run'].includes(event.action)) ||
    /^channel\.(accepted|failed|unknown|message_received)$/.test(event.action) ||
    /^(line\.join|line\.leave)$/.test(event.action)
  );
}

/** The periods offered as buttons; '' is every event kept, 'custom' shows the date fields. */
export const auditRanges: Record<string, string> = { today: 'วันนี้', '7': '7 วัน', '30': '30 วัน', '': 'ทั้งหมด', custom: 'เลือกวันที่' };
