"""Memberships (control database), and settings and teams (tenant database). A membership made by support access ends at
its expires_at: every check here ignores it from that minute (support_access/model.py)."""
from backend.database.db import one, rows
from backend.utils.dates import now

LIVE = "(m.expires_at IS NULL OR m.expires_at>?)"


# Memberships
def first_active_tenant(db, user_id):
    """The user's oldest organization that is active for them, or None."""
    row = one(db,f"SELECT m.tenant_id FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=? AND m.active=1 AND {LIVE} AND t.status='active' ORDER BY t.created_at LIMIT 1",(user_id,now()))
    return row['tenant_id'] if row else None


def workspace_membership(db, user_id, tenant_id):
    return one(db,f'''SELECT m.*,t.name AS tenant_name,t.slug FROM memberships m JOIN tenants t ON t.id=m.tenant_id
                  WHERE m.user_id=? AND m.tenant_id=? AND m.active=1 AND {LIVE} AND t.status='active' ''',(user_id,tenant_id,now()))


def can_enter_tenant(db, user_id, tenant_id):
    return bool(one(db,f"SELECT 1 FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE tenant_id=? AND user_id=? AND active=1 AND {LIVE} AND t.status='active'",(tenant_id,user_id,now())))


def user_memberships(db, user_id):
    return rows(db,f'''SELECT t.id,t.name,t.slug,t.status,m.role,m.expires_at FROM memberships m JOIN tenants t ON t.id=m.tenant_id
                WHERE m.user_id=? AND m.active=1 AND {LIVE} ORDER BY t.name''',(user_id,now()))


def tenant_members(db, tenant_id):
    return rows(db,f'''SELECT u.id,u.name,u.email,m.role,m.team_id,
                    CASE WHEN m.active=1 AND {LIVE} THEN 1 ELSE 0 END AS active,m.expires_at FROM memberships m
                    JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? ORDER BY u.name''',(now(),tenant_id))


def find_membership(db, tenant_id, user_id):
    return one(db,'SELECT * FROM memberships WHERE tenant_id=? AND user_id=?',(tenant_id,user_id))


def find_active_membership(db, tenant_id, user_id):
    return one(db,f'SELECT * FROM memberships m WHERE tenant_id=? AND user_id=? AND active=1 AND {LIVE}',(tenant_id,user_id,now()))


def is_active_team_member(db, tenant_id, user_id, team_id):
    return bool(one(db,f'SELECT 1 FROM memberships m WHERE tenant_id=? AND user_id=? AND active=1 AND {LIVE} AND team_id=?',(tenant_id,user_id,now(),team_id)))


def is_active_admin_session(db, tenant_id, user_id, session_token):
    """The user is still an active admin of an active organization and the session has not expired."""
    from backend.utils.dates import now
    return bool(one(db,"SELECT 1 FROM memberships m JOIN tenants t ON t.id=m.tenant_id JOIN sessions s ON s.user_id=m.user_id WHERE m.tenant_id=? AND m.user_id=? AND m.role='admin' AND m.active=1 AND m.expires_at IS NULL AND t.status='active' AND s.token=? AND s.expires_at>?",(tenant_id,user_id,session_token,now())))


def insert_membership(db, tenant_id, user_id, role, team_id):
    db.execute('INSERT INTO memberships(tenant_id,user_id,role,team_id) VALUES(?,?,?,?)',(tenant_id,user_id,role,team_id))


def update_membership(db, tenant_id, user_id, role, team_id, active):
    db.execute('UPDATE memberships SET role=?,team_id=?,active=? WHERE tenant_id=? AND user_id=?',(role,team_id,int(active),tenant_id,user_id))


# Settings
def settings(db):
    return dict(db.execute('SELECT key,value FROM settings').fetchall())


def setting(db, key):
    return db.execute('SELECT value FROM settings WHERE key=?',(key,)).fetchone()[0]


def update_setting(db, key, value):
    db.execute('UPDATE settings SET value=? WHERE key=?',(value,key))


# Teams
def teams(db):
    return rows(db,'SELECT * FROM teams ORDER BY name')


def team_exists(db, team_id):
    return bool(one(db,'SELECT id FROM teams WHERE id=?',(team_id,)))


def insert_team(db, team_id, name):
    db.execute('INSERT INTO teams VALUES(?,?)',(team_id,name))


def first_team_id(db):
    return db.execute('SELECT id FROM teams ORDER BY rowid LIMIT 1').fetchone()[0]
