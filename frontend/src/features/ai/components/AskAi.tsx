'use client';

import { Icon } from '@/components/Icon';
import { askAi, PAGE_CHECK_QUESTION, problemQuestion, type SettingsHelpSection } from '../askAi';

/* ถาม AI on a settings page: the button beside the page's title asks the ผู้ช่วย AI to check the page as it is now,
   and the one beside a problem the page shows asks what it means and how to fix it; both are sent at once. Either way the page,
   its guide and what it holds now go with the question (backend ai/settings_help.py), never a key or a token; with no
   AI connected the assistant shows the page's guide instead. Markup: pages/ai-assistant.css (ask-ai). */

export function AskAiButton({ section }: { section: SettingsHelpSection }) {
  return (
    <button type="button" className="btn sm ask-ai" onClick={() => askAi({ section, question: PAGE_CHECK_QUESTION })}>
      <Icon name="sparkle" />
      ถาม AI
    </button>
  );
}

export function AskAiAbout({ section, problem }: { section: SettingsHelpSection; problem: string }) {
  return (
    <button type="button" className="ask-ai-about" onClick={() => askAi({ section, question: problemQuestion(problem) })}>
      <Icon name="sparkle" />
      ถาม AI ว่าแก้อย่างไร
    </button>
  );
}
