"""เอกสารกฎหมาย: the platform's terms of service and privacy notices, written in Markdown by a platform admin and
published in versions, so that what somebody agreed to is always the exact text they saw.

  legal_documents   every published version of each document (key + version), never changed once published.
  legal_drafts      the one draft of each document the console is editing, published into legal_documents.
  legal_acceptances who agreed to which version of what, and when: an organization admin to the terms when
                    signing up (tenant_id filled in once the organization exists), a customer to the customer
                    privacy notice (customer_accounts.consent_version keeps that one as well)."""

CONTROL_TABLES = '''
CREATE TABLE IF NOT EXISTS legal_documents (
    key TEXT NOT NULL, version TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
    published_at TEXT NOT NULL, published_by TEXT NOT NULL,
    PRIMARY KEY(key, version)
);
CREATE TABLE IF NOT EXISTS legal_drafts (
    key TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS legal_acceptances (
    id TEXT PRIMARY KEY, document TEXT NOT NULL, version TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE,
    tenant_id TEXT, accepted_at TEXT NOT NULL, ip TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS legal_acceptances_email ON legal_acceptances(email);
'''

# The documents there are, in the order the console shows them. The customer notice is the organization's words to
# its customers: {{องค์กร}} in it becomes the organization's name wherever it is shown.
DOCUMENTS = (
    ('terms', 'ข้อตกลงการใช้บริการ'),
    ('platform-privacy', 'ประกาศความเป็นส่วนตัวสำหรับผู้ใช้งานระบบ'),
    ('customer-privacy', 'ประกาศความเป็นส่วนตัวสำหรับลูกค้าขององค์กร'),
)
KEYS = tuple(key for key, _ in DOCUMENTS)
# The version the first drafts (drafts/*.md) carry; a document published from the console gets the month it was
# published in, and a second one in the same month a count after it (2026-11, 2026-11.2, ...).
FIRST_VERSION = '2026-10'
BODY_MAX = 200000
