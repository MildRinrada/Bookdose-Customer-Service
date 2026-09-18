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
TENANT_TABLES = '''
CREATE TABLE teams(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO settings VALUES('response_hours','4'),('resolution_hours','24'),
    ('welcome','ยินดีต้อนรับ ทีมงานพร้อมช่วยเหลือคุณ'),
    ('canned_reply','สวัสดีค่ะ ขอบคุณที่ติดต่อเข้ามา ทีมงานรับเรื่องและกำลังตรวจสอบให้นะคะ');
'''
