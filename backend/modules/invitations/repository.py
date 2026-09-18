"""Queries of staff invitations (control database)."""
from backend.database.db import one, rows
from backend.modules.invitations.model import LIST_LIMIT
from backend.utils.dates import now

OPEN = 'accepted_at IS NULL AND cancelled_at IS NULL'


def insert(cd, invite_id, tenant_id, email, role, team_id, invited_by, token_hash, expires_at):
    cd.execute('''INSERT INTO staff_invitations(id,tenant_id,email,role,team_id,invited_by,token_hash,
                  created_at,last_sent_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)''',
               (invite_id,tenant_id,email,role,team_id,invited_by,token_hash,now(),now(),expires_at))


def renew(cd, invite_id, role, team_id, token_hash, expires_at):
    """An invitation sent again (or the same address invited with another role): a new link, the old one dies."""
    cd.execute('UPDATE staff_invitations SET role=?,team_id=?,token_hash=?,last_sent_at=?,expires_at=? WHERE id=?',
               (role,team_id,token_hash,now(),expires_at,invite_id))


def find(cd, invite_id):
    return one(cd,'SELECT * FROM staff_invitations WHERE id=?',(invite_id,))


def find_by_token(cd, token_hash):
    return one(cd,'''SELECT i.*,t.name AS tenant_name,t.status AS tenant_status FROM staff_invitations i
                     JOIN tenants t ON t.id=i.tenant_id WHERE i.token_hash=?''',(token_hash,))


def open_for(cd, tenant_id, email):
    return one(cd,f'SELECT * FROM staff_invitations WHERE tenant_id=? AND email=? AND {OPEN}',(tenant_id,email))


def of_tenant(cd, tenant_id):
    """Every invitation of the organization, newest first, with the name of the admin who sent it."""
    return rows(cd,f'''SELECT i.*,u.name AS invited_by_name FROM staff_invitations i
                       LEFT JOIN users u ON u.id=i.invited_by
                       WHERE i.tenant_id=? ORDER BY i.created_at DESC LIMIT {LIST_LIMIT}''',(tenant_id,))


def accept(cd, invite_id):
    """0 rows when it was cancelled or accepted a moment ago (two clicks of the same link)."""
    return cd.execute(f'UPDATE staff_invitations SET accepted_at=? WHERE id=? AND {OPEN}',(now(),invite_id)).rowcount


def cancel(cd, invite_id):
    return cd.execute(f'UPDATE staff_invitations SET cancelled_at=? WHERE id=? AND {OPEN}',(now(),invite_id)).rowcount


def cancel_open_for(cd, tenant_id, email):
    """The address became a member another way: its open invitation is no longer waiting for anything."""
    return cd.execute(f'UPDATE staff_invitations SET cancelled_at=? WHERE tenant_id=? AND email=? AND {OPEN}',
                      (now(),tenant_id,email)).rowcount


def purge(cd, settled_before):
    cd.execute('DELETE FROM staff_invitations WHERE accepted_at<? OR cancelled_at<?',(settled_before,settled_before))


# The membership an accepted invitation makes
def grant(cd, tenant_id, user_id, role, team_id, existing):
    """A member from now on: a new membership, or the old one (switched off, or a support one) made permanent."""
    if existing:
        cd.execute('UPDATE memberships SET role=?,team_id=?,active=1,expires_at=NULL WHERE tenant_id=? AND user_id=?',
                   (role,team_id,tenant_id,user_id))
    else:
        cd.execute('INSERT INTO memberships(tenant_id,user_id,role,team_id,active) VALUES(?,?,?,?,1)',
                   (tenant_id,user_id,role,team_id))
