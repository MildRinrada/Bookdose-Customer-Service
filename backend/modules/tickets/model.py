"""Tenant database: cases (tickets) and the conversations linked to them."""

STATUSES = ('new','open','pending_customer','pending_internal','resolved','closed')
PRIORITIES = ('low','normal','high','urgent')

TENANT_TABLES = '''
CREATE TABLE tickets (
    id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, subject TEXT NOT NULL,
    contact_id TEXT NOT NULL REFERENCES contacts(id), team_id TEXT NOT NULL REFERENCES teams(id),
    assignee_id TEXT, priority TEXT NOT NULL CHECK(priority IN ('low','normal','high','urgent')),
    status TEXT NOT NULL CHECK(status IN ('new','open','pending_customer','pending_internal','resolved','closed')),
    category TEXT NOT NULL DEFAULT 'ทั่วไป', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    first_response_due_at TEXT NOT NULL, resolution_due_at TEXT NOT NULL,
    first_response_at TEXT, resolved_at TEXT
);
CREATE TABLE ticket_conversations (
    ticket_id TEXT NOT NULL REFERENCES tickets(id), conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id),
    PRIMARY KEY(ticket_id,conversation_id)
);
CREATE INDEX tickets_team ON tickets(team_id,status);
'''

# พักเคสไว้ก่อน. A case waiting on something outside the team - the customer's slip, a supplier, tomorrow morning -
# is not work anybody can do now, but it sits in the queue all the same and everything beside it has to be read past
# it. Pausing it takes it out of the working lists until the moment it is worth looking at again, and then puts it
# back on its own. The deadline is not touched while it sleeps: the promise made to the customer is the customer's,
# not something the team can move by stepping away from it. What a pause does is stop the reminders nobody can act
# on, and hand the case back at a time somebody can.
SNOOZE_MAX_DAYS = 90
SNOOZE_NOTE_MAX = 200
SNOOZE_COLUMNS = (('snoozed_until','TEXT'),('snooze_note',"TEXT NOT NULL DEFAULT ''"),('snoozed_by',"TEXT NOT NULL DEFAULT ''"))
SNOOZE_INDEX = 'CREATE INDEX IF NOT EXISTS tickets_snoozed ON tickets(snoozed_until)'

# Each time a resolved or closed case went back to work (the report's reopen rate), and what sent it back: the
# customer wrote again, a member of staff changed its status, or the chatbot handed its chat to a person. The rows
# outlive a deleted case, so a case put back from the bin keeps its history.
REOPEN_CAUSES = ('customer','staff','handoff')
REOPENS_TABLE = '''
CREATE TABLE IF NOT EXISTS ticket_reopens (
    id INTEGER PRIMARY KEY, ticket_id TEXT NOT NULL, cause TEXT NOT NULL, reopened_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ticket_reopens_ticket ON ticket_reopens(ticket_id,reopened_at);
'''
