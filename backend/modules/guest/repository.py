"""Guest web chat queries: the organization's database (db) holds the guests, their browsers, links, LINE codes and
notices; the control database (cd) only the index of organizations holding a guest with a proven email."""
import json

from backend.database.db import one, rows
from backend.modules.guest.model import LINK_USES
from backend.utils.dates import now

# A visitor's own conversations: the web conversations it started.
OWNED = "c.channel='web' AND c.id IN (SELECT conversation_id FROM guest_conversations WHERE visitor_id=?)"


# Visitors
def insert_visitor(db, visitor_id, contact_id, name):
    db.execute('INSERT INTO guest_visitors(id,contact_id,name,created_at,last_seen_at) VALUES(?,?,?,?,?)',
               (visitor_id,contact_id,name,now(),now()))


def visitor(db, visitor_id):
    return one(db,'SELECT * FROM guest_visitors WHERE id=?',(visitor_id,))


def set_visitor_contact(db, visitor_id, contact_id):
    db.execute('UPDATE guest_visitors SET contact_id=? WHERE id=?',(contact_id,visitor_id))


def set_name(db, visitor_id, name):
    db.execute('UPDATE guest_visitors SET name=? WHERE id=?',(name,visitor_id))


def set_email(db, visitor_id, email, verified):
    db.execute('UPDATE guest_visitors SET email=?,email_verified_at=? WHERE id=?',(email,now() if verified else None,visitor_id))


def set_phone(db, visitor_id, phone, verified):
    db.execute('UPDATE guest_visitors SET phone=?,phone_verified_at=? WHERE id=?',(phone,now() if verified else None,visitor_id))


def touch_visitor(db, visitor_id):
    db.execute('UPDATE guest_visitors SET last_seen_at=? WHERE id=?',(now(),visitor_id))


def set_account(db, visitor_id, account_id):
    db.execute('UPDATE guest_visitors SET account_id=? WHERE id=?',(account_id,visitor_id))


def verified_visitors(db, email):
    """Guests not merged yet whose proven email is this one."""
    return rows(db,'SELECT * FROM guest_visitors WHERE lower(email)=? AND email_verified_at IS NOT NULL AND account_id IS NULL',(email.lower(),))


def move_contact(db, from_contact_id, to_contact_id):
    """Staff merged two contacts: the guest of the old one is the guest of the one it was merged into."""
    db.execute('UPDATE guest_visitors SET contact_id=? WHERE contact_id=?',(to_contact_id,from_contact_id))


def visitors_of_contact(db, contact_id):
    return [row[0] for row in db.execute('SELECT id FROM guest_visitors WHERE contact_id=?',(contact_id,))]


def forget_visitor(db, visitor_id):
    """Everything that lets anyone continue as this guest (the conversations stay with the contact)."""
    for table in ('guest_devices','guest_links','guest_line_codes','guest_line_links'):
        db.execute(f'DELETE FROM {table} WHERE visitor_id=?',(visitor_id,))
    db.execute("UPDATE guest_notifications SET sent_at=?,error='off' WHERE visitor_id=? AND sent_at IS NULL",(now(),visitor_id))


def delete_visitor(db, visitor_id):
    forget_visitor(db,visitor_id)
    for table in ('guest_conversations','guest_seen','guest_notifications'):
        db.execute(f'DELETE FROM {table} WHERE visitor_id=?',(visitor_id,))
    db.execute('DELETE FROM guest_visitors WHERE id=?',(visitor_id,))


def reach(db, contact_ids):
    """{contact_id: row} of the guests not merged yet on these contacts: proven email / phone, a browser, LINE."""
    found = {}
    for row in rows(db,'''SELECT v.contact_id,v.email_verified_at,v.phone_verified_at,
            EXISTS(SELECT 1 FROM guest_devices d WHERE d.visitor_id=v.id) AS browser,
            EXISTS(SELECT 1 FROM guest_line_links l WHERE l.visitor_id=v.id) AS line
            FROM guest_visitors v WHERE v.account_id IS NULL AND v.contact_id IN (SELECT value FROM json_each(?))''',
            (json.dumps(sorted(set(contact_ids))),)):
        found.setdefault(row['contact_id'],[]).append(row)
    return found


# Browsers (devices)
def insert_device(db, token_hash, visitor_id, csrf, remember, user_agent, ip):
    db.execute('INSERT INTO guest_devices VALUES(?,?,?,?,?,?,?,?)',(token_hash,visitor_id,csrf,int(remember),user_agent,ip,now(),now()))


def device(db, token_hash):
    """The browser and its visitor (not merged into an account), or None."""
    return one(db,'''SELECT d.token_hash,d.visitor_id,d.csrf,d.remember,d.last_seen_at AS device_seen_at FROM guest_devices d
                     JOIN guest_visitors v ON v.id=d.visitor_id WHERE d.token_hash=? AND v.account_id IS NULL''',(token_hash,))


def touch_device(db, token_hash):
    db.execute('UPDATE guest_devices SET last_seen_at=? WHERE token_hash=?',(now(),token_hash))


def set_remember(db, token_hash, remember):
    db.execute('UPDATE guest_devices SET remember=? WHERE token_hash=?',(int(remember),token_hash))


def delete_device(db, token_hash):
    db.execute('DELETE FROM guest_devices WHERE token_hash=?',(token_hash,))


def delete_unused_devices(db, before):
    db.execute('DELETE FROM guest_devices WHERE last_seen_at<?',(before,))


# Conversations
def add_conversation(db, conversation_id, visitor_id):
    db.execute('INSERT INTO guest_conversations VALUES(?,?,?)',(conversation_id,visitor_id,now()))


def started_since(db, visitor_id, since):
    return db.execute('SELECT COUNT(*) FROM guest_conversations WHERE visitor_id=? AND created_at>=?',(visitor_id,since)).fetchone()[0]


def conversation_count(db, visitor_id):
    return db.execute('SELECT COUNT(*) FROM guest_conversations WHERE visitor_id=?',(visitor_id,)).fetchone()[0]


def conversations_of(db, visitor_id, survey_since):
    """Newest first; unread: the last message the guest can see is the team's and came after the guest last read it."""
    return rows(db,f'''SELECT c.id,c.subject,c.status,c.updated_at,
        (SELECT m.kind FROM messages m WHERE m.conversation_id=c.id AND m.kind!='note' ORDER BY m.created_at DESC,m.rowid DESC LIMIT 1) AS last_kind,
        (SELECT s.seen_at FROM guest_seen s WHERE s.visitor_id=? AND s.conversation_id=c.id) AS seen_at,
        EXISTS(SELECT 1 FROM csat_surveys cs WHERE cs.conversation_id=c.id AND cs.answered_at IS NULL AND cs.sent_at>=?) AS survey_pending
        FROM conversations c WHERE {OWNED} ORDER BY c.updated_at DESC LIMIT 100''',(visitor_id,survey_since,visitor_id))


def owned_conversation(db, visitor_id, conversation_id):
    return one(db,f'SELECT c.* FROM conversations c WHERE c.id=? AND {OWNED}',(conversation_id,visitor_id))


def latest_conversation(db, visitor_id):
    row = one(db,f'SELECT c.id FROM conversations c WHERE {OWNED} ORDER BY c.updated_at DESC LIMIT 1',(visitor_id,))
    return row['id'] if row else None


def visitor_of_conversation(db, conversation_id):
    """The guest (not merged yet) who started this web conversation, or None."""
    return one(db,'''SELECT v.* FROM guest_visitors v JOIN guest_conversations g ON g.visitor_id=v.id
                     WHERE g.conversation_id=? AND v.account_id IS NULL''',(conversation_id,))


def mark_seen(db, visitor_id, conversation_id):
    db.execute('INSERT INTO guest_seen VALUES(?,?,?) ON CONFLICT(visitor_id,conversation_id) DO UPDATE SET seen_at=excluded.seen_at',
               (visitor_id,conversation_id,now()))


def copy_seen(db, visitor_id, account_id):
    """What the guest read counts as read by the account the history moved into."""
    db.execute('''INSERT INTO customer_seen SELECT ?,conversation_id,seen_at FROM guest_seen WHERE visitor_id=?
                  ON CONFLICT(account_id,conversation_id) DO UPDATE SET seen_at=max(seen_at,excluded.seen_at)''',(account_id,visitor_id))


# Cases: tickets holding one of the visitor's conversations (only what the customer should see)
def owned_case(db, visitor_id, case_id):
    from backend.modules.customers.repository import CASE_COLUMNS
    return one(db,f'''SELECT {CASE_COLUMNS} FROM tickets t WHERE t.id=? AND t.id IN
        (SELECT tc.ticket_id FROM ticket_conversations tc JOIN conversations c ON c.id=tc.conversation_id WHERE {OWNED})''',(case_id,visitor_id))


def case_conversations(db, visitor_id, case_id):
    return rows(db,f'''SELECT c.id,c.subject,c.status,c.updated_at FROM conversations c JOIN ticket_conversations tc ON tc.conversation_id=c.id
        WHERE tc.ticket_id=? AND {OWNED} ORDER BY c.updated_at DESC''',(case_id,visitor_id))


# Follow links
def insert_link(db, token_hash, visitor_id, via, target, expires_at):
    db.execute('INSERT INTO guest_links(token_hash,visitor_id,via,target,created_at,expires_at) VALUES(?,?,?,?,?,?)',
               (token_hash,visitor_id,via,target,now(),expires_at))


def delete_link(db, token_hash):
    db.execute('DELETE FROM guest_links WHERE token_hash=?',(token_hash,))


def revoke_older_links(db, visitor_id, via, keep_hash):
    db.execute('UPDATE guest_links SET revoked_at=? WHERE visitor_id=? AND via=? AND token_hash!=? AND revoked_at IS NULL',
               (now(),visitor_id,via,keep_hash))


def live_link(db, token_hash):
    return one(db,'SELECT * FROM guest_links WHERE token_hash=? AND revoked_at IS NULL AND expires_at>? AND uses<?',(token_hash,now(),LINK_USES))


def use_link(db, token_hash):
    db.execute('UPDATE guest_links SET uses=uses+1 WHERE token_hash=?',(token_hash,))


def delete_dead_links(db):
    db.execute('DELETE FROM guest_links WHERE expires_at<=? OR revoked_at IS NOT NULL OR uses>=?',(now(),LINK_USES))


# LINE
def line_link(db, visitor_id):
    return one(db,'SELECT * FROM guest_line_links WHERE visitor_id=?',(visitor_id,))


def set_line_link(db, visitor_id, line_user_id):
    db.execute('DELETE FROM guest_line_links WHERE visitor_id=? OR line_user_id=?',(visitor_id,line_user_id))
    db.execute('INSERT INTO guest_line_links VALUES(?,?,?)',(visitor_id,line_user_id,now()))


def delete_line_link(db, visitor_id):
    db.execute('DELETE FROM guest_line_links WHERE visitor_id=?',(visitor_id,))


def replace_line_code(db, code_hash, visitor_id, expires_at):
    db.execute('DELETE FROM guest_line_codes WHERE visitor_id=? OR expires_at<=?',(visitor_id,now()))
    db.execute('INSERT INTO guest_line_codes(code_hash,visitor_id,expires_at,created_at) VALUES(?,?,?,?)',(code_hash,visitor_id,expires_at,now()))


def live_line_code(db, code_hash):
    return one(db,'SELECT * FROM guest_line_codes WHERE code_hash=? AND expires_at>?',(code_hash,now()))


def delete_line_codes(db, visitor_id):
    db.execute('DELETE FROM guest_line_codes WHERE visitor_id=?',(visitor_id,))


def count_wrong_code(db, since):
    db.execute('UPDATE guest_line_codes SET attempts=attempts+1 WHERE expires_at>?',(since,))


def drop_worn_codes(db, max_attempts):
    db.execute('DELETE FROM guest_line_codes WHERE attempts>=?',(max_attempts,))


def delete_expired_codes(db):
    db.execute('DELETE FROM guest_line_codes WHERE expires_at<=?',(now(),))


# Notices
def notice_open(db, visitor_id, conversation_id, channel):
    """A reply notice of this conversation on this channel is waiting, or one went out and the guest has not read the
    conversation since (the same unread spell)."""
    return bool(one(db,'''SELECT 1 FROM guest_notifications n WHERE n.visitor_id=? AND n.conversation_id=? AND n.channel=? AND n.kind='reply'
        AND (n.sent_at IS NULL OR (n.error='' AND n.created_at>COALESCE((SELECT s.seen_at FROM guest_seen s
             WHERE s.visitor_id=n.visitor_id AND s.conversation_id=n.conversation_id),'')))''',(visitor_id,conversation_id,channel)))


def insert_notice(db, notice_id, visitor_id, conversation_id, channel, kind='reply', event='reply'):
    db.execute('INSERT INTO guest_notifications(id,visitor_id,conversation_id,channel,kind,created_at,event) VALUES(?,?,?,?,?,?,?)',
               (notice_id,visitor_id,conversation_id,channel,kind,now(),event))


def due_notices(db, reply_before, max_attempts):
    return rows(db,'''SELECT n.*,s.seen_at FROM guest_notifications n
        LEFT JOIN guest_seen s ON s.visitor_id=n.visitor_id AND s.conversation_id=n.conversation_id
        WHERE n.sent_at IS NULL AND n.attempts<? AND (n.kind='linked' OR n.created_at<=?) ORDER BY n.created_at,n.rowid LIMIT 20''',
        (max_attempts,reply_before))


def claim_notice(db, notice_id):
    db.execute('UPDATE guest_notifications SET attempts=attempts+1 WHERE id=?',(notice_id,))


def finish_notice(db, notice_id, error=''):
    db.execute('UPDATE guest_notifications SET sent_at=?,error=? WHERE id=?',(now(),error,notice_id))


def fail_notice(db, notice_id, error):
    db.execute('UPDATE guest_notifications SET error=? WHERE id=?',(error,notice_id))


# Settings (tenant)
def setting(db, key):
    row = one(db,'SELECT value FROM settings WHERE key=?',(key,))
    return row['value'] if row else None


def save_setting(db, key, value):
    db.execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(key,value))


# Organizations holding a guest with a proven email (control)
def index_email(cd, email, tenant_id):
    cd.execute('INSERT OR IGNORE INTO guest_verified_emails VALUES(?,?,?)',(email.lower(),tenant_id,now()))


def tenants_with_email(cd, email):
    return [row[0] for row in cd.execute('SELECT tenant_id FROM guest_verified_emails WHERE email=?',(email.lower(),))]


def unindex_email(cd, email, tenant_id):
    cd.execute('DELETE FROM guest_verified_emails WHERE email=? AND tenant_id=?',(email.lower(),tenant_id))
