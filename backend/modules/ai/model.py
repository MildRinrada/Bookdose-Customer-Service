"""Tenant database: AI mode per conversation, the AI job queue, and which messages AI or the system wrote.
AI settings are rows in the organization's settings table (keys starting with ai_)."""

DEFAULT_MODEL = 'gpt-4.1-mini'
# draft: a reply for staff; bot: the chatbot's answer; test: the connection check; article: an article drafted from
# questions no article answers; brief: the overview's summary of today (the last two for an organization's owner);
# ask: a question to the staff's AI assistant (ai/assistant.py); mood: how a customer's latest message reads (ai/mood.py);
# summary: a conversation in a few points for the member taking it over (ai/summary.py).
JOB_MODES = ('draft','bot','test','article','brief','ask','mood','summary')
OWNER_MODES = ('article','brief')
# Jobs whose input was built when they were asked (the payload column), not read from a conversation.
PAYLOAD_MODES = (*OWNER_MODES,'ask')

JOBS_TABLE = '''CREATE TABLE IF NOT EXISTS {name} (
    id TEXT PRIMARY KEY, conversation_id TEXT REFERENCES conversations(id),
    trigger_id TEXT REFERENCES messages(id), requested_by TEXT,
    mode TEXT NOT NULL CHECK(mode IN ('draft','bot','test','article','brief','ask','mood','summary')),
    status TEXT NOT NULL CHECK(status IN ('pending','running','done','failed','cancelled')),
    result TEXT NOT NULL DEFAULT '{{}}', error TEXT NOT NULL DEFAULT '',
    lease TEXT, config_version TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{{}}'
);'''

TENANT_TABLES = '''
CREATE TABLE IF NOT EXISTS ai_conversations (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),
    mode TEXT NOT NULL CHECK(mode IN ('human','bot')),
    reason TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
);
'''+JOBS_TABLE.format(name='ai_jobs')+'''
CREATE UNIQUE INDEX IF NOT EXISTS ai_bot_trigger ON ai_jobs(trigger_id) WHERE mode='bot';
CREATE INDEX IF NOT EXISTS ai_jobs_pending ON ai_jobs(status,created_at);
-- How the customer's latest message reads (ai/mood.py): 0 ปกติ, 1 ไม่พอใจ, 2 โกรธมาก; urgent; by its words or by the AI.
CREATE TABLE IF NOT EXISTS conversation_moods (
    conversation_id TEXT PRIMARY KEY, level INTEGER NOT NULL DEFAULT 0, urgent INTEGER NOT NULL DEFAULT 0,
    reason TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'words', message_id TEXT, updated_at TEXT NOT NULL
);
-- สรุปบทสนทนา (ai/summary.py): the kept summary, and the last message it covers (by rowid) so only newer ones are sent.
CREATE TABLE IF NOT EXISTS conversation_summaries (
    conversation_id TEXT PRIMARY KEY, wants TEXT NOT NULL, tried TEXT NOT NULL, pending TEXT NOT NULL,
    last_rowid INTEGER NOT NULL DEFAULT 0, message_count INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_message_meta (
    message_id TEXT PRIMARY KEY REFERENCES messages(id),
    source TEXT NOT NULL CHECK(source IN ('ai','system')), citations TEXT NOT NULL DEFAULT '[]'
);
'''

DEFAULT_SETTINGS = [
    ('ai_drafts','0'),('ai_chatbot','0'),('ai_model',DEFAULT_MODEL),
    ('ai_daily_limit','100'),('ai_conversation_limit','20'),('ai_max_output_tokens','1000'),
    ('ai_version','0'),
    # Read how customers feel with the AI (ai/mood.py) once it is connected; the words' reading runs regardless.
    ('ai_mood','1')]
