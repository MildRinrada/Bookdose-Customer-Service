/* Shapes of the AI API (backend/modules/ai). Field names are the server's. */

/** A source the AI quoted (message.citations[], draft result citations[]). */
export type AiCitation = { title: string; quote: string; visibility?: 'public' | 'internal' | string } & Record<string, unknown>;

/** conversation.ai: who answers the customer now, and whether a bot answer is being prepared. */
export type AiState = { mode: 'human' | 'bot' | string; reason?: string; pending?: boolean };

/** The draft an agent asked for (job.result of a finished 'draft' job). */
export type AiDraftResult = { answer: string; summary: string; needs_human: boolean; citations: AiCitation[] };

/** Something the staff's assistant proposes to do, as the server checked it (ai/assistant_actions.py): ids, never the
    AI's own words for what it is, so the list says exactly what ทำเลย will do. */
export type AssistantAction = {
  type:
    | 'update_case'
    | 'tag_case'
    | 'snooze_case'
    | 'wake_case'
    | 'note'
    | 'reply'
    | 'retry_send'
    | 'auto_assign'
    | 'macro'
    | 'merge_customers'
    | 'set_fields';
  /** The case ("BD-12") and its id; a note or message to a chat on screen that is not a case has neither. */
  case?: string;
  subject?: string;
  ticket_id?: string | null;
  conversation_id?: string;
  changes?: { status?: string; priority?: string; team_id?: string; assignee_id?: string | null };
  add_tags?: string[];
  remove_tags?: string[];
  until?: string;
  text?: string;
  messages?: string[];
  enabled?: boolean;
  cap?: number;
  /** macro: the organization's macro as it was when the answer came. */
  macro_id?: string;
  macro?: { name: string; reply: boolean; set_status: string; followup_hours: number };
  /** merge_customers: the records, the one kept first, and how they match ('email', 'phone', 'name'). */
  keep?: string;
  merge?: string[];
  customers?: AssistantCustomer[];
  matched_by?: string[];
  /** set_fields: {case field id: value}, each checked against its field. */
  values?: Record<string, string>;
};

/** A customer record in a merge the assistant proposes (owners only). */
export type AssistantCustomer = { id: string; name: string; email: string; phone: string; cases: number; conversations: number };

/** What happened to each action picked when the member pressed ทำเลย; note: what it did not do (a macro's step). */
export type AssistantRunResult = { index: number; ok: boolean; error: string; note?: string };

/** ถูกใจ / ไม่ถูกใจ under an answer ('' = not rated), and why not. */
export type AssistantFeedback = { rating: 'up' | 'down' | ''; reason: string };

/** The assistant's answer (job.result of a finished 'ask' job). */
export type AssistantResult = {
  answer: string;
  citations: AiCitation[];
  actions?: AssistantAction[];
  /** Actions the AI proposed that pointed at something it was not shown, left out. */
  dropped?: number;
  /** Case number → id, for the cases the answer names that the member may open. */
  cases?: Record<string, string>;
  ran?: { at: string; results: AssistantRunResult[] };
};

/** Where a job stands while it waits or runs (ai/service.progress). */
export type AiJobProgress = {
  /** Jobs the worker does before this one (the one it is on now included); 0 once it runs. */
  ahead: number;
  waited_seconds: number;
  /** How long the AI has been at it; null while it waits. */
  running_seconds: number | null;
  provider: 'openai' | 'gemini' | 'n8n' | '';
  /** The most the call may take before the job fails and says so. */
  limit_seconds: number;
};

/** GET /api/ai/jobs/<id> */
export type AiJob = {
  id: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | string;
  result: AiDraftResult | Record<string, never>;
  error: string;
  input_tokens?: number;
  output_tokens?: number;
  progress?: AiJobProgress;
};

/** What the server gathered for an assistant question before queueing it (POST /api/ai/assistant). */
export type AssistantGathered = {
  cases: number;
  cases_not_listed: number;
  articles: number;
  /** "BD-12", "chat" for a chat on screen that is not a case, or "". */
  current: string;
  customers: number;
  members: number;
  channels: number;
  history: number;
};

/** GET /api/ai/settings (admins only). */
export type AiSettings = {
  drafts_enabled: boolean;
  chatbot_enabled: boolean;
  /** Read how customers feel with the AI (ai/mood.py); the reading by words runs either way. */
  mood_enabled: boolean;
  /** Two-way translation for customers who do not write Thai (ai/translate.py). */
  translate_enabled: boolean;
  /** Propose the tags, priority and team of each new case for staff to confirm (ai/triage.py). */
  triage_enabled: boolean;
  model: string;
  daily_limit: number;
  conversation_limit: number;
  max_output_tokens: number;
  version: string;
  /** Connected to an AI at all: an n8n webhook or an API key. */
  key_configured: boolean;
  /** An API key is saved (OpenAI or Gemini; the name is older than Gemini). */
  openai_key: boolean;
  /** Whose the saved key is, by its shape; '' when there is none. */
  key_provider: 'openai' | 'gemini' | '';
  /** Who answers: the organization's n8n workflow (when one is connected), otherwise the saved key's service. */
  provider: 'openai' | 'gemini' | 'n8n';
  /** The connected webhook's host, its whole URL, and the last 4 characters of its secret (to compare with n8n). */
  webhook_host: string;
  webhook_url: string;
  webhook_secret_end: string;
  usage: { requests: number; input_tokens: number; output_tokens: number };
};

/** The conversation fields the AI controls read. */
export type AiConversation = { id: string; channel: string; status: string; ai?: AiState | null };
