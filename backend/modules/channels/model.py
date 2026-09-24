"""LINE, Email and Facebook Messenger channels.
Control database: channel_routes maps a LINE bot / mailbox to its organization (one account belongs to one organization);
facebook_routes does the same for a Facebook Page. Facebook keeps its own settings row; its replies share the outbox.
Tenant database: settings, received events (inbox), replies waiting to be delivered (outbox), and per-conversation links."""

KINDS = ('line','email')

CONTROL_TABLES = '''
CREATE TABLE IF NOT EXISTS channel_routes (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
    kind TEXT NOT NULL CHECK(kind IN ('line','email')), identity TEXT,
    UNIQUE(tenant_id,kind), UNIQUE(kind,identity)
);
CREATE TABLE IF NOT EXISTS facebook_routes (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), page_id TEXT UNIQUE
);
'''

TENANT_TABLES = '''
CREATE TABLE IF NOT EXISTS oauth_refresh (kind TEXT PRIMARY KEY,lease TEXT NOT NULL,expires_at REAL NOT NULL);
-- คุยต่อใน LINE (channels/move.py): a 6-digit code a customer sends to the organization's LINE to carry a web chat
-- there (hashed, 10 minutes, the same limits as the notice codes), and the chats that went.
CREATE TABLE IF NOT EXISTS line_move_codes (
    code_hash TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversation_moves (
    conversation_id TEXT PRIMARY KEY, line_user_id TEXT NOT NULL, moved_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS line_threads (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id), source_type TEXT NOT NULL,
    source_id TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, last_event_time TEXT
);
CREATE TABLE IF NOT EXISTS channel_file_links (
    token_hash TEXT PRIMARY KEY,attachment_id TEXT NOT NULL REFERENCES attachments(id),
    message_id TEXT NOT NULL REFERENCES messages(id),expires_at TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS channel_outbox_payload (outbox_id TEXT PRIMARY KEY REFERENCES channel_outbox(id),payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS channel_ai_guard (
    message_id TEXT PRIMARY KEY REFERENCES messages(id),job_id TEXT,config_version TEXT NOT NULL,
    signature TEXT,trigger_id TEXT,notice INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS channel_settings (
    kind TEXT PRIMARY KEY CHECK(kind IN ('line','email')), route_id TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 0, config TEXT NOT NULL DEFAULT '{}',
    generation TEXT NOT NULL, last_error TEXT NOT NULL DEFAULT '', last_checked TEXT,
    last_received TEXT, next_poll TEXT, poll_lease TEXT, poll_started TEXT,
    uidvalidity TEXT, last_uid INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS channel_conversations (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id), route_id TEXT NOT NULL,
    external_key TEXT NOT NULL, recipient TEXT NOT NULL, account_identity TEXT NOT NULL,
    last_event_time TEXT, UNIQUE(route_id,external_key)
);
CREATE TABLE IF NOT EXISTS channel_inbox (
    id TEXT PRIMARY KEY, route_id TEXT NOT NULL, event_key TEXT NOT NULL,
    kind TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}', generation TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', error TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0,
    lease TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(route_id,event_key)
);
CREATE TABLE IF NOT EXISTS channel_outbox (
    id TEXT PRIMARY KEY, message_id TEXT NOT NULL UNIQUE REFERENCES messages(id),
    route_id TEXT NOT NULL, kind TEXT NOT NULL, actor_id TEXT NOT NULL,
    generation TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0, retry_key TEXT NOT NULL, provider_id TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '', lease TEXT, first_attempt_at TEXT, next_attempt_at TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS email_reply_refs (
    reference TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), route_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS facebook_settings (
    id INTEGER PRIMARY KEY CHECK(id=1), route_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
    config TEXT NOT NULL DEFAULT '{}', generation TEXT NOT NULL, last_error TEXT NOT NULL DEFAULT '',
    last_checked TEXT, last_received TEXT
);
CREATE INDEX IF NOT EXISTS channel_outbox_pending ON channel_outbox(status,next_attempt_at);
CREATE INDEX IF NOT EXISTS channel_inbox_pending ON channel_inbox(status,created_at);
'''
