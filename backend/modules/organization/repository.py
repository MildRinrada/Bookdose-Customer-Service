"""Memberships (control database), and settings and teams (tenant database)."""
from backend.database.db import one, rows


# Memberships
def first_active_tenant(db, user_id):
    """The user's oldest organization that is active for them, or None."""
    row = one(db,"SELECT m.tenant_id FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=? AND m.active=1 AND t.status='active' ORDER BY t.created_at LIMIT 1",(user_id,))
    return row['tenant_id'] if row else None


def workspace_membership(db, user_id, tenant_id):
    return one(db,'''SELECT m.*,t.name AS tenant_name,t.slug FROM memberships m JOIN tenants t ON t.id=m.tenant_id
                  WHERE m.user_id=? AND m.tenant_id=? AND m.active=1 AND t.status='active' ''',(user_id,tenant_id))


def can_enter_tenant(db, user_id, tenant_id):
    return bool(one(db,"SELECT 1 FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE tenant_id=? AND user_id=? AND active=1 AND t.status='active'",(tenant_id,user_id)))


def user_memberships(db, user_id):
    return rows(db,'''SELECT t.id,t.name,t.slug,t.status,m.role FROM memberships m JOIN tenants t ON t.id=m.tenant_id
                WHERE m.user_id=? AND m.active=1 ORDER BY t.name''',(user_id,))


def tenant_members(db, tenant_id):
    return rows(db,'''SELECT u.id,u.name,u.email,m.role,m.team_id,m.active FROM memberships m
                    JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? ORDER BY u.name''',(tenant_id,))


def find_membership(db, tenant_id, user_id):
    return one(db,'SELECT * FROM memberships WHERE tenant_id=? AND user_id=?',(tenant_id,user_id))


def find_active_membership(db, tenant_id, user_id):
    return one(db,'SELECT * FROM memberships WHERE tenant_id=? AND user_id=? AND active=1',(tenant_id,user_id))


def is_active_team_member(db, tenant_id, user_id, team_id):
    return bool(one(db,'SELECT 1 FROM memberships WHERE tenant_id=? AND user_id=? AND active=1 AND team_id=?',(tenant_id,user_id,team_id)))


def is_active_admin_session(db, tenant_id, user_id, session_token):
    """The user is still an active admin of an active organization and the session has not expired."""
    from backend.utils.dates import now
    return bool(one(db,"SELECT 1 FROM memberships m JOIN tenants t ON t.id=m.tenant_id JOIN sessions s ON s.user_id=m.user_id WHERE m.tenant_id=? AND m.user_id=? AND m.role='admin' AND m.active=1 AND t.status='active' AND s.token=? AND s.expires_at>?",(tenant_id,user_id,session_token,now())))


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
