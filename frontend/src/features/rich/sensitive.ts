/* เตือนก่อนส่งข้อมูลที่ไม่ควรส่ง: what a customer is about to send is read here, in their own browser, for things the
   team never needs and nobody should put in a chat - a Thai ID card number (its check digit right), a card number (its
   Luhn check right), a password or a one-time code written after its name - and, looser, any long run of digits that
   is not a phone number: a number still being typed, or one mistyped by a digit, may still be an ID or an account
   number, and the warning must not vanish the moment one digit is changed. Nothing is sent anywhere to check it. maskSensitive() hides each one, keeping only the last digits so the customer can still say
   which card or which ID they mean. */

export type SensitiveKind = 'id' | 'card' | 'password' | 'otp' | 'number';

export const SENSITIVE_LABELS: Record<SensitiveKind, string> = {
  id: 'เลขบัตรประชาชน',
  card: 'เลขบัตรเครดิตหรือเดบิต',
  password: 'รหัสผ่าน',
  otp: 'รหัส OTP',
  number: 'ตัวเลขยาวที่อาจเป็นเลขบัตรหรือเลขบัญชี',
};

type Hit = { kind: SensitiveKind; start: number; end: number; masked: string };

const digitsOf = (text: string) => text.replace(/\D/g, '');

function thaiIdOk(digits: string): boolean {
  if (digits.length !== 13 || digits[0] === '0' || digits[0] === '9') return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(digits[12]);
}

function luhnOk(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const THAI_ID = /(?<![\d])\d[ -]?\d{4}[ -]?\d{5}[ -]?\d{2}[ -]?\d(?![\d])/g;
const CARD = /(?<![\d])(?:\d[ -]?){12,18}\d(?![\d])/g;
// The word, then maybe คือ / เป็น / ":" , then the value itself.
const PASSWORD = /(รหัสผ่าน|พาสเวิร์ด|พาสเวิด|password|passwd|pwd|pass)(\s*(?:ของฉัน|ใหม่)?\s*(?:คือ|เป็น)?\s*[:=：]?\s*)(\S{4,})/gi;
// 10-19 digits (single spaces or dashes between them allowed), not stuck to letters: "EE123456789TH" is a parcel code.
const LONG_NUMBER = /(?<![\dA-Za-z])\d(?:[ -]?\d){9,18}(?![\dA-Za-z])/g;
// A Thai phone number (0 then 8-9 digits, or 66 then 8-9) is what customers are asked for, not a secret.
const PHONE = /^(?:0\d{8,9}|66\d{8,9})$/;
const OTP = /(otp|รหัส\s*otp|รหัสยืนยัน|รหัส\s*ยืนยัน)(\s*(?:คือ|:|=|：)?\s*)(\d{4,8})(?![\d])/gi;

/** A password looks like one: letters with digits or symbols, or mixed case - never a plain Thai or English word
    ("รหัสผ่านเข้าไม่ได้", "password reset"). */
const looksSecret = (value: string) => /\d|[!@#$%^&*._\-+?]/.test(value) || (/[a-z]/.test(value) && /[A-Z]/.test(value));

export function findSensitive(text: string): Hit[] {
  const hits: Hit[] = [];
  const taken = (start: number, end: number) => hits.some((h) => start < h.end && end > h.start);
  for (const m of text.matchAll(THAI_ID)) {
    const digits = digitsOf(m[0]);
    if (!thaiIdOk(digits)) continue;
    hits.push({ kind: 'id', start: m.index, end: m.index + m[0].length, masked: `X-XXXX-XXXXX-${digits.slice(10, 12)}-${digits[12]}` });
  }
  for (const m of text.matchAll(CARD)) {
    const digits = digitsOf(m[0]);
    if (digits.length < 13 || digits.length > 19 || !/^[2-6]/.test(digits) || !luhnOk(digits)) continue;
    if (taken(m.index, m.index + m[0].length)) continue;
    hits.push({ kind: 'card', start: m.index, end: m.index + m[0].length, masked: `•••• •••• •••• ${digits.slice(-4)}` });
  }
  for (const m of text.matchAll(LONG_NUMBER)) {
    const digits = digitsOf(m[0]);
    if (PHONE.test(digits) || taken(m.index, m.index + m[0].length)) continue;
    hits.push({ kind: 'number', start: m.index, end: m.index + m[0].length, masked: `••••••${digits.slice(-4)}` });
  }
  for (const m of text.matchAll(OTP)) {
    const start = m.index + m[1].length + m[2].length;
    if (!taken(start, start + m[3].length)) hits.push({ kind: 'otp', start, end: start + m[3].length, masked: '••••••' });
  }
  for (const m of text.matchAll(PASSWORD)) {
    const value = m[3];
    if (!looksSecret(value)) continue;
    const start = m.index + m[1].length + m[2].length;
    if (!taken(start, start + value.length)) hits.push({ kind: 'password', start, end: start + value.length, masked: '••••••••' });
  }
  return hits.sort((a, b) => a.start - b.start);
}

/** The kinds found, each once, in the order they appear. */
export function sensitiveKinds(text: string): SensitiveKind[] {
  return [...new Set(findSensitive(text).map((h) => h.kind))];
}

/** The text with each one hidden. */
export function maskSensitive(text: string): string {
  let out = '';
  let at = 0;
  for (const hit of findSensitive(text)) {
    out += text.slice(at, hit.start) + hit.masked;
    at = hit.end;
  }
  return out + text.slice(at);
}
