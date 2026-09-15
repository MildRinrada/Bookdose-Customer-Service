"""Customer accounts. One account works with every organization on the platform: the customer signs up once - the
name they like to be called, an email, a password, a phone number if they want, and consent to the privacy notice -
and then contacts any organization they are connected with. The platform's own organization (Bookdose) is always
one of them; another joins by signing up from that organization's link, by its code, or by a first chat with it.

Control database: the accounts, sign-ups waiting for their email to be confirmed (one row per attempt, each with its
own link; confirming asks for the password chosen in that attempt), password-reset links, sessions, and which
organizations each account is connected with. Before the platform can send email, a sign-up becomes an account at
once with email_verified=0: it works, but its email was never proven, so no earlier conversations are attached and no
notices are emailed to it.

Each organization's database keeps what the account is there: its own contact (customer_members), every contact whose
web conversations the account may read (customer_contacts), what the customer has read, the reply notices waiting
to be emailed, and the category the customer chose for a conversation. Staff of one organization never see another's."""

CONSENT_VERSION = '2026-09'

# What a customer can choose when starting a chat, until the organization sets its own (ตั้งค่าองค์กร).
DEFAULT_CATEGORIES = [{'name':'สอบถามบริการ','team_id':''},{'name':'แจ้งปัญหาการใช้งาน','team_id':''},
                      {'name':'สอบถามเรื่องการชำระเงิน','team_id':''}]

CONTROL_TABLES = '''
CREATE TABLE IF NOT EXISTS customer_accounts (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT NOT NULL DEFAULT '',
    password TEXT NOT NULL, consent_version TEXT NOT NULL, consent_at TEXT NOT NULL, verified_at TEXT NOT NULL,
    created_at TEXT NOT NULL, last_login_at TEXT, email_verified INTEGER NOT NULL DEFAULT 1,
    notify_email INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS customer_signups (
    token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
    password TEXT NOT NULL, consent_version TEXT NOT NULL, consent_at TEXT NOT NULL,
    expires_at TEXT NOT NULL, created_at TEXT NOT NULL, tenant_id TEXT
);
CREATE TABLE IF NOT EXISTS customer_resets (
    token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_sessions (
    token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, csrf TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_orgs (
    account_id TEXT NOT NULL, tenant_id TEXT NOT NULL, joined_at TEXT NOT NULL, PRIMARY KEY(account_id,tenant_id)
);
CREATE INDEX IF NOT EXISTS customer_signups_email ON customer_signups(email,created_at);
'''

TENANT_TABLES = '''
CREATE TABLE IF NOT EXISTS customer_members (
    account_id TEXT PRIMARY KEY, contact_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_contacts (
    account_id TEXT NOT NULL, contact_id TEXT NOT NULL, PRIMARY KEY(account_id,contact_id)
);
CREATE TABLE IF NOT EXISTS customer_seen (
    account_id TEXT NOT NULL, conversation_id TEXT NOT NULL, seen_at TEXT NOT NULL, PRIMARY KEY(account_id,conversation_id)
);
CREATE TABLE IF NOT EXISTS customer_notifications (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, conversation_id TEXT NOT NULL, created_at TEXT NOT NULL,
    sent_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS conversation_categories (
    conversation_id TEXT PRIMARY KEY, category TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS customer_contacts_contact ON customer_contacts(contact_id);
CREATE INDEX IF NOT EXISTS customer_notifications_pending ON customer_notifications(sent_at,created_at);
'''
