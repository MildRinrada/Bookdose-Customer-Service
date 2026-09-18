"""Staff invitations (control database). An organization's admin invites a colleague by email instead of choosing a
password on their behalf: the colleague opens the emailed link and sets their own password, so no password ever
travels through a chat message or a note on a desk.

One open invitation per email per organization (the unique index): inviting the same address again replaces the
link. A settled invitation (accepted or cancelled) stays as the organization's record of who let whom in.

The link is kept hashed, like every other link in the system, and lasts INVITE_DAYS days. Somebody who already has an
account joins by opening it too: the invitation adds the membership, and they sign in with the password they know."""

INVITE_DAYS = 7
RESEND_SECONDS = 60
LIST_LIMIT = 50
# A settled invitation is kept this long as the organization's record, then swept away.
KEEP_DAYS = 90

CONTROL_TABLES = '''
CREATE TABLE IF NOT EXISTS staff_invitations (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE,
    role TEXT NOT NULL, team_id TEXT NOT NULL DEFAULT '', invited_by TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_sent_at TEXT NOT NULL,
    expires_at TEXT NOT NULL, accepted_at TEXT, cancelled_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_invitations_open ON staff_invitations(tenant_id,email)
    WHERE accepted_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS staff_invitations_tenant ON staff_invitations(tenant_id,created_at);
'''
