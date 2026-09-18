"""Contact queries. With team_id (agents), only contacts the agent created or that have work in the team are returned."""
import json

from backend.database.db import one, rows
from backend.utils.dates import now


def list_visible(db, agent_id=None, team_id=None):
    if team_id is None:
        where,args = '1=1',[]
    else:
        where = 'c.created_by=? OR c.id IN (SELECT contact_id FROM conversations WHERE team_id=?) OR c.id IN (SELECT contact_id FROM tickets WHERE team_id=?)'
        args = [agent_id,team_id,team_id]
    return rows(db,f'SELECT c.*,n.first_name,n.last_name FROM contacts c LEFT JOIN contact_names n ON n.contact_id=c.id WHERE {where} ORDER BY c.name',args)


def satisfaction(db):
    """Each contact's answered surveys: {contact_id: {average, count, last}} (the list's mood badge)."""
    found = rows(db,'''SELECT t.contact_id,AVG(s.rating) AS average,COUNT(*) AS count,MAX(s.answered_at) AS last FROM csat_surveys s
                    JOIN tickets t ON t.id=s.ticket_id WHERE s.answered_at IS NOT NULL AND s.rating IS NOT NULL GROUP BY t.contact_id''')
    return {r['contact_id']:{'average':round(r['average'],1),'count':r['count'],'last':r['last']} for r in found}


def main_channels(db):
    """The channel each contact wrote on most (ties go to the most recent): {contact_id: channel}."""
    found = rows(db,'''SELECT contact_id,channel,COUNT(*) AS n,MAX(created_at) AS latest FROM conversations
                    WHERE contact_id IS NOT NULL GROUP BY contact_id,channel ORDER BY contact_id,n DESC,latest DESC''')
    main = {}
    for r in found:
        main.setdefault(r['contact_id'],r['channel'])
    return main


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
    db.execute('DELETE FROM contact_profiles WHERE contact_id=?',(contact_id,))
    db.execute('DELETE FROM contact_names WHERE contact_id=?',(contact_id,))
    db.execute('DELETE FROM contacts WHERE id=?',(contact_id,))


def names_of(db, contact_id):
    return rows(db,'SELECT * FROM contact_names WHERE contact_id=?',(contact_id,))


def profile_rows(db, contact_id):
    """The stored profile row as is (for the recycle bin)."""
    return rows(db,'SELECT * FROM contact_profiles WHERE contact_id=?',(contact_id,))


def insert_names(db, contact_id, first_name, last_name):
    db.execute('INSERT INTO contact_names VALUES(?,?,?)',(contact_id,first_name,last_name))


def save_names(db, contact_id, first_name, last_name):
    db.execute('INSERT INTO contact_names VALUES(?,?,?) ON CONFLICT(contact_id) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name',(contact_id,first_name,last_name))


# The care profile (model.py: contact_profiles).

def _profile(row):
    return {**row,'tags':json.loads(row['tags'] or '[]')}


def profiles(db):
    """{contact_id: profile} of every contact that has one (the list shows the tags and the warning)."""
    return {r['contact_id']:_profile(r) for r in rows(db,'SELECT * FROM contact_profiles')}


def profile_of(db, contact_id):
    row = one(db,'SELECT * FROM contact_profiles WHERE contact_id=?',(contact_id,))
    return _profile(row) if row else None


def save_profile(db, contact_id, values, actor):
    """Keep the profile; consent and the deletion request remember who set them and when (only when they change)."""
    before = profile_of(db,contact_id) or {}
    stamp = now()
    consent_changed = values['consent']!=before.get('consent','')
    requested = values['deletion_requested']
    already = bool(before.get('deletion_requested_at'))
    db.execute('''INSERT INTO contact_profiles(contact_id,preferred_channel,contact_hours,language,tags,warning,consent,consent_at,
                  consent_by,deletion_requested_at,deletion_requested_by,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(contact_id) DO UPDATE SET preferred_channel=excluded.preferred_channel,contact_hours=excluded.contact_hours,
                  language=excluded.language,tags=excluded.tags,warning=excluded.warning,consent=excluded.consent,
                  consent_at=excluded.consent_at,consent_by=excluded.consent_by,deletion_requested_at=excluded.deletion_requested_at,
                  deletion_requested_by=excluded.deletion_requested_by,updated_by=excluded.updated_by,updated_at=excluded.updated_at''',
               (contact_id,values['preferred_channel'],values['contact_hours'],values['language'],
                json.dumps(values['tags'],ensure_ascii=False),values['warning'],values['consent'],
                (stamp if values['consent'] else None) if consent_changed else before.get('consent_at'),
                (actor if values['consent'] else '') if consent_changed else before.get('consent_by',''),
                (before.get('deletion_requested_at') if already else stamp) if requested else None,
                (before.get('deletion_requested_by','') if already else actor) if requested else '',
                actor,stamp))


def move_profile(db, from_contact_id, to_contact_id):
    """Merging: the kept contact takes a duplicate's profile only when it has none of its own."""
    db.execute('UPDATE OR IGNORE contact_profiles SET contact_id=? WHERE contact_id=?',(to_contact_id,from_contact_id))
    db.execute('DELETE FROM contact_profiles WHERE contact_id=?',(from_contact_id,))


def channels(db, contact_id):
    """Where the customer has talked to the team: per channel the number of conversations, the latest, and for email
    the addresses they wrote from. LINE and Facebook ids are never shown."""
    found = rows(db,'''SELECT channel,COUNT(*) AS conversations,MAX(updated_at) AS last_at FROM conversations
                      WHERE contact_id=? GROUP BY channel ORDER BY last_at DESC''',(contact_id,))
    emails = [r['recipient'] for r in rows(db,'''SELECT DISTINCT cc.recipient FROM channel_conversations cc
                  JOIN conversations c ON c.id=cc.conversation_id WHERE c.contact_id=? AND c.channel='email' LIMIT 3''',(contact_id,))]
    for item in found:
        item['addresses'] = emails if item['channel']=='email' else []
    return found


def support_account(db, contact_id):
    """The support-page account this contact belongs to, and whether it gets its notices on LINE."""
    row = one(db,'''SELECT m.account_id,EXISTS(SELECT 1 FROM customer_line_links l WHERE l.account_id=m.account_id) AS line
                    FROM customer_members m WHERE m.contact_id=?''',(contact_id,))
    return {'line':bool(row['line'])} if row else None


def last_edit(db, contact_id):
    return one(db,'''SELECT actor,action,created_at FROM audit_logs WHERE entity=? AND action IN ('contact.created','contact.updated','contact.merged')
                     ORDER BY id DESC LIMIT 1''',(contact_id,))


def linked_counts(db, contact_id):
    """How much history points at this customer, so deleting can refuse instead of orphaning it."""
    return {'tickets':one(db,'SELECT COUNT(*) AS n FROM tickets WHERE contact_id=?',(contact_id,))['n'],
            'conversations':one(db,'SELECT COUNT(*) AS n FROM conversations WHERE contact_id=?',(contact_id,))['n']}
