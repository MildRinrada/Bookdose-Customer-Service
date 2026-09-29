"""Tenant database: AI mode per conversation, the AI job queue, and which messages AI or the system wrote.
AI settings are rows in the organization's settings table (keys starting with ai_)."""

DEFAULT_MODEL = 'gpt-4.1-mini'
# draft: a reply for staff; bot: the chatbot's answer; test: the connection check; article: an article drafted from
# questions no article answers; brief: the overview's summary of today (the last two for an organization's owner);
# ask: a question to the staff's AI assistant (ai/assistant.py); mood: how a customer's latest message reads (ai/mood.py);
# summary: a conversation in a few points for the member taking it over (ai/summary.py); translate: a customer's message
# into Thai or the team's reply into the customer's language (ai/translate.py); polish: a member's own reply made
# more polite, shorter or free of typos before they send it (ai/polish.py); triage: the tags, priority and team a new
# case looks like it needs, for staff to confirm (ai/triage.py); gather: what the customer said for the case fields the
# chatbot asks for while they wait for a person (ai/gather.py).
JOB_MODES = ('draft','bot','test','article','brief','ask','mood','summary','translate','polish','triage','gather')
OWNER_MODES = ('article','brief')
# Jobs whose input was built when they were asked (the payload column), not read from a conversation.
PAYLOAD_MODES = (*OWNER_MODES,'ask')
# Background jobs nobody waits on, whose input is also in the payload column, checked only for their conversation.
BACKGROUND_MODES = ('mood','translate','triage','gather')
# Why a member marked an assistant's answer ไม่ถูกใจ (ai_feedback.reason): wrong facts, not what was asked, the proposed
# actions were wrong, hard to follow, something else.
FEEDBACK_REASONS = ('wrong','off_topic','actions','unclear','other')
FEEDBACK_COMMENT_MAX = 300

JOBS_TABLE = '''CREATE TABLE IF NOT EXISTS {name} (
    id TEXT PRIMARY KEY, conversation_id TEXT REFERENCES conversations(id),
    trigger_id TEXT REFERENCES messages(id), requested_by TEXT,
    mode TEXT NOT NULL CHECK(mode IN ('draft','bot','test','article','brief','ask','mood','summary','translate','polish','triage','gather')),
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
-- แปลภาษาอัตโนมัติ (ai/translate.py): the language replies go out in, as the customer last wrote; and per message its
-- Thai side - the translation of a customer's message, or the Thai a member wrote before it went out translated.
CREATE TABLE IF NOT EXISTS conversation_languages (
    conversation_id TEXT PRIMARY KEY, language TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS message_translations (
    message_id TEXT PRIMARY KEY, direction TEXT NOT NULL CHECK(direction IN ('in','out')), language TEXT NOT NULL DEFAULT '',
    thai TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('pending','done','failed')), job_id TEXT,
    error TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS message_translations_job ON message_translations(job_id);
CREATE INDEX IF NOT EXISTS message_translations_status ON message_translations(status);
CREATE TABLE IF NOT EXISTS ai_message_meta (
    message_id TEXT PRIMARY KEY REFERENCES messages(id),
    source TEXT NOT NULL CHECK(source IN ('ai','system')), citations TEXT NOT NULL DEFAULT '[]'
);
-- How each customer message read (ai/mood.py), kept after a later message changes the conversation's reading: the
-- service report's อารมณ์ลูกค้า counts a case whose customer was upset at any point. Levels only, no words.
CREATE TABLE IF NOT EXISTS conversation_mood_log (
    message_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, level INTEGER NOT NULL, urgent INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'words', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS conversation_mood_log_conversation ON conversation_mood_log(conversation_id);
-- เสนอป้ายและความเร่งด่วน (ai/triage.py): what the AI proposed for a new case, until a member uses it or sets it aside.
-- team_id '' and priority '' propose no change; tags is a JSON list of tag ids to add.
CREATE TABLE IF NOT EXISTS ticket_triage (
    ticket_id TEXT PRIMARY KEY, priority TEXT NOT NULL DEFAULT '', team_id TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]', reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK(status IN ('proposed','applied','dismissed')), decided_by TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);
-- Chatbot ถามข้อมูลก่อนถึงเจ้าหน้าที่ (ai/gather.py): the case fields asked for after a handoff, and how far it got.
CREATE TABLE IF NOT EXISTS conversation_gather (
    conversation_id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, fields TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL CHECK(status IN ('reading','asking','done','stopped')), rounds INTEGER NOT NULL DEFAULT 0,
    asked_rowid INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
-- ผู้ช่วย AI: what the member who asked thought of the answer (ai/assistant.py feedback); the owner reads the counts,
-- reasons and comments in the service report, never who wrote them.
CREATE TABLE IF NOT EXISTS ai_feedback (
    job_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, rating TEXT NOT NULL CHECK(rating IN ('up','down')),
    reason TEXT NOT NULL DEFAULT '', comment TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
);
'''

DEFAULT_SETTINGS = [
    ('ai_drafts','0'),('ai_chatbot','0'),('ai_model',DEFAULT_MODEL),
    ('ai_daily_limit','100'),('ai_conversation_limit','20'),('ai_max_output_tokens','1000'),
    ('ai_version','0'),
    # Read how customers feel with the AI (ai/mood.py) once it is connected; the words' reading runs regardless.
    ('ai_mood','1'),
    # Two-way translation for customers who do not write Thai (ai/translate.py): off until the owner turns it on.
    ('ai_translate','0'),
    # Propose the tags, priority and team of each new case (ai/triage.py): off until the owner turns it on.
    ('ai_triage','0')]
