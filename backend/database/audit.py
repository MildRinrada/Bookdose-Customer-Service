"""Audit log, shared by every module (the same table exists in the control database and in every tenant database)."""
from backend.database.db import rows
from backend.utils.dates import now

TABLE = '''CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
    entity TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);'''


def record(db, actor, action, entity, detail=''):
    db.execute('INSERT INTO audit_logs(actor,action,entity,detail,created_at) VALUES(?,?,?,?,?)',
               (actor, action, entity, detail, now()))


def latest(db, limit):
    return rows(db,'SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?',(limit,))


def for_entity(db, entity, limit=40):
    return rows(db,'SELECT * FROM audit_logs WHERE entity=? ORDER BY id DESC LIMIT ?',(entity,limit))


def with_names(control_db, events, tenant_db=None, tenant_id=None):
    """Add readable actor and entity names to audit rows (user, organization, case, contact, article)."""
    user_rows = rows(control_db,'SELECT u.id,u.name,u.email FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.tenant_id=?',(tenant_id,)) if tenant_id else rows(control_db,'SELECT id,name,email FROM users')
    users = {u['id']:u['name']+' · '+u['email'] for u in user_rows}
    org_rows = rows(control_db,'SELECT id,name FROM tenants WHERE id=?',(tenant_id,)) if tenant_id else rows(control_db,'SELECT id,name FROM tenants')
    entities = {t['id']:t['name'] for t in org_rows}
    entities.update(users)
    if tenant_db:
        entities.update({t['id']:'BD-'+str(t['number'])+' · '+t['subject'] for t in rows(tenant_db,'SELECT id,number,subject FROM tickets')})
        entities.update({c['id']:c['name'] for c in rows(tenant_db,'SELECT id,name FROM contacts')})
        entities.update({a['id']:a['title'] for a in rows(tenant_db,'SELECT id,title FROM knowledge_articles')})
        entities.update({c['id']:c['subject'] for c in rows(tenant_db,'SELECT id,subject FROM conversations')})
    return [{**e,'actor_display':users.get(e['actor'],e['actor']),
             'entity_display':entities.get(e['entity'],'รายการที่เกี่ยวข้อง')} for e in events]
