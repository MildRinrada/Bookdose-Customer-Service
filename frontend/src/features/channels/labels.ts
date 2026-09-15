/* Words for the channel module's values. */

/** An outbox row's state, as shown under a reply and in the settings panels. */
export const deliveryNames: Record<string, string> = {
  queued: 'รอส่ง',
  sending: 'กำลังส่ง',
  accepted: 'บริการปลายทางรับข้อความแล้ว',
  failed: 'ส่งไม่สำเร็จ',
  unknown: 'ไม่ทราบผลการส่ง',
};

export const emailAuthModes: Record<string, string> = {
  password: 'รหัสผ่าน / App Password',
  google: 'Google Workspace / Gmail OAuth',
  microsoft: 'Microsoft 365 / Outlook OAuth',
};

export const smtpPorts: Record<string, string> = { 465: '465 · TLS', 587: '587 · STARTTLS' };
