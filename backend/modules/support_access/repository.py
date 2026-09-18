"""Queries of support access (control database)."""
from backend.database.db import one, rows
from backend.modules.support_access.model import LIST_LIMIT
from backend.utils.dates import now


def add_membership_expiry(db):
    """memberships.expires_at (NULL: permanent). Older databases get the column; nothing else changes."""
    if 'expires_at' not in {row[1] for row in db.execute('PRAGMA table_info(memberships)')}:
        db.execute('ALTER TABLE memberships ADD COLUMN expires_at TEXT')
        db.commit()


def insert(cd, request_id, tenant_id, user_id, reason, hours):
    cd.execute('INSERT INTO support_requests(id,tenant_id,user_id,reason,hours,created_at) VALUES(?,?,?,?,?,?)',
               (request_id,tenant_id,user_id,reason,hours,now()))


def find(cd, request_id):
    return one(cd,'''SELECT r.*,u.name AS user_name,u.email AS user_email,t.name AS tenant_name
                     FROM support_requests r JOIN users u ON u.id=r.user_id JOIN tenants t ON t.id=r.tenant_id
                     WHERE r.id=?''',(request_id,))


def open_request(cd, tenant_id, user_id):
    """The platform admin's request that is still waiting or still in force for this organization."""
    return one(cd,'''SELECT * FROM support_requests WHERE tenant_id=? AND user_id=?
                     AND (status='pending' OR (status='approved' AND expires_at>?)) ORDER BY created_at DESC LIMIT 1''',
               (tenant_id,user_id,now()))


def of_tenant(cd, tenant_id):
    return rows(cd,f'''SELECT r.*,u.name AS user_name,u.email AS user_email,d.name AS decided_by_name,e.name AS ended_by_name
                      FROM support_requests r JOIN users u ON u.id=r.user_id
                      LEFT JOIN users d ON d.id=r.decided_by LEFT JOIN users e ON e.id=r.ended_by
                      WHERE r.tenant_id=? ORDER BY r.created_at DESC LIMIT {LIST_LIMIT}''',(tenant_id,))


def open_of_user(cd, user_id):
    """The platform admin's requests that are waiting or in force, one per organization at most."""
    return rows(cd,'''SELECT * FROM support_requests WHERE user_id=? AND (status='pending' OR (status='approved' AND expires_at>?))
                      ORDER BY created_at DESC''',(user_id,now()))


def recent_of_user(cd, user_id, since):
    """The platform admin's requests still waiting, in force, or answered since then (the console's bell)."""
    return rows(cd,'''SELECT r.*,t.name AS tenant_name,d.name AS decided_by_name
                      FROM support_requests r JOIN tenants t ON t.id=r.tenant_id LEFT JOIN users d ON d.id=r.decided_by
                      WHERE r.user_id=? AND (r.status='pending' OR (r.status='approved' AND r.expires_at>?)
                                             OR (r.status IN ('denied','expired') AND COALESCE(r.ended_at,r.decided_at)>?))
                      ORDER BY COALESCE(r.decided_at,r.created_at) DESC''',(user_id,now(),since))


def pending_count(cd, tenant_id):
    return cd.execute("SELECT COUNT(*) FROM support_requests WHERE tenant_id=? AND status='pending'",(tenant_id,)).fetchone()[0]


def decide(cd, request_id, status, user_id, note, expires_at=None):
    """Approve or deny a request that is still pending; 0 rows when someone decided it first."""
    return cd.execute('''UPDATE support_requests SET status=?,decided_at=?,decided_by=?,note=?,expires_at=?
                         WHERE id=? AND status='pending' ''',(status,now(),user_id,note,expires_at,request_id)).rowcount


def cancel(cd, request_id):
    return cd.execute("UPDATE support_requests SET status='cancelled',ended_at=? WHERE id=? AND status='pending'",(now(),request_id)).rowcount


def end(cd, request_id, user_id):
    return cd.execute('''UPDATE support_requests SET status='ended',ended_at=?,ended_by=? WHERE id=? AND status='approved' ''',
                      (now(),user_id,request_id)).rowcount


def lapse_pending(cd, created_before):
    return cd.execute("UPDATE support_requests SET status='expired',ended_at=? WHERE status='pending' AND created_at<?",
                      (now(),created_before)).rowcount


def ran_out(cd):
    """Approved requests whose time is over."""
    return rows(cd,"SELECT * FROM support_requests WHERE status='approved' AND expires_at<=?",(now(),))


def mark_expired(cd, request_id):
    cd.execute("UPDATE support_requests SET status='expired',ended_at=? WHERE id=? AND status='approved'",(now(),request_id))


def approved_for(cd, tenant_id, user_id):
    """The request behind a support membership, while it is approved."""
    return one(cd,"SELECT * FROM support_requests WHERE tenant_id=? AND user_id=? AND status='approved' ORDER BY created_at DESC LIMIT 1",
               (tenant_id,user_id))


# The membership support access makes
def grant(cd, tenant_id, user_id, team_id, expires_at, existing):
    """A read-only look at every team until expires_at (role 'admin'; middleware/auth.select_workspace refuses every
    change of a platform admin): a new membership, or the old inactive (or earlier support) one brought back."""
    if existing:
        cd.execute("UPDATE memberships SET role='admin',team_id=?,active=1,expires_at=? WHERE tenant_id=? AND user_id=?",
                   (team_id,expires_at,tenant_id,user_id))
    else:
        cd.execute("INSERT INTO memberships(tenant_id,user_id,role,team_id,active,expires_at) VALUES(?,?,'admin',?,1,?)",
                   (tenant_id,user_id,team_id,expires_at))


def withdraw(cd, tenant_id, user_id):
    """Close a support membership (never a permanent one). The platform admin's sessions that were working in that
    organization move back to their own first organization (or none), so their next page is not a dead end."""
    closed = cd.execute('UPDATE memberships SET active=0 WHERE tenant_id=? AND user_id=? AND expires_at IS NOT NULL',
                        (tenant_id,user_id)).rowcount
    if closed:
        from backend.modules.organization import repository as memberships
        cd.execute('UPDATE sessions SET tenant_id=? WHERE user_id=? AND tenant_id=?',
                   (memberships.first_active_tenant(cd,user_id),user_id,tenant_id))
    return closed
