import type { BlockDuration, DecoyPathMatch, HoneytokenKind, SecurityRange, SecuritySettings } from './types';

/* Every Thai word of the platform security page (docs/SECURITY-DESIGN.md §4): event kinds, levels, who, alert rules,
   durations, chart series and the settings with their bounds. */

export const eventKindLabels: Record<string, string> = {
  login_failed: 'เข้าสู่ระบบไม่สำเร็จ',
  login_locked: 'บัญชีถูกล็อกชั่วคราว',
  login_after_lock: 'เข้าสู่ระบบได้หลังถูกล็อก',
  twofa_failed: 'รหัสยืนยันสองขั้นตอนไม่ถูกต้อง',
  password_reset_requested: 'ขอตั้งรหัสผ่านใหม่',
  password_reset_completed: 'ตั้งรหัสผ่านใหม่สำเร็จ',
  session_expired: 'เซสชันหมดเวลา',
  sessions_revoked: 'ยุติเซสชันของบัญชี',
  rate_limited: 'ถูกจำกัดจำนวนคำขอ',
  csrf_rejected: 'ปฏิเสธคำขอ (CSRF ไม่ถูกต้อง)',
  origin_rejected: 'ปฏิเสธคำขอ (Host / Origin ไม่ถูกต้อง)',
  cross_tenant_denied: 'พยายามเข้าถึงข้อมูลองค์กรอื่น',
  support_access: 'ผู้ดูแลแพลตฟอร์มเข้าช่วยดูแลองค์กร',
  webhook_signature_failed: 'ลายเซ็น Webhook ไม่ถูกต้อง',
  guest_link_invalid: 'ลิงก์ติดตามแชทไม่ถูกต้อง',
  ip_blocked_request: 'คำขอจาก IP ที่ถูกบล็อก',
  admin_unlock: 'ผู้ดูแลปลดล็อกบัญชี',
  admin_ip_block: 'ผู้ดูแลเปลี่ยนรายการบล็อก IP',
  security_settings_changed: 'เปลี่ยนการตั้งค่าความปลอดภัย',
  captcha_failed: 'ไม่ผ่านการยืนยันว่าไม่ใช่บอท (Turnstile)',
  captcha_unavailable: 'ตรวจ Turnstile ไม่ได้ ปล่อยคำขอผ่าน',
  honeypot_path: 'เปิดเส้นทางกับดัก',
  honeypot_form: 'กรอกช่องซ่อนในฟอร์ม (บอท)',
  honeytoken_triggered: 'มีการใช้กับดัก (Honeytoken)',
  trap_ip_block: 'บล็อก IP อัตโนมัติจากกับดัก',
};

export const eventKindLabel = (kind: string) => eventKindLabels[kind] ?? kind;

export const severityLabels: Record<string, string> = { info: 'ข้อมูล', warning: 'เฝ้าระวัง', critical: 'วิกฤต' };

export const actorLabels: Record<string, string> = {
  staff: 'ทีมงานองค์กร',
  platform: 'ผู้ดูแลแพลตฟอร์ม',
  customer: 'ลูกค้า',
  guest: 'ผู้เยี่ยมชม',
  anonymous: 'ไม่ระบุตัวตน',
};

/** Whose lock a row of the locked list is: the shared sign-in page ('signin:<email>') besides the event actors. */
export const lockActorLabels: Record<string, string> = { ...actorLabels, signin: 'หน้าเข้าสู่ระบบ (ทุกประเภทบัญชี)' };

export const alertRuleLabels: Record<string, string> = {
  ip_failed_logins: 'เข้าสู่ระบบไม่สำเร็จจาก IP เดียวจำนวนมาก',
  platform_failed_logins: 'เข้าสู่ระบบไม่สำเร็จทั้งระบบจำนวนมาก',
  locks: 'บัญชีถูกล็อกพร้อมกันจำนวนมาก',
  ip_rate_limited: 'IP เดียวถูกจำกัดคำขอจำนวนมาก',
  webhook_failures: 'ลายเซ็น Webhook ไม่ถูกต้องต่อเนื่อง',
  honeytoken: 'มีการใช้กับดัก (Honeytoken)',
};

/** Rule ids may carry their window (e.g. ip_failed_logins_10m): matched by the longest known prefix. */
export function alertRuleLabel(rule: string): string {
  const key = Object.keys(alertRuleLabels)
    .filter((name) => rule === name || rule.startsWith(`${name}_`))
    .sort((a, b) => b.length - a.length)[0];
  return key ? alertRuleLabels[key] : rule;
}

export const rangeLabels: Record<SecurityRange, string> = { '24h': '24 ชม.', '7d': '7 วัน' };

export const durationLabels: Record<BlockDuration, string> = { '1h': '1 ชั่วโมง', '24h': '24 ชั่วโมง', '7d': '7 วัน', permanent: 'ถาวร' };

export const seriesLabels = { failed_logins: 'เข้าสู่ระบบล้มเหลว', rate_limited: 'ถูกจำกัดคำขอ', rejected: 'ถูกปฏิเสธ' } as const;

export type SeriesKey = keyof typeof seriesLabels;

export const cardLabels = {
  failed_logins: 'เข้าสู่ระบบไม่สำเร็จ',
  locked_now: 'บัญชีที่ถูกล็อกอยู่',
  rate_limited: 'ถูกจำกัดคำขอ',
  origin_csrf_rejected: 'ปฏิเสธ Origin / CSRF',
  cross_tenant_denied: 'เข้าถึงข้ามองค์กร',
  open_alerts: 'การแจ้งเตือนที่เปิดอยู่',
  honeypot_hits: 'บอทติดกับดัก',
  honeytoken_triggers: 'กับดัก Honeytoken ทำงาน',
} as const;

export const detailKeyLabels: Record<string, string> = {
  reason: 'เหตุผล',
  area: 'ส่วนของระบบ',
  path: 'เส้นทาง',
  method: 'วิธีเรียก',
  origin: 'Origin',
  host: 'Host',
  channel: 'ช่องทาง',
  level: 'ระดับการล็อก',
  locked_until: 'ล็อกถึง',
  minutes: 'นาที',
  revoked: 'จำนวนเซสชันที่ยุติ',
  duration: 'ระยะเวลา',
  changes: 'การเปลี่ยนแปลง',
  by: 'ดำเนินการโดย',
  tenant: 'องค์กร',
  key: 'คีย์การล็อก',
  account: 'บัญชี',
  account_actor: 'กลุ่มของบัญชี',
  action: 'การดำเนินการ',
  blocked_ip: 'IP',
  expires_at: 'หมดอายุ',
  count: 'จำนวน',
  rule: 'กฎ',
  form: 'ฟอร์ม',
  token_id: 'รหัสกับดัก',
  kind: 'ชนิด',
  label: 'ชื่อกับดัก',
  where: 'พบที่',
  test: 'ทดสอบ',
  user_id: 'ผู้ใช้ที่เข้าสู่ระบบอยู่',
  user_email: 'อีเมลผู้ใช้ที่เข้าสู่ระบบอยู่',
  hits: 'จำนวนครั้ง',
  window_minutes: 'ภายใน (นาที)',
  check: 'การตรวจ',
  trigger: 'สาเหตุ',
};

export type SessionActor = keyof SecuritySettings['sessions'];

export const sessionActorLabels: Record<SessionActor, string> = {
  staff: 'ทีมงานองค์กร',
  platform: 'ผู้ดูแลแพลตฟอร์ม',
  customer: 'ลูกค้า',
};

/* Bounds (§2): idle 5 minutes – 30 days, absolute 1 hour – 90 days, idle not longer than absolute. Customers are set
   in whole days, so their idle limit starts at one day. */
export const SESSION_BOUNDS = {
  idle_minutes: { min: 5, max: 30 * 24 * 60 },
  absolute_hours: { min: 1, max: 90 * 24 },
  idle_days: { min: 1, max: 30 },
  absolute_days: { min: 1, max: 90 },
} as const;

export const ALERT_BOUNDS = { min: 1, max: 100000 } as const;

export const alertSettingLabels: Record<keyof SecuritySettings['alerts'], { label: string; hint: string }> = {
  ip_failed_logins_10m: { label: 'เข้าสู่ระบบไม่สำเร็จจาก IP เดียว', hint: 'ครั้งภายใน 10 นาที → เฝ้าระวัง' },
  platform_failed_logins_10m: { label: 'เข้าสู่ระบบไม่สำเร็จทั้งระบบ', hint: 'ครั้งภายใน 10 นาที → วิกฤต' },
  locks_1h: { label: 'บัญชีถูกล็อก', hint: 'บัญชีภายใน 1 ชั่วโมง → วิกฤต' },
  ip_rate_limited_10m: { label: 'ถูกจำกัดคำขอจาก IP เดียว', hint: 'ครั้งภายใน 10 นาที → เฝ้าระวัง' },
  webhook_failures_10m: { label: 'ลายเซ็น Webhook ไม่ถูกต้อง', hint: 'ครั้งภายใน 10 นาที → เฝ้าระวัง' },
};

/* Traps (docs/HONEYPOT-DESIGN.md) */

/** The event kinds the traps record, in the order the trap events card lists its filters. */
export const TRAP_EVENT_KINDS = ['honeytoken_triggered', 'honeypot_path', 'honeypot_form', 'trap_ip_block'] as const;

/** Each honeytoken kind: its icon, Thai name, what sets it off, where to plant it and an example name. */
export const honeytokenKinds: Record<HoneytokenKind, { icon: string; label: string; explain: string; plant: string; example: string }> = {
  decoy_account: {
    icon: 'users',
    label: 'บัญชีล่อ',
    explain: 'อีเมลที่ดูเหมือนบัญชีจริงแต่ไม่มีอยู่จริง ทำงานเมื่อมีคนพยายามเข้าสู่ระบบ ขอตั้งรหัสผ่านใหม่ หรือเชิญอีเมลนี้เข้าทีม',
    plant: 'วางในไฟล์สำรองรายชื่อผู้ใช้ เอกสารส่งมอบระบบ หรือรายการบัญชีผู้ดูแลที่ไม่ควรหลุดออกไป',
    example: 'เช่น บัญชีสำรองฝ่ายไอที',
  },
  api_key: {
    icon: 'code',
    label: 'คีย์ API ล่อ',
    explain: 'คีย์ที่หน้าตาเหมือนคีย์ใช้งานจริง ทำงานเมื่อมีคำขอใดส่งคีย์นี้มา (header, cookie, query หรือ JSON)',
    plant: 'วางในไฟล์ .env ตัวอย่าง โค้ดใน repository ส่วนตัว หรือ wiki ของทีมพัฒนา',
    example: 'เช่น คีย์ API ใน .env.backup',
  },
  password: {
    icon: 'lock',
    label: 'รหัสผ่านล่อ',
    explain: 'รหัสผ่านที่ทำงานเมื่อมีคนใช้เข้าสู่ระบบ ไม่ว่าจะกรอกอีเมลใด',
    plant: 'วางในโน้ต "รหัสผ่านผู้ดูแลสำรอง" เอกสารภายใน หรือตัวจัดการรหัสผ่านที่ใช้ร่วมกัน',
    example: 'เช่น รหัสผ่านผู้ดูแลสำรองในโน้ตทีม',
  },
  link: {
    icon: 'link',
    label: 'ลิงก์ไฟล์ล่อ',
    explain: 'ลิงก์ที่ดูเหมือนไฟล์แชร์ ทำงานเมื่อมีคนเปิด (หน้าที่เปิดขึ้นบอกว่าไฟล์ถูกย้ายหรือหมดอายุ)',
    plant: 'ตั้งชื่อให้น่าสนใจ แล้ววางในอีเมล โฟลเดอร์แชร์ หรือห้องแชทของทีม',
    example: 'เช่น รหัสผ่านระบบสำรอง.pdf',
  },
};

export const honeytokenKindLabel = (kind: string) => honeytokenKinds[kind as HoneytokenKind]?.label ?? kind;

/** The forms that carry the hidden box (event detail `form`). */
export const honeypotFormLabels: Record<string, string> = {
  sign_in: 'หน้าเข้าสู่ระบบ',
  staff_sign_in: 'เข้าสู่ระบบทีมงาน (API เดิม)',
  customer_sign_in: 'เข้าสู่ระบบลูกค้า (API เดิม)',
  staff_register: 'สมัครองค์กรใหม่',
  customer_register: 'สมัครสมาชิกลูกค้า',
  customer_forgot: 'ลูกค้าลืมรหัสผ่าน',
  guest_chat: 'เริ่มแชทโดยไม่เข้าสู่ระบบ',
};

/** Where a honeytoken was seen (event detail `where`). */
export const honeytokenWhereLabels: Record<string, string> = {
  sign_in: 'การเข้าสู่ระบบ',
  password_reset: 'การขอตั้งรหัสผ่านใหม่',
  registration: 'การสมัครบัญชี',
  invite: 'การเชิญ/เพิ่มสมาชิก',
  authorization: 'header Authorization',
  x_api_key: 'header X-API-Key',
  cookie: 'cookie',
  query: 'พารามิเตอร์ใน URL',
  json_body: 'ข้อมูล JSON ที่ส่งมา',
  link: 'การเปิดลิงก์',
  test: 'ปุ่มทดสอบ',
};

export const decoyMatchLabels: Record<DecoyPathMatch, string> = { exact: 'ตรงทั้งเส้นทาง', prefix: 'ขึ้นต้นด้วย' };

/** The API's built-in decoy paths (backend/modules/security/model.py DECOY_API_PATHS), shown so a custom one is not a
    repeat. The page ones are in src/lib/traps.ts. */
export const BUILT_IN_API_DECOYS = [
  '/api/admin',
  '/api/v1/users',
  '/api/users/export',
  '/api/debug',
  '/api/internal/config',
  '/api/graphql',
  '/api/swagger.json',
  '/api/.env',
] as const;

export const MAX_CUSTOM_DECOYS = 50;

/** A custom decoy: under /api/, lower case letters, digits and . _ ~ - (the server checks overlaps with real routes). */
export const CUSTOM_DECOY_PATH = /^\/api(?:\/[a-z0-9._~-]+)+$/;

export const PATH_HIT_BOUNDS = { hits: { min: 1, max: 1000 }, window_minutes: { min: 1, max: 1440 } } as const;
