"""Organization membership (control database), and teams and settings (tenant database).

An organization has two roles: its owners ('admin', shown as เจ้าขององค์กร: they run the organization - members,
settings, channels, automation - and see every team; one or more, never none) and its agents ('agent', เจ้าหน้าที่:
they answer customers in their own team). The team lead role ('manager') was taken out: the table still accepts the
word so old rows can be read, and start-up turns them into agents (database/schema.py)."""

ROLES = ('admin','agent')

CONTROL_TABLES = '''
CREATE TABLE IF NOT EXISTS memberships (
    tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL CHECK(role IN ('admin','manager','agent')), team_id TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(tenant_id,user_id)
);
'''

# Settings are key/value rows; the defaults below are inserted for every new organization.
# 'canned_reply' held the organization's one prepared reply. It is now the first row of team_snippets below, and
# database/schema.py moves a saved one across on start-up; the setting is kept (emptied) so older backups still read.
TENANT_TABLES = '''
CREATE TABLE teams(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '');
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO settings VALUES('response_hours','4'),('resolution_hours','24'),
    ('welcome','ยินดีต้อนรับ ทีมงานพร้อมช่วยเหลือคุณ'),
    ('canned_reply','สวัสดีค่ะ ขอบคุณที่ติดต่อเข้ามา ทีมงานรับเรื่องและกำลังตรวจสอบให้นะคะ');
'''

# คำตอบสำเร็จรูปของทีม: prepared texts anyone in the organization can put into a reply and then edit before sending.
# The line between these and a Macro is what happens on the click: a snippet writes into the draft, a macro sends and
# moves the case on (backend/modules/automation). Each has a shortcut, typed as /<shortcut> in the reply box.
MAX_TEAM_SNIPPETS = 50
TEAM_SNIPPET_MAX = 3000
TEAM_SNIPPETS_TABLE = '''
CREATE TABLE IF NOT EXISTS team_snippets(
    id TEXT PRIMARY KEY, shortcut TEXT NOT NULL UNIQUE, text TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0
);
'''
