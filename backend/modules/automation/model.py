"""Tenant database: routing rules, SLA escalation, macros and their follow-up reminders, CSAT surveys,
@mentions in internal notes, and when each member was last active (for the live agent monitor).
Rows point at cases and conversations by id without foreign keys, so deleting a case never fails because of them;
queries join on the case, so rows of a deleted case simply stop showing."""

CHANNELS = ('web','line','email','facebook','instagram','manual')
RULE_CHANNELS = ('',)+CHANNELS                                  # '' = any channel
MACRO_STATUSES = ('','open','pending_customer','pending_internal','resolved','closed')   # '' = keep the status

TENANT_TABLES = '''
CREATE TABLE IF NOT EXISTS automation_rules (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
    channel TEXT NOT NULL DEFAULT '', keywords TEXT NOT NULL DEFAULT '',
    set_priority TEXT NOT NULL DEFAULT '', set_team_id TEXT NOT NULL DEFAULT '', set_assignee_id TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS macros (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, reply TEXT NOT NULL DEFAULT '', set_status TEXT NOT NULL DEFAULT '',
    followup_hours REAL NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS followups (
    id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, due_at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL, user_name TEXT NOT NULL, created_at TEXT NOT NULL, done_at TEXT
);
CREATE TABLE IF NOT EXISTS escalations (
    ticket_id TEXT PRIMARY KEY, reason TEXT NOT NULL, from_user_id TEXT, to_user_id TEXT, escalated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS csat_surveys (
    id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, conversation_id TEXT NOT NULL, message_id TEXT,
    rating INTEGER CHECK(rating BETWEEN 1 AND 5), sent_at TEXT NOT NULL, answered_at TEXT, comment TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS mentions (
    id TEXT PRIMARY KEY, message_id TEXT NOT NULL, conversation_id TEXT NOT NULL, user_id TEXT NOT NULL,
    author_name TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT
);
CREATE TABLE IF NOT EXISTS agent_activity (user_id TEXT PRIMARY KEY, last_seen TEXT NOT NULL);
-- A case forecast to miss a deadline (forecast.py), told once per deadline: to whom, and what was expected then.
CREATE TABLE IF NOT EXISTS sla_forecast_alerts (
    ticket_id TEXT NOT NULL, kind TEXT NOT NULL, due_at TEXT NOT NULL, to_user_id TEXT, expected_at TEXT NOT NULL,
    late_minutes INTEGER NOT NULL, alerted_at TEXT NOT NULL, PRIMARY KEY(ticket_id,kind,due_at)
);
CREATE INDEX IF NOT EXISTS sla_forecast_to ON sla_forecast_alerts(to_user_id,due_at);
CREATE INDEX IF NOT EXISTS followups_open ON followups(done_at,due_at);
CREATE INDEX IF NOT EXISTS csat_conversation ON csat_surveys(conversation_id,answered_at);
CREATE INDEX IF NOT EXISTS mentions_user ON mentions(user_id,read_at);
'''

# Inserted once per organization (existing values are never overwritten).
DEFAULT_SETTINGS = [
    ('escalation_enabled','1'),('escalation_minutes','15'),('csat_enabled','1'),
    ('csat_message','ขอบคุณที่ใช้บริการค่ะ 🙏 ช่วยให้คะแนนความพึงพอใจกับการดูแลครั้งนี้ โดยตอบกลับเป็นตัวเลข 1-5\n'
                    '5 = พอใจมาก · 4 = พอใจ · 3 = เฉย ๆ · 2 = ไม่ค่อยพอใจ · 1 = ไม่พอใจ'),
]
