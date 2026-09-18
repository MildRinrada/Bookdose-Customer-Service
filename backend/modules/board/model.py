"""The overview's board: handover notes one shift leaves for the next (the whole organization reads them) and each
member's own short to-do list.

  board_notes  (each organization's database) kind 'handover' or 'todo'. A handover note shows for HANDOVER_DAYS; a
               to-do is its author's alone, with an optional time, and shows until DONE_HOURS after it was ticked."""

KINDS = ('handover','todo')
BODY_MAX = 500
HANDOVER_DAYS = 3
HANDOVER_SHOWN = 20
DONE_HOURS = 24
OPEN_TODOS_MAX = 50

TENANT_TABLES = '''
CREATE TABLE IF NOT EXISTS board_notes (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('handover','todo')), user_id TEXT NOT NULL,
    author_name TEXT NOT NULL, body TEXT NOT NULL, due_at TEXT, done_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS board_notes_kind ON board_notes(kind,user_id,created_at);
'''
