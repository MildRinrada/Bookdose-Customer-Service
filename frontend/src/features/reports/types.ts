/* The report is built in the browser from GET /api/tickets; these are its own shapes. */

import type { CaseStats } from '@/features/tickets/types';

/** The period and filters (kept per session). `days` is the chosen quick range, 0 when dates were typed. */
export type ReportFilter = { from: string; to: string; team: string; assignee: string; days: number };

export type ReportMetrics = { total: number; open: number; late: number; avg: number | null; median: number | null; sla: number | null };

/** GET /api/reports/extras (backend/modules/reports): what the case list cannot tell, for the same dates. `bot` and
    `articles` for the organization's admins, `gaps` for its owners (not support access); null otherwise. */
export type ReportExtras = {
  hours: { counts: number[][]; total: number };
  bot: ReportBot | null;
  articles: ReportArticles | null;
  gaps: { total: number; groups: Array<{ label: string; count: number; last_at: string }> } | null;
  ai: { drafts_enabled: boolean; chatbot_enabled: boolean; key_configured: boolean } | null;
  assistant: ReportAssistant | null;
  /** The cases touched in the period or the one before it: next-reply waits, replies, upset (stats.py). */
  case_stats?: Record<string, CaseStats>;
};

/** The staff's AI assistant in the period (questions asked in it): answers, proposals done, and what the members who
    asked thought (never who). */
export type ReportAssistant = {
  asked: number;
  answered: number;
  failed: number;
  /** Answers that proposed something to do, and those whose proposals were done (ทำเลย). */
  proposed: number;
  ran: number;
  people: number;
  up: number;
  down: number;
  /** Why not liked ('unsaid' when no reason was picked), most first. */
  reasons: Array<{ reason: string; count: number }>;
  /** The latest comments with ไม่ถูกใจ. */
  comments: Array<{ reason: string; comment: string; updated_at: string }>;
};

export type ReportBot = {
  conversations: number;
  resolved: number;
  handed_off: number;
  waiting: number;
  answers: number;
  reasons: Array<{ reason: string; count: number }>;
  /** Only the days the chatbot talked to someone (local dates). */
  days: Array<{ day: string; resolved: number; handed_off: number; waiting: number }>;
};

export type ReportArticle = {
  id: string;
  title: string;
  category: string;
  uses: number;
  copied: number;
  inserted: number;
  linked: number;
  people: number;
  helpful: number;
  unhelpful: number;
};

export type ReportArticles = {
  top: ReportArticle[];
  unhelpful: Array<{ id: string; title: string; category: string; updated_at: string; helpful: number; unhelpful: number }>;
  uses: number;
  used_articles: number;
  articles: number;
};
