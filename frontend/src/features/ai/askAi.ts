/* ถาม AI on a settings page (backend ai/settings_help.py): the page the question comes from, and the way any button on a
   page hands a question to the ผู้ช่วย AI (components/AiAssistant listens for ASK_AI_EVENT). */

/** The pages with a guide, as the address names them: /settings?tab=<section>, or the automation screen. */
export const SETTINGS_HELP_SECTIONS = ['line', 'email', 'facebook', 'ai', 'automation', 'webchat', 'service', 'backup', 'security'] as const;
export type SettingsHelpSection = (typeof SETTINGS_HELP_SECTIONS)[number];

/** GET /api/ai/settings-help/<section> */
export type SettingsHelp = {
  section: SettingsHelpSection;
  title: string;
  questions: string[];
  guide: string;
  /** The outside service's own steps (Meta's for Facebook), from its documentation and dated; '' when none. */
  reference: string;
};

export const settingsHelpPath = (section: SettingsHelpSection) => `/api/ai/settings-help/${section}`;

/** The settings page an address is, or null. */
export function settingsHelpOf(pathname: string | null, search: string): SettingsHelpSection | null {
  if (pathname === '/automation' || pathname?.startsWith('/automation/')) return 'automation';
  if (pathname !== '/settings') return null;
  const tab = new URLSearchParams(search).get('tab') ?? '';
  return (SETTINGS_HELP_SECTIONS as readonly string[]).includes(tab) ? (tab as SettingsHelpSection) : null;
}

/** The settings page open now (read when it is needed: the address changes without the assistant being drawn again). */
export function settingsHelpHere(): SettingsHelpSection | null {
  return typeof window === 'undefined' ? null : settingsHelpOf(window.location.pathname, window.location.search);
}

export const ASK_AI_EVENT = 'bookdose:ask-ai';
/** section: the page the button is on (/settings alone opens the section used last, so the address may not say);
    question: asked at once, and without one the assistant opens on the page's own questions. */
export type AskAiRequest = { section?: SettingsHelpSection; question?: string };

export function askAi(request: AskAiRequest = {}) {
  window.dispatchEvent(new CustomEvent<AskAiRequest>(ASK_AI_EVENT, { detail: request }));
}

/** What ถาม AI beside a page's title asks at once: the page checked as it is now, which is what someone pressing it
    on a settings page wants first (the page's other questions are offered under the answer). */
export const PAGE_CHECK_QUESTION = 'ช่วยตรวจการตั้งค่าหน้านี้ให้หน่อย ตอนนี้ครบหรือยัง มีอะไรที่ยังไม่ทำงาน และควรทำอะไรต่อ';

/** What a problem shown on the page asks. */
export const problemQuestion = (problem: string) => `หน้านี้ขึ้นว่า "${problem}" หมายความว่าอะไร และต้องแก้อย่างไร`;
