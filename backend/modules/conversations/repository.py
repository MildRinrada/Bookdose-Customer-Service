"""Conversation, message and attachment queries, and attachment files on disk."""
from backend.database import db as D
from backend.database.db import one, rows
from backend.utils.dates import now


# Conversations
def list_with_previews(db, team_id=None):
    where,params = ('c.team_id=?',[team_id]) if team_id is not None else ('1=1',[])
    return rows(db,f'''SELECT c.id,c.contact_id,c.subject,c.channel,c.team_id,c.status,c.created_at,c.updated_at,
        p.name AS contact_name,p.company,tc.ticket_id,t.number AS ticket_number,t.status AS ticket_status,t.priority AS ticket_priority,
        (SELECT body FROM messages m WHERE m.conversation_id=c.id ORDER BY created_at DESC,rowid DESC LIMIT 1) AS preview,
        (SELECT kind FROM messages m WHERE m.conversation_id=c.id ORDER BY created_at DESC,rowid DESC LIMIT 1) AS last_kind,
        (SELECT kind FROM messages m WHERE m.conversation_id=c.id AND m.kind!='note' ORDER BY created_at DESC,rowid DESC LIMIT 1) AS last_public_kind
        FROM conversations c JOIN contacts p ON p.id=c.contact_id LEFT JOIN ticket_conversations tc ON tc.conversation_id=c.id
        LEFT JOIN tickets t ON t.id=tc.ticket_id WHERE {where} ORDER BY c.updated_at DESC''',params)


def move_contact(db, from_contact_id, to_contact_id):
    db.execute('UPDATE conversations SET contact_id=? WHERE contact_id=?',(to_contact_id,from_contact_id))


def insert(db, conversation_id, contact_id, subject, channel, team_id, portal_token_hash=None, created_at=None):
    created_at = created_at or now()
    db.execute('INSERT INTO conversations VALUES(?,?,?,?,?,?,?,?,?)',(conversation_id,contact_id,subject,channel,team_id,'open',portal_token_hash,created_at,created_at))


def find(db, conversation_id):
    return one(db,'SELECT * FROM conversations WHERE id=?',(conversation_id,))


def find_by_portal_token(db, token_hash):
    return one(db,'SELECT * FROM conversations WHERE portal_token=?',(token_hash,))


def for_ticket(db, ticket_id):
    return rows(db,'SELECT c.* FROM conversations c JOIN ticket_conversations tc ON tc.conversation_id=c.id WHERE tc.ticket_id=?',(ticket_id,))


def line_thread(db, conversation_id):
    return one(db,'SELECT source_type,active FROM line_threads WHERE conversation_id=?',(conversation_id,))


def set_status(db, conversation_id, status):
    db.execute('UPDATE conversations SET status=?,updated_at=? WHERE id=?',(status,now(),conversation_id))


def restore_state(db, conversation_id, status, updated_at):
    db.execute('UPDATE conversations SET status=?,updated_at=? WHERE id=?',(status,updated_at,conversation_id))


def reopen(db, conversation_id):
    db.execute("UPDATE conversations SET status='open' WHERE id=?",(conversation_id,))


def touch(db, conversation_id):
    db.execute('UPDATE conversations SET updated_at=? WHERE id=?',(now(),conversation_id))


def set_team_for_ticket(db, ticket_id, team_id):
    db.execute('UPDATE conversations SET team_id=? WHERE id IN (SELECT conversation_id FROM ticket_conversations WHERE ticket_id=?)',(team_id,ticket_id))


# Messages
def list_messages(db, conversation_id, public=False):
    extra = " AND kind!='note'" if public else ''
    return rows(db,'SELECT id,author_name,kind,body,delivery,created_at FROM messages WHERE conversation_id=?'+extra+' ORDER BY created_at,rowid',(conversation_id,))


def find_message(db, message_id):
    return one(db,'SELECT * FROM messages WHERE id=?',(message_id,))


def insert_message(db, message_id, conversation_id, author_id, author_name, kind, body, created_at=None):
    db.execute('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)',(message_id,conversation_id,author_id,author_name,kind,body,'stored',created_at or now()))


def latest_message_id(db, conversation_id, kind=None):
    extra = ' AND kind=?' if kind else ''
    row = one(db,'SELECT id FROM messages WHERE conversation_id=?'+extra+' ORDER BY rowid DESC LIMIT 1',(conversation_id,kind) if kind else (conversation_id,))
    return row['id'] if row else None


def set_message_created_at(db, message_id, created_at):
    db.execute('UPDATE messages SET created_at=? WHERE id=?',(created_at,message_id))


def set_delivery(db, message_id, delivery):
    db.execute('UPDATE messages SET delivery=? WHERE id=?',(delivery,message_id))


def make_note(db, message_id):
    """Keep a message for staff only (it will not be sent to the customer)."""
    db.execute("UPDATE messages SET kind='note' WHERE id=?",(message_id,))


def set_body(db, message_id, body):
    db.execute('UPDATE messages SET body=? WHERE id=?',(body,message_id))


def ai_meta(db, message_id):
    return one(db,'SELECT source,citations FROM ai_message_meta WHERE message_id=?',(message_id,))


# Attachments
def attachments_of(db, message_id):
    return rows(db,'SELECT id,name,mime,size FROM attachments WHERE message_id=?',(message_id,))


def attachment_records(db, message_id):
    return rows(db,'SELECT * FROM attachments WHERE message_id=?',(message_id,))


def has_attachment(db, message_id):
    return bool(one(db,'SELECT 1 FROM attachments WHERE message_id=?',(message_id,)))


def insert_attachment(db, file_id, message_id, name, mime, size, storage_key):
    db.execute('INSERT INTO attachments VALUES(?,?,?,?,?,?)',(file_id,message_id,name,mime,size,storage_key))


def attachment_with_conversation(db, file_id):
    return one(db,'SELECT a.*,m.conversation_id FROM attachments a JOIN messages m ON m.id=a.message_id WHERE a.id=?',(file_id,))


def public_attachment(db, file_id, conversation_id):
    """Only files on customer-visible messages of the conversation; internal-note files stay private."""
    return one(db,"SELECT a.* FROM attachments a JOIN messages m ON m.id=a.message_id WHERE a.id=? AND m.conversation_id=? AND m.kind!='note'",(file_id,conversation_id))


def attachment_path(tenant_id, storage_key):
    return D.DATA/'files'/tenant_id/storage_key


def save_attachment_file(tenant_id, storage_key, content):
    folder = D.DATA/'files'/tenant_id
    folder.mkdir(exist_ok=True,mode=0o700)
    path = folder/storage_key
    with path.open('xb') as out:
        out.write(content)
    path.chmod(0o600)


def read_attachment_file(tenant_id, storage_key):
    """File bytes, or None when the file is missing."""
    path = attachment_path(tenant_id,storage_key)
    return path.read_bytes() if path.is_file() else None
