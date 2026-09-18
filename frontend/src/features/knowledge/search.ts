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
  ['ใช้ไม่ได้', 'ผิดพลาด', 'ขัดข้อง', 'error', 'ไม่ได้'],
  ['รูปภาพ', 'รูป', 'ภาพ', 'image'],
];

type Idea = { words: string[] };

/** The ideas asked about: each a list of words any of which finds it. */
export function queryIdeas(query: string): Idea[] {
  const text = query
    .toLowerCase()
    .replace(/[?？!.,]/g, ' ')
    .replace(/\bhow (to|do i|can i)\b/g, ' ');
  const ideas: Idea[] = [];
  for (const chunk of text.split(/\s+/).filter(Boolean)) {
    // Thai is written without spaces: take the known words out of the chunk, the rest stays an idea of its own.
    let rest = trimAsking(chunk);
    for (const group of SYNONYMS) {
      const found = group.find((w) => rest.includes(w));
      if (!found) continue;
      ideas.push({ words: group });
      rest = rest.split(found).join(' ');
    }
    for (const left of rest.split(/\s+/)) if (left.length >= 2) ideas.push({ words: [left] });
  }
  return ideas;
}

export type SearchHit = { article: Article; score: number; words: string[]; passage: string };

const WEIGHT = { title: 4, category: 2, body: 1 };

/** The articles matching `query`, best first, each with the words that matched and its best sentence. An empty
    query (or only question words) answers null: show everything. */
export function searchArticles(articles: Article[], query: string): SearchHit[] | null {
  const ideas = queryIdeas(query);
  if (!ideas.length) return null;
  const phrase = query.trim().toLowerCase();
  const hits: SearchHit[] = [];
  for (const article of articles) {
    const title = article.title.toLowerCase();
    const category = article.category.toLowerCase();
    const body = plainText(article.body).toLowerCase();
    let score = 0;
    let met = 0;
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
      if (best) met += 1;
      score += best;
    }
    // Most of the ideas (all of one or two) must be there.
    if (met < Math.max(1, Math.ceil(ideas.length * 0.6))) continue;
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
