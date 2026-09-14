"""Contact queries. With team_id (agents), only contacts the agent created or that have work in the team are returned."""
from backend.database.db import one, rows
from backend.utils.dates import now


def list_visible(db, agent_id=None, team_id=None):
    if team_id is None:
        where,args = '1=1',[]
    else:
        where = 'c.created_by=? OR c.id IN (SELECT contact_id FROM conversations WHERE team_id=?) OR c.id IN (SELECT contact_id FROM tickets WHERE team_id=?)'
        args = [agent_id,team_id,team_id]
    return rows(db,f'SELECT c.*,n.first_name,n.last_name FROM contacts c LEFT JOIN contact_names n ON n.contact_id=c.id WHERE {where} ORDER BY c.name',args)


def find(db, contact_id):
    return one(db,'SELECT * FROM contacts WHERE id=?',(contact_id,))


def find_visible(db, contact_id, agent_id=None, team_id=None):
    if team_id is None:
        return find(db,contact_id)
    return one(db,'''SELECT * FROM contacts WHERE id=? AND (created_by=? OR id IN
        (SELECT contact_id FROM conversations WHERE team_id=?) OR id IN
        (SELECT contact_id FROM tickets WHERE team_id=?))''',(contact_id,agent_id,team_id,team_id))


def insert(db, contact_id, name, email, phone, company, notes, created_by, created_at=None):
    db.execute('INSERT INTO contacts VALUES(?,?,?,?,?,?,?,?)',(contact_id,name,email,phone,company,notes,created_by,created_at or now()))


def update(db, contact_id, name, email, phone, company, notes):
    db.execute('UPDATE contacts SET name=?,email=?,phone=?,company=?,notes=? WHERE id=?',(name,email,phone,company,notes,contact_id))


def delete(db, contact_id):
    db.execute('DELETE FROM contact_names WHERE contact_id=?',(contact_id,))
    db.execute('DELETE FROM contacts WHERE id=?',(contact_id,))


def names_of(db, contact_id):
    return rows(db,'SELECT * FROM contact_names WHERE contact_id=?',(contact_id,))


def insert_names(db, contact_id, first_name, last_name):
    db.execute('INSERT INTO contact_names VALUES(?,?,?)',(contact_id,first_name,last_name))


def save_names(db, contact_id, first_name, last_name):
    db.execute('INSERT INTO contact_names VALUES(?,?,?) ON CONFLICT(contact_id) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name',(contact_id,first_name,last_name))


def linked_counts(db, contact_id):
    """How much history points at this customer, so deleting can refuse instead of orphaning it."""
    return {'tickets':one(db,'SELECT COUNT(*) AS n FROM tickets WHERE contact_id=?',(contact_id,))['n'],
            'conversations':one(db,'SELECT COUNT(*) AS n FROM conversations WHERE contact_id=?',(contact_id,))['n']}
