"""Tenant database: AI mode per conversation, the AI job queue, and which messages AI or the system wrote.
AI settings are rows in the organization's settings table (keys starting with ai_)."""

DEFAULT_MODEL = 'gpt-4.1-mini'
JOB_MODES = ('draft','bot','test')

TENANT_TABLES = '''
CREATE TABLE IF NOT EXISTS ai_conversations (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),
    mode TEXT NOT NULL CHECK(mode IN ('human','bot')),
    reason TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_jobs (
    id TEXT PRIMARY KEY, conversation_id TEXT REFERENCES conversations(id),
    trigger_id TEXT REFERENCES messages(id), requested_by TEXT,
    mode TEXT NOT NULL CHECK(mode IN ('draft','bot','test')),
    status TEXT NOT NULL CHECK(status IN ('pending','running','done','failed','cancelled')),
    result TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '',
    lease TEXT, config_version TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_bot_trigger ON ai_jobs(trigger_id) WHERE mode='bot';
CREATE INDEX IF NOT EXISTS ai_jobs_pending ON ai_jobs(status,created_at);
CREATE TABLE IF NOT EXISTS ai_message_meta (
    message_id TEXT PRIMARY KEY REFERENCES messages(id),
    source TEXT NOT NULL CHECK(source IN ('ai','system')), citations TEXT NOT NULL DEFAULT '[]'
);
'''

DEFAULT_SETTINGS = [
    ('ai_drafts','0'),('ai_chatbot','0'),('ai_model',DEFAULT_MODEL),
    ('ai_daily_limit','100'),('ai_conversation_limit','20'),('ai_max_output_tokens','1000'),
    ('ai_version','0')]
