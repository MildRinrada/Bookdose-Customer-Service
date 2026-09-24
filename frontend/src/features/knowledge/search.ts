import { plainText } from '@/lib/format';
import type { Article } from './types';

/* Search in everyday words: "ลืมรหัสทำยังไง" finds "วิธีรีเซ็ตรหัสผ่าน". The question words are dropped, what is
   left is split into ideas (a few common words bring their other spellings along: รหัส = รหัสผ่าน = password), and an
   article matches when it holds most of the ideas - in its title first. Each match brings the sentence that answers
   best, with the words that matched, to highlight. It runs in the browser on the list already loaded: instant, and
   nothing is sent anywhere. */

/** Words that ask rather than say what is asked about: at the end of a phrase ("…ทำยังไงคะ") or at its start
    ("วิธี…"), never inside a word (คะแนน keeps its คะ). */
const ENDINGS = [
  'ต้องทำยังไง', 'ต้องทำอย่างไร', 'ทำยังไงดี', 'ทำยังไง', 'ทำอย่างไร', 'ทำไงดี', 'ทำไง', 'ยังไงดี', 'ยังไง', 'อย่างไร',
  'ได้ไหม', 'ได้มั้ย', 'ได้หรือไม่', 'หรือเปล่า', 'หรือไม่', 'ไหม', 'มั้ย', 'นะคะ', 'นะครับ', 'ครับ', 'ค่ะ', 'คะ', 'จ้า',
  'หน่อย', 'บ้าง',
];
const OPENINGS = ['อยากรู้ว่า', 'อยากทราบว่า', 'อยากทราบ', 'อยากรู้', 'ช่วยบอก', 'วิธีการ', 'วิธี', 'อยาก'];

function trimAsking(chunk: string) {
  let rest = chunk;
  for (let again = true; again && rest; ) {
    again = false;
    for (const end of ENDINGS)
      if (rest.endsWith(end)) {
        rest = rest.slice(0, -end.length);
        again = true;
      }
    for (const start of OPENINGS)
      if (rest.startsWith(start) && rest.length > start.length) {
        rest = rest.slice(start.length);
        again = true;
      }
  }
  return rest;
}

/** Words said in more than one way; any one finds the others. */
const SYNONYMS = [
  ['รหัสผ่าน', 'พาสเวิร์ด', 'password', 'รหัส'],
  ['ลืม', 'รีเซ็ต', 'reset', 'กู้คืน', 'ตั้งใหม่'],
  ['เข้าสู่ระบบ', 'ล็อกอิน', 'ล็อคอิน', 'login', 'เข้าระบบ'],
  ['สมัครสมาชิก', 'ลงทะเบียน', 'สร้างบัญชี', 'register', 'สมัคร'],
  ['อีเมล', 'อีเมล์', 'email', 'เมล'],
  ['ยกเลิก', 'cancel'],
  ['แชท', 'chat', 'ข้อความ'],
  ['ดาวน์โหลด', 'download', 'โหลด'],
  ['เอกสาร', 'ไฟล์', 'file'],
  ['เบอร์โทร', 'โทรศัพท์', 'phone', 'เบอร์'],
  ['เปลี่ยน', 'แก้ไข', 'แก้', 'edit'],
  ['รูปภาพ', 'รูป', 'ภาพ', 'image'],
  ['ติดตามสถานะ', 'ติดตาม', 'สถานะ', 'ความคืบหน้า', 'คืบหน้า', 'ถึงไหน', 'track', 'status'],
  ['ส่งเรื่อง', 'แจ้งปัญหา', 'แจ้งเรื่อง', 'ร้องเรียน', 'ขอความช่วยเหลือ', 'ติดต่อทีมงาน', 'แจ้ง', 'ติดต่อ'],
  ['ตอบกลับ', 'ไม่มีใครตอบ', 'ไม่ตอบ', 'ตอบ', 'reply'],
];

/* Words that say something is wrong without saying what: they add to an article that has them, but an article is
   never left out for not having them - "เข้าระบบไม่ได้" is about signing in, whether or not the article says ไม่ได้. */
const SOFT = [['ใช้ไม่ได้', 'ผิดพลาด', 'ขัดข้อง', 'error', 'ไม่ได้', 'ไม่ได้รับ', 'ไม่ขึ้น', 'ไม่เข้า']];

/** Words that only hold a sentence together; what is left of a Thai phrase after the known words is cut into words
    (the browser's own Thai word breaker) and these are dropped. */
const STOP = new Set(
  (
    'ที่ ไป แล้ว เลย ว่า ของ ให้ ด้วย จะ ได้ การ และ หรือ กับ ใน มี เป็น อยู่ ยัง นี้ นั้น ก็ แต่ คือ ทำ ผม ฉัน หนู ' +
    'เรา คุณ ช่วย ขอ มา เอง กัน อะไร ตอนนี้ เพิ่ง เมื่อ ทำไม the to a an is are my i how do can'
  ).split(' '),
);

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('th', { granularity: 'word' }) : null;

/** The words of what is left of a chunk: split by the browser's Thai word breaker where there is one. */
function leftWords(rest: string): string[] {
  const pieces = segmenter
    ? [...segmenter.segment(rest)].filter((s) => s.isWordLike).map((s) => s.segment)
    : rest.split(/\s+/);
  return pieces.filter((w) => w.length >= 2 && !STOP.has(w));
}

/** soft: counts when found, never required (SOFT). */
type Idea = { words: string[]; soft?: boolean };

/** The ideas asked about: each a list of words any of which finds it. */
export function queryIdeas(query: string): Idea[] {
  const text = query
    .toLowerCase()
    .replace(/[?？!.,]/g, ' ')
    .replace(/\bhow (to|do i|can i)\b/g, ' ')
    // "จำรหัสผ่านไม่ได้" is ลืมรหัสผ่าน.
    .replace(/จำ(\S{0,24}?)ไม่ได้/g, 'ลืม$1');
  const ideas: Idea[] = [];
  for (const chunk of text.split(/\s+/).filter(Boolean)) {
    // Thai is written without spaces: take the known words out of the chunk, then cut what is left into words.
    let rest = trimAsking(chunk);
    for (const [groups, soft] of [
      [SYNONYMS, false],
      [SOFT, true],
    ] as const) {
      for (const group of groups) {
        const found = group.find((w) => rest.includes(w));
        if (!found) continue;
        ideas.push(soft ? { words: group, soft } : { words: group });
        rest = rest.split(found).join(' ');
      }
    }
    for (const left of rest.split(/\s+/)) for (const word of leftWords(left)) ideas.push({ words: [word] });
  }
  return ideas;
}

/** Anything with the three fields the search reads: the team's own articles, and the shorter shape the customer's
    pages carry (features/customer/components/ArticlePeek). */
export type Searchable = { title: string; category?: string; body: string };

export type SearchHit<T extends Searchable = Article> = { article: T; score: number; words: string[]; passage: string };

const WEIGHT = { title: 4, category: 2, body: 1 };

/** The articles matching `query`, best first, each with the words that matched and its best sentence. An empty
    query (or only question words) answers null: show everything. */
export function searchArticles<T extends Searchable>(articles: T[], query: string): SearchHit<T>[] | null {
  const ideas = queryIdeas(query);
  if (!ideas.length) return null;
  const phrase = query.trim().toLowerCase();
  const hits: SearchHit<T>[] = [];
  for (const article of articles) {
    const title = article.title.toLowerCase();
    const category = (article.category ?? '').toLowerCase();
    const body = plainText(article.body).toLowerCase();
    let score = 0;
    let met = 0;
    let metRequired = 0;
    const words: string[] = [];
    for (const idea of ideas) {
      let best = 0;
      for (const word of idea.words) {
        const weight = title.includes(word) ? WEIGHT.title : category.includes(word) ? WEIGHT.category : body.includes(word) ? WEIGHT.body : 0;
        if (weight) words.push(word);
        best = Math.max(best, weight);
      }
      // A longer phrase of its own ("ชื่อบัญชี") also matches when most of its letters in a row are there
      // ("ชื่อในบัญชี").
      if (!best && idea.words.length === 1 && idea.words[0].length >= 4 && closeness(idea.words[0], `${title} ${body}`) >= 0.6) best = 0.5;
      if (best) {
        met += 1;
        if (!idea.soft) metRequired += 1;
      }
      score += best;
    }
    // Most of the ideas (all of one or two) must be there; the soft ones only add to the score.
    const required = ideas.filter((idea) => !idea.soft).length;
    if (required ? metRequired < Math.ceil(required * 0.6) : !met) continue;
    if (title.includes(phrase)) score += 6;
    hits.push({ article, score: score + (met / ideas.length) * 10, words, passage: bestPassage(article.body, words) });
  }
  return hits.sort((a, b) => b.score - a.score);
}

/** How many of the word's three-letter runs the text holds (0 to 1). */
function closeness(word: string, text: string) {
  const runs = new Set<string>();
  for (let i = 0; i + 3 <= word.length; i++) runs.add(word.slice(i, i + 3));
  let found = 0;
  runs.forEach((run) => {
    if (text.includes(run)) found += 1;
  });
  return runs.size ? found / runs.size : 0;
}

/** The sentence (or line) of the article holding the most of `words`, about 180 characters around the first. */
export function bestPassage(body: string, words: string[]): string {
  const lines = String(body)
    .split(/\n+|(?<=[.!?。])\s+/)
    .map((line) => plainText(line))
    .filter((line) => line.length > 3);
  let best = '';
  let bestCount = 0;
  for (const line of lines) {
    const lower = line.toLowerCase();
    const count = new Set(words.filter((w) => lower.includes(w))).size;
    if (count > bestCount) {
      best = line;
      bestCount = count;
    }
  }
  if (!best) return '';
  if (best.length <= 180) return best;
  const at = Math.max(0, best.toLowerCase().indexOf(words.find((w) => best.toLowerCase().includes(w)) ?? '') - 50);
  return `${at ? '… ' : ''}${best.slice(at, at + 180).trim()} …`;
}

/** `text` in pieces, `hit` where one of `words` is (any case). */
export function highlightParts(text: string, words: string[]): { text: string; hit: boolean }[] {
  const unique = [...new Set(words.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!unique.length) return [{ text, hit: false }];
  const pattern = new RegExp(`(${unique.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text
    .split(pattern)
    .filter(Boolean)
    .map((part) => ({ text: part, hit: unique.some((w) => w.toLowerCase() === part.toLowerCase()) }));
}
