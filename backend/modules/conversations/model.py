"""Tenant database: conversations (web, LINE, Email or recorded by staff), their messages and attachment records.
Attachment contents are files in data/files/<tenant id>/<storage key>."""

CHANNELS = ('web','line','email','manual')
MESSAGE_KINDS = ('customer','reply','note')

TENANT_TABLES = '''
CREATE TABLE conversations (
    id TEXT PRIMARY KEY, contact_id TEXT NOT NULL REFERENCES contacts(id),
    subject TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'web',
    team_id TEXT NOT NULL REFERENCES teams(id), status TEXT NOT NULL DEFAULT 'open',
    portal_token TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE messages (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id),
    author_id TEXT, author_name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('customer','reply','note')),
    body TEXT NOT NULL, delivery TEXT NOT NULL DEFAULT 'stored', created_at TEXT NOT NULL
);
CREATE TABLE attachments (
    id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id),
    name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, storage_key TEXT NOT NULL
);
CREATE INDEX messages_conversation ON messages(conversation_id,created_at);
CREATE INDEX conversations_team ON conversations(team_id,updated_at);
'''
