"""Organization join links (control database, so a customer who is not in the organization yet reaches it by the
link). A join link is as public as the organization's code, so its token is kept as it is (to draw its QR again);
what limits it is its expiry, its number of uses and revoking it (the row stays as history).
org_join_uses: the accounts that used a link, each counted once however often it opens the link."""

CONTROL_TABLES = '''
CREATE TABLE IF NOT EXISTS org_join_links (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE, label TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT, max_uses INTEGER,
    uses INTEGER NOT NULL DEFAULT 0, revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS org_join_links_tenant ON org_join_links(tenant_id,created_at);
CREATE TABLE IF NOT EXISTS org_join_uses (
    link_id TEXT NOT NULL, account_id TEXT NOT NULL, joined_at TEXT NOT NULL, PRIMARY KEY(link_id,account_id)
);'''
