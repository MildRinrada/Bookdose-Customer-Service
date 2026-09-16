"""org_join_links and org_join_uses (control database)."""
from backend.database.db import one, rows
from backend.utils.dates import now


def of_tenant(cd, tenant_id):
    """Every link of the organization, newest first (revoked and expired ones stay as history)."""
    return rows(cd,'SELECT * FROM org_join_links WHERE tenant_id=? ORDER BY created_at DESC,rowid DESC',(tenant_id,))


def find(cd, link_id):
    return one(cd,'SELECT * FROM org_join_links WHERE id=?',(link_id,))


def find_by_token(cd, token):
    return one(cd,'SELECT * FROM org_join_links WHERE token=?',(token,))


def insert(cd, link_id, tenant_id, token, label, created_by, expires_at, max_uses):
    cd.execute('''INSERT INTO org_join_links(id,tenant_id,token,label,created_by,created_at,expires_at,max_uses)
                  VALUES(?,?,?,?,?,?,?,?)''',(link_id,tenant_id,token,label,created_by,now(),expires_at,max_uses))


def revoke(cd, link_id):
    cd.execute('UPDATE org_join_links SET revoked_at=? WHERE id=? AND revoked_at IS NULL',(now(),link_id))


def used_by(cd, link_id, account_id):
    """This account already used the link (opening it again is not a new use)."""
    return bool(one(cd,'SELECT 1 AS used FROM org_join_uses WHERE link_id=? AND account_id=?',(link_id,account_id)))


def count_use(cd, link_id, account_id):
    """Count the account's first use of the link; returns whether it was counted."""
    added = cd.execute('INSERT OR IGNORE INTO org_join_uses VALUES(?,?,?)',(link_id,account_id,now())).rowcount
    if added:
        cd.execute('UPDATE org_join_links SET uses=uses+1 WHERE id=?',(link_id,))
    return bool(added)
