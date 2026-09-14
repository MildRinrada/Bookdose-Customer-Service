"""Case queries. Functions taking team_id limit results to that team when it is given (agents)."""
from backend.database.db import one, rows
from backend.utils.dates import now


def _team_filter(team_id):
    return ('t.team_id=?',[team_id]) if team_id is not None else ('1=1',[])


def list_with_contacts(db, team_id=None):
    where,params = _team_filter(team_id)
    return rows(db,f'''SELECT t.*,c.name AS contact_name,c.company,
              (SELECT m.kind FROM ticket_conversations tc JOIN messages m ON m.conversation_id=tc.conversation_id
               WHERE tc.ticket_id=t.id AND m.kind!='note' ORDER BY m.created_at DESC,m.rowid DESC LIMIT 1) AS last_public_kind,
              (SELECT m.created_at FROM ticket_conversations tc JOIN messages m ON m.conversation_id=tc.conversation_id
               WHERE tc.ticket_id=t.id AND m.kind!='note' ORDER BY m.created_at DESC,m.rowid DESC LIMIT 1) AS last_public_at
              FROM tickets t JOIN contacts c ON c.id=t.contact_id WHERE {where} ORDER BY t.updated_at DESC,t.number DESC''',params)


def export_rows(db, team_id=None):
    where,params = _team_filter(team_id)
    return rows(db,f'''SELECT t.number,t.subject,c.name AS customer,t.status,t.priority,t.category,t.created_at,t.first_response_at,t.resolved_at
        FROM tickets t JOIN contacts c ON c.id=t.contact_id WHERE {where} ORDER BY t.number''',params)


def next_number(db):
    return db.execute('SELECT COALESCE(MAX(number),1000)+1 FROM tickets').fetchone()[0]


def move_contact(db, from_contact_id, to_contact_id):
    db.execute('UPDATE tickets SET contact_id=? WHERE contact_id=?',(to_contact_id,from_contact_id))


def insert(db, ticket_id, number, subject, contact_id, team_id, assignee_id, priority, category, first_response_due_at, resolution_due_at):
    db.execute('''INSERT INTO tickets(id,number,subject,contact_id,team_id,assignee_id,priority,status,category,
               created_at,updated_at,first_response_due_at,resolution_due_at) VALUES(?,?,?,?,?,?,?,'new',?,?,?,?,?)''',
               (ticket_id,number,subject,contact_id,team_id,assignee_id,priority,category,now(),now(),first_response_due_at,resolution_due_at))


def update(db, ticket_id, status, priority, team_id, assignee_id, resolved_at):
    db.execute('UPDATE tickets SET status=?,priority=?,team_id=?,assignee_id=?,resolved_at=?,updated_at=? WHERE id=?',
        (status,priority,team_id,assignee_id,resolved_at,now(),ticket_id))


def set_first_response(db, ticket_id, responded_at):
    db.execute('UPDATE tickets SET first_response_at=? WHERE id=?',(responded_at,ticket_id))


def link_conversation(db, ticket_id, conversation_id):
    db.execute('INSERT INTO ticket_conversations VALUES(?,?)',(ticket_id,conversation_id))


def conversation_links(db, ticket_id):
    return rows(db,'SELECT * FROM ticket_conversations WHERE ticket_id=?',(ticket_id,))


def is_conversation_linked(db, conversation_id):
    return bool(one(db,'SELECT 1 FROM ticket_conversations WHERE conversation_id=?',(conversation_id,)))


def for_conversation(db, conversation_id):
    return one(db,'SELECT t.* FROM tickets t JOIN ticket_conversations tc ON tc.ticket_id=t.id WHERE tc.conversation_id=?',(conversation_id,))


def states_for_conversation(db, conversation_id):
    return rows(db,'SELECT t.id,t.status,t.resolved_at,t.updated_at FROM tickets t JOIN ticket_conversations tc ON tc.ticket_id=t.id WHERE tc.conversation_id=?',(conversation_id,))


def restore_state(db, state):
    """Put back status/resolved_at/updated_at saved by states_for_conversation."""
    db.execute('UPDATE tickets SET status=?,resolved_at=?,updated_at=? WHERE id=?',(state['status'],state['resolved_at'],state['updated_at'],state['id']))


def first_staff_reply_time(db, conversation_id):
    """When a person first replied in the conversation (delivery time for LINE/Email); AI and system replies do not count."""
    return db.execute("SELECT MIN(CASE WHEN m.delivery='accepted' THEN o.updated_at ELSE m.created_at END) FROM messages m LEFT JOIN channel_outbox o ON o.message_id=m.id WHERE m.conversation_id=? AND m.kind='reply' AND m.delivery IN ('stored','accepted') AND m.id NOT IN (SELECT message_id FROM ai_message_meta)",(conversation_id,)).fetchone()[0]


def record_first_response(db, conversation_id):
    db.execute('''UPDATE tickets SET first_response_at=COALESCE(first_response_at,?),updated_at=?
       WHERE id IN (SELECT ticket_id FROM ticket_conversations WHERE conversation_id=?)''',(now(),now(),conversation_id))


def record_first_response_for_message(db, message_id):
    db.execute('''UPDATE tickets SET first_response_at=COALESCE(first_response_at,?),updated_at=? WHERE id IN
        (SELECT ticket_id FROM ticket_conversations WHERE conversation_id=(SELECT conversation_id FROM messages WHERE id=?))''',(now(),now(),message_id))


def reopen_for_conversation(db, conversation_id):
    """A customer wrote again: waiting, resolved or closed cases of the conversation go back to open."""
    db.execute('''UPDATE tickets SET status='open',resolved_at=NULL,updated_at=?
        WHERE id IN (SELECT ticket_id FROM ticket_conversations WHERE conversation_id=?)
        AND status IN ('pending_customer','resolved','closed')''',(now(),conversation_id))


def reopen(db, ticket_id):
    db.execute("UPDATE tickets SET status='open',resolved_at=NULL,updated_at=? WHERE id=? AND status IN ('resolved','closed','pending_customer')",(now(),ticket_id))


def backdate(db, ticket_id, status, timestamp):
    """Demo data only: a case that was opened and last changed at `timestamp`."""
    db.execute('UPDATE tickets SET status=?,created_at=?,updated_at=? WHERE id=?',(status,timestamp,timestamp,ticket_id))


def set_resolved_at(db, ticket_id, resolved_at):
    db.execute('UPDATE tickets SET resolved_at=? WHERE id=?',(resolved_at,ticket_id))


def set_first_response_due(db, ticket_id, due_at):
    db.execute('UPDATE tickets SET first_response_due_at=? WHERE id=?',(due_at,ticket_id))


def unassign_member(db, user_id, active, team_id):
    """Unassign the member's cases everywhere when deactivated, otherwise only outside their team."""
    db.execute('UPDATE tickets SET assignee_id=NULL WHERE assignee_id=? AND (?=0 OR team_id!=?)',(user_id,int(active),team_id))


def delete(db, ticket_id):
    """The case row and its links. The conversations themselves stay: they are the customer's messages."""
    db.execute('DELETE FROM ticket_conversations WHERE ticket_id=?',(ticket_id,))
    db.execute('DELETE FROM tickets WHERE id=?',(ticket_id,))
