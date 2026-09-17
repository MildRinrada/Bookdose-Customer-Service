"""Support access: a platform admin asks to enter an organization, and only that organization's admins decide.

  support_requests  (control database) one request of one platform admin for one organization: why, for how long,
                    and what became of it.
      pending    asked; nobody can enter yet. Not decided within PENDING_HOURS, it lapses (status 'expired').
      approved   an admin of the organization said yes: the platform admin is a manager there until expires_at.
      denied     an admin said no.
      cancelled  the platform admin withdrew it before a decision.
      ended      the access was stopped before its time (by the organization's admins, or the platform admin).
      expired    the time ran out (or the request was never decided).

The membership an approval makes carries memberships.expires_at: every membership check ignores a row past that time,
so the access ends on the minute even before the worker tidies it up (active=0, the request 'expired', cases
unassigned). A permanent membership has expires_at NULL and is never touched by support access."""

STATUSES = ('pending','approved','denied','cancelled','ended','expired')
HOURS = (1,4,8,24,72)           # the lengths a platform admin may ask for
DEFAULT_HOURS = 4
PENDING_HOURS = 24              # a request nobody decides lapses after this
LIST_LIMIT = 50

CONTROL_TABLES = '''
CREATE TABLE IF NOT EXISTS support_requests (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT NOT NULL,
    hours INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','approved','denied','cancelled','ended','expired')),
    created_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT, note TEXT NOT NULL DEFAULT '',
    expires_at TEXT, ended_at TEXT, ended_by TEXT
);
CREATE INDEX IF NOT EXISTS support_requests_tenant ON support_requests(tenant_id,created_at);
CREATE INDEX IF NOT EXISTS support_requests_open ON support_requests(status,expires_at);
'''
