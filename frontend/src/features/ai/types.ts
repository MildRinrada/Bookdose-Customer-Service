/* Shapes of the AI API (backend/modules/ai). Field names are the server's. */

/** A source the AI quoted (message.citations[], draft result citations[]). */
export type AiCitation = { title: string; quote: string; visibility?: 'public' | 'internal' | string } & Record<string, unknown>;

/** conversation.ai: who answers the customer now, and whether a bot answer is being prepared. */
export type AiState = { mode: 'human' | 'bot' | string; reason?: string; pending?: boolean };

/** The draft an agent asked for (job.result of a finished 'draft' job). */
export type AiDraftResult = { answer: string; summary: string; needs_human: boolean; citations: AiCitation[] };

/** GET /api/ai/jobs/<id> */
export type AiJob = {
  id: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | string;
  result: AiDraftResult | Record<string, never>;
  error: string;
  input_tokens?: number;
  output_tokens?: number;
};

/** GET /api/ai/settings (admins only). */
export type AiSettings = {
  drafts_enabled: boolean;
  chatbot_enabled: boolean;
  /** Read how customers feel with the AI (ai/mood.py); the reading by words runs either way. */
  mood_enabled: boolean;
  /** Two-way translation for customers who do not write Thai (ai/translate.py). */
  translate_enabled: boolean;
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
