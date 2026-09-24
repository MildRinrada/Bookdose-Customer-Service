/* The languages customers write in, by the ISO 639-1 codes the translation keeps (backend/modules/ai/translate.py),
   named for the team's screens: "ภาษาอังกฤษ". A language not listed shows its code. */

const NAMES: Record<string, string> = {
  th: 'ไทย',
  en: 'อังกฤษ',
  zh: 'จีน',
  ja: 'ญี่ปุ่น',
  ko: 'เกาหลี',
  vi: 'เวียดนาม',
  lo: 'ลาว',
  my: 'พม่า',
  km: 'เขมร',
  ms: 'มลายู',
  id: 'อินโดนีเซีย',
  tl: 'ฟิลิปปินส์',
  fil: 'ฟิลิปปินส์',
  hi: 'ฮินดี',
  fr: 'ฝรั่งเศส',
  de: 'เยอรมัน',
  es: 'สเปน',
  it: 'อิตาลี',
  pt: 'โปรตุเกส',
  ru: 'รัสเซีย',
  ar: 'อาหรับ',
  nl: 'ดัตช์',
};

export function languageName(code: string) {
  const name = NAMES[code.split('-')[0]];
  return name ? `ภาษา${name}` : `ภาษา ${code.toUpperCase()}`;
}
