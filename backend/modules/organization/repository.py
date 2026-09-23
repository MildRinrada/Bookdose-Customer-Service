"""Memberships (control database), and settings and teams (tenant database). A membership made by support access ends at
its expires_at: every check here ignores it from that minute (support_access/model.py).

A platform admin looks after the server and the organizations as a whole, never an organization's own work: they take
no cases and answer no customers. Their only way into an organization is an approved support access (a membership
with expires_at, read-only: middleware/auth.select_workspace); a permanent membership of theirs (the first-run owner's,
from before this rule) counts for nothing here. They are never one of the organization's members either: not in its
team lists, not an owner a case can go to, not a lead an escalation reaches."""
from backend.database.db import one, rows
from backend.utils.dates import now

LIVE = "(m.expires_at IS NULL OR m.expires_at>?)"
NOT_PLATFORM = "m.user_id NOT IN (SELECT id FROM users WHERE platform_admin=1)"
# Who may open the organization: its members, and a platform admin only through a support access.
WORKS = f"(m.expires_at IS NOT NULL OR {NOT_PLATFORM})"


# Memberships
def first_active_tenant(db, user_id):
    """The user's oldest organization that is active for them, or None."""
    row = one(db,f"SELECT m.tenant_id FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=? AND m.active=1 AND {LIVE} AND {WORKS} AND t.status='active' ORDER BY t.created_at LIMIT 1",(user_id,now()))
    return row['tenant_id'] if row else None


def workspace_membership(db, user_id, tenant_id):
    return one(db,f'''SELECT m.*,t.name AS tenant_name,t.slug FROM memberships m JOIN tenants t ON t.id=m.tenant_id
                  WHERE m.user_id=? AND m.tenant_id=? AND m.active=1 AND {LIVE} AND {WORKS} AND t.status='active' ''',(user_id,tenant_id,now()))


def can_enter_tenant(db, user_id, tenant_id):
    return bool(one(db,f"SELECT 1 FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE tenant_id=? AND user_id=? AND active=1 AND {LIVE} AND {WORKS} AND t.status='active'",(tenant_id,user_id,now())))


def user_memberships(db, user_id):
    # has_logo, not the picture (as with a member's photo below): it is read on every page and fetched as an image.
    return rows(db,f'''SELECT t.id,t.name,t.slug,t.status,m.role,m.expires_at,
                CASE WHEN t.logo='' THEN 0 ELSE 1 END AS has_logo FROM memberships m JOIN tenants t ON t.id=m.tenant_id
                WHERE m.user_id=? AND m.active=1 AND {LIVE} AND {WORKS} ORDER BY t.name''',(user_id,now()))


def tenant_members(db, tenant_id):
    # has_photo, not the photo: one is up to 128 KB, and a team of twenty would be megabytes in every answer.
    return rows(db,f'''SELECT u.id,u.name,u.email,m.role,m.team_id,
                    CASE WHEN m.active=1 AND {LIVE} THEN 1 ELSE 0 END AS active,m.expires_at,
                    CASE WHEN COALESCE(p.avatar,'')='' THEN 0 ELSE 1 END AS has_photo FROM memberships m
                    JOIN users u ON u.id=m.user_id LEFT JOIN user_profiles p ON p.user_id=u.id
                    WHERE m.tenant_id=? AND u.platform_admin=0 ORDER BY u.name''',(now(),tenant_id))


def find_membership(db, tenant_id, user_id):
    return one(db,'SELECT * FROM memberships WHERE tenant_id=? AND user_id=?',(tenant_id,user_id))


def find_active_membership(db, tenant_id, user_id):
    return one(db,f'SELECT * FROM memberships m WHERE tenant_id=? AND user_id=? AND active=1 AND {LIVE} AND {WORKS}',(tenant_id,user_id,now()))


def is_active_team_member(db, tenant_id, user_id, team_id):
    return bool(one(db,f'SELECT 1 FROM memberships m WHERE tenant_id=? AND user_id=? AND active=1 AND {LIVE} AND {NOT_PLATFORM} AND team_id=?',
                    (tenant_id,user_id,now(),team_id)))


def is_active_admin_session(db, tenant_id, user_id, session_token):
    """The user is still an active admin of an active organization and the session has not expired."""
    from backend.utils.dates import now
    return bool(one(db,f"SELECT 1 FROM memberships m JOIN tenants t ON t.id=m.tenant_id JOIN sessions s ON s.user_id=m.user_id WHERE m.tenant_id=? AND m.user_id=? AND m.role='admin' AND m.active=1 AND m.expires_at IS NULL AND {NOT_PLATFORM} AND t.status='active' AND s.token=? AND s.expires_at>?",(tenant_id,user_id,session_token,now())))


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


# คำตอบสำเร็จรูปของทีม
def team_snippets(db):
    return rows(db,'SELECT id,shortcut,text FROM team_snippets ORDER BY position,rowid')


def replace_team_snippets(db, items):
    """The whole list at once, in the order given (as the member's own quick replies are saved)."""
    db.execute('DELETE FROM team_snippets')
    db.executemany('INSERT INTO team_snippets VALUES(?,?,?,?)',
                   [(item['id'],item['shortcut'],item['text'],index) for index,item in enumerate(items)])


def move_canned_reply(db):
    """The one prepared reply older organizations had becomes the first of the team's list. Emptying the setting is
    what makes this run once, so a team that later deletes the snippet does not get it back on the next start."""
    from backend.utils.security import uid
    row = db.execute("SELECT value FROM settings WHERE key='canned_reply'").fetchone()
    if not row or not row[0].strip():
        return
    db.execute('INSERT OR IGNORE INTO team_snippets VALUES(?,?,?,?)',(uid(),'ทักทาย',row[0].strip(),0))
    db.execute("UPDATE settings SET value='' WHERE key='canned_reply'")


# Teams
def teams(db):
    return rows(db,'SELECT * FROM teams ORDER BY name')


def team_exists(db, team_id):
    return bool(one(db,'SELECT id FROM teams WHERE id=?',(team_id,)))


def insert_team(db, team_id, name, description=''):
    db.execute('INSERT INTO teams(id,name,description) VALUES(?,?,?)',(team_id,name,description))


def find_team(db, team_id):
    return one(db,'SELECT * FROM teams WHERE id=?',(team_id,))


def save_team(db, team_id, name, description):
    db.execute('UPDATE teams SET name=?,description=? WHERE id=?',(name,description,team_id))


def first_team_id(db):
    return db.execute('SELECT id FROM teams ORDER BY rowid LIMIT 1').fetchone()[0]


def organization_admins(db, tenant_id):
    """The organization's own admins (permanent, active, never a platform admin): who runs it."""
    return rows(db,f"""SELECT u.id,u.name,u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=?
                     AND m.role='admin' AND m.active=1 AND m.expires_at IS NULL AND {NOT_PLATFORM} ORDER BY u.name""",(tenant_id,))
