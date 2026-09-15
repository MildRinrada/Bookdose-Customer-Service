"""Customer account queries. Accounts, sign-ups, reset links, sessions and the organizations an account is connected
with are in the control database (cd); what an account owns inside an organization is in that organization's
database (db)."""
from backend.database.db import one, rows
from backend.utils.dates import now

# The customer's own conversations in an organization: web conversations of the contacts their account owns there.
OWNED = "c.channel='web' AND c.contact_id IN (SELECT contact_id FROM customer_contacts WHERE account_id=?)"


# Sign-ups waiting for the email to be confirmed (control)
def insert_signup(cd, token_hash, v, consent_version, expires_at, tenant_id=None):
    cd.execute('''INSERT INTO customer_signups(token_hash,email,name,phone,password,consent_version,consent_at,expires_at,created_at,tenant_id)
                  VALUES(?,?,?,?,?,?,?,?,?,?)''',
               (token_hash,v['email'],v['name'],v['phone'],v['password'],consent_version,now(),expires_at,now(),tenant_id))


def find_signup(cd, token_hash):
    return one(cd,'SELECT * FROM customer_signups WHERE token_hash=? AND expires_at>?',(token_hash,now()))


def latest_signup(cd, email):
    return one(cd,'SELECT * FROM customer_signups WHERE email=? AND expires_at>? ORDER BY created_at DESC,rowid DESC LIMIT 1',(email,now()))


def delete_signups(cd, email):
    cd.execute('DELETE FROM customer_signups WHERE email=?',(email,))


def purge_signups(cd):
    cd.execute('DELETE FROM customer_signups WHERE expires_at<=?',(now(),))


# Accounts (control)
def find(cd, account_id):
    return one(cd,'SELECT * FROM customer_accounts WHERE id=?',(account_id,))


def find_by_email(cd, email):
    return one(cd,'SELECT * FROM customer_accounts WHERE email=?',(email,))


def insert_account(cd, account_id, signup, email_verified=True):
    cd.execute('''INSERT INTO customer_accounts(id,name,email,phone,password,consent_version,consent_at,verified_at,created_at,email_verified)
                  VALUES(?,?,?,?,?,?,?,?,?,?)''',(account_id,signup['name'],signup['email'],signup['phone'],signup['password'],
                  signup['consent_version'],signup['consent_at'],now(),now(),int(email_verified)))


def mark_email_verified(cd, account_id):
    cd.execute('UPDATE customer_accounts SET email_verified=1,verified_at=? WHERE id=?',(now(),account_id))


def set_password(cd, account_id, password):
    cd.execute('UPDATE customer_accounts SET password=? WHERE id=?',(password,account_id))


def set_profile(cd, account_id, name, phone):
    cd.execute('UPDATE customer_accounts SET name=?,phone=? WHERE id=?',(name,phone,account_id))


def set_notify_email(cd, account_id, enabled):
    cd.execute('UPDATE customer_accounts SET notify_email=? WHERE id=?',(int(enabled),account_id))


def touch_login(cd, account_id):
    cd.execute('UPDATE customer_accounts SET last_login_at=? WHERE id=?',(now(),account_id))


# Password reset links (control)
def insert_reset(cd, token_hash, account_id, expires_at):
    cd.execute('INSERT INTO customer_resets VALUES(?,?,?,?)',(token_hash,account_id,expires_at,now()))


def find_reset(cd, token_hash):
    return one(cd,'SELECT * FROM customer_resets WHERE token_hash=? AND expires_at>?',(token_hash,now()))


def latest_reset(cd, account_id):
    return one(cd,'SELECT * FROM customer_resets WHERE account_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1',(account_id,))


def delete_resets(cd, account_id):
    cd.execute('DELETE FROM customer_resets WHERE account_id=? OR expires_at<=?',(account_id,now()))


# Sessions (control)
def insert_session(cd, token_hash, account_id, csrf, expires_at):
    cd.execute('INSERT INTO customer_sessions VALUES(?,?,?,?,?)',(token_hash,account_id,csrf,expires_at,now()))


def find_session(cd, token_hash):
    return one(cd,'''SELECT s.token_hash,s.csrf,s.account_id,a.name,a.email,a.phone,a.email_verified,a.notify_email,
                   a.consent_version,a.consent_at,a.created_at FROM customer_sessions s
                   JOIN customer_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?''',(token_hash,now()))


def delete_session(cd, token_hash):
    cd.execute('DELETE FROM customer_sessions WHERE token_hash=?',(token_hash,))


def delete_sessions(cd, account_id):
    cd.execute('DELETE FROM customer_sessions WHERE account_id=?',(account_id,))


def delete_other_sessions(cd, account_id, keep_token_hash):
    cd.execute('DELETE FROM customer_sessions WHERE account_id=? AND token_hash!=?',(account_id,keep_token_hash))


def delete_expired_sessions(cd):
    cd.execute('DELETE FROM customer_sessions WHERE expires_at<=?',(now(),))


# Organizations an account is connected with (control)
def join_org(cd, account_id, tenant_id):
    cd.execute('INSERT OR IGNORE INTO customer_orgs VALUES(?,?,?)',(account_id,tenant_id,now()))


def org_ids(cd, account_id):
    return [row[0] for row in cd.execute('SELECT tenant_id FROM customer_orgs WHERE account_id=? ORDER BY joined_at,rowid',(account_id,))]


# What the account is inside one organization (tenant)
def member_contact(db, account_id):
    """The account's own contact in this organization, or None before it has one."""
    row = one(db,'SELECT contact_id FROM customer_members WHERE account_id=?',(account_id,))
    return row['contact_id'] if row else None


def set_member(db, account_id, contact_id):
    db.execute('INSERT INTO customer_members VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET contact_id=excluded.contact_id',
               (account_id,contact_id,now()))


def link_contact(db, account_id, contact_id):
    db.execute('INSERT OR IGNORE INTO customer_contacts VALUES(?,?)',(account_id,contact_id))


def earlier_portal_contacts(db, email):
    """Contacts the support page created before accounts existed, with this email, newest first."""
    return [row['id'] for row in rows(db,"SELECT id FROM contacts WHERE lower(email)=? AND created_by='portal' ORDER BY created_at DESC",(email,))]


def owners_of_contact(db, contact_id):
    """The accounts that may read this contact's web conversations."""
    return [row[0] for row in db.execute('SELECT account_id FROM customer_contacts WHERE contact_id=? ORDER BY rowid',(contact_id,))]


def account_of_contact(db, contact_id):
    """The account whose own record this contact is (not merely one it can read), or None."""
    return one(db,'SELECT account_id FROM customer_members WHERE contact_id=?',(contact_id,))


def move_contact(db, from_contact_id, to_contact_id):
    """Staff merged two contacts: accounts that owned the old one own the one it was merged into."""
    db.execute('INSERT OR IGNORE INTO customer_contacts SELECT account_id,? FROM customer_contacts WHERE contact_id=?',(to_contact_id,from_contact_id))
    db.execute('DELETE FROM customer_contacts WHERE contact_id=?',(from_contact_id,))
    db.execute('UPDATE customer_members SET contact_id=? WHERE contact_id=?',(to_contact_id,from_contact_id))


# The category the customer chose for a conversation (tenant)
def set_category(db, conversation_id, category):
    db.execute('INSERT OR REPLACE INTO conversation_categories VALUES(?,?)',(conversation_id,category))


def category_of(db, conversation_id):
    row = one(db,'SELECT category FROM conversation_categories WHERE conversation_id=?',(conversation_id,))
    return row['category'] if row else ''


# The customer's conversations (tenant)
def conversations_of(db, account_id, survey_since):
    """survey_pending: a satisfaction survey sent after survey_since is waiting for an answer."""
    return rows(db,f'''SELECT c.id,c.subject,c.status,c.created_at,c.updated_at,t.id AS ticket_id,t.number AS ticket_number,t.status AS ticket_status,
        (SELECT cc.category FROM conversation_categories cc WHERE cc.conversation_id=c.id) AS category,
        (SELECT m.kind FROM messages m WHERE m.conversation_id=c.id AND m.kind!='note' ORDER BY m.created_at DESC,m.rowid DESC LIMIT 1) AS last_kind,
        (SELECT m.body FROM messages m WHERE m.conversation_id=c.id AND m.kind!='note' ORDER BY m.created_at DESC,m.rowid DESC LIMIT 1) AS last_body,
        EXISTS(SELECT 1 FROM csat_surveys cs WHERE cs.conversation_id=c.id AND cs.answered_at IS NULL AND cs.sent_at>=?) AS survey_pending,
        (SELECT s.seen_at FROM customer_seen s WHERE s.account_id=? AND s.conversation_id=c.id) AS seen_at
        FROM conversations c LEFT JOIN ticket_conversations tc ON tc.conversation_id=c.id LEFT JOIN tickets t ON t.id=tc.ticket_id
        WHERE {OWNED} ORDER BY c.updated_at DESC LIMIT 100''',(survey_since,account_id,account_id))


def owned_conversation(db, account_id, conversation_id):
    return one(db,f'SELECT c.* FROM conversations c WHERE c.id=? AND {OWNED}',(conversation_id,account_id))


# The customer's cases: tickets on the contacts the account owns, or holding one of its conversations.
# Only what the customer should see: no priority, team, assignee or internal notes.
CASE_COLUMNS = '''t.id,t.number,t.subject,t.category,t.status,t.created_at,t.updated_at,t.first_response_due_at,t.first_response_at,
    t.resolution_due_at,t.resolved_at,(SELECT MIN(f.due_at) FROM followups f WHERE f.ticket_id=t.id AND f.done_at IS NULL) AS next_followup_at'''
OWNED_CASE = f'''(t.contact_id IN (SELECT contact_id FROM customer_contacts WHERE account_id=?)
    OR t.id IN (SELECT tc.ticket_id FROM ticket_conversations tc JOIN conversations c ON c.id=tc.conversation_id WHERE {OWNED}))'''


def cases_of(db, account_id):
    return rows(db,f'SELECT {CASE_COLUMNS} FROM tickets t WHERE {OWNED_CASE} ORDER BY t.updated_at DESC LIMIT 100',(account_id,account_id))


def owned_case(db, account_id, case_id):
    return one(db,f'SELECT {CASE_COLUMNS} FROM tickets t WHERE t.id=? AND {OWNED_CASE}',(case_id,account_id,account_id))


def case_conversations(db, account_id, case_id):
    """The case's conversations the customer can open (their own web conversations)."""
    return rows(db,f'''SELECT c.id,c.subject,c.status,c.updated_at FROM conversations c JOIN ticket_conversations tc ON tc.conversation_id=c.id
        WHERE tc.ticket_id=? AND {OWNED} ORDER BY c.updated_at DESC''',(case_id,account_id))


def case_followups(db, case_id):
    """When the team plans to get back to the customer (the note is internal and stays out)."""
    return [row['due_at'] for row in rows(db,'SELECT due_at FROM followups WHERE ticket_id=? AND done_at IS NULL ORDER BY due_at',(case_id,))]


def case_rating(db, case_id):
    row = one(db,'SELECT rating FROM csat_surveys WHERE ticket_id=? AND rating IS NOT NULL ORDER BY answered_at DESC LIMIT 1',(case_id,))
    return row['rating'] if row else None


def mark_seen(db, account_id, conversation_id):
    db.execute('INSERT INTO customer_seen VALUES(?,?,?) ON CONFLICT(account_id,conversation_id) DO UPDATE SET seen_at=excluded.seen_at',
               (account_id,conversation_id,now()))


# Email notices of new replies (tenant)
def pending_notification(db, conversation_id):
    return one(db,'SELECT id FROM customer_notifications WHERE conversation_id=? AND sent_at IS NULL',(conversation_id,))


def insert_notification(db, notification_id, account_id, conversation_id):
    db.execute('INSERT INTO customer_notifications(id,account_id,conversation_id,created_at) VALUES(?,?,?,?)',(notification_id,account_id,conversation_id,now()))


def due_notifications(db, created_before):
    return rows(db,'''SELECT n.*,c.subject,s.seen_at FROM customer_notifications n JOIN conversations c ON c.id=n.conversation_id
        LEFT JOIN customer_seen s ON s.account_id=n.account_id AND s.conversation_id=n.conversation_id
        WHERE n.sent_at IS NULL AND n.attempts<3 AND n.created_at<=? ORDER BY n.created_at LIMIT 20''',(created_before,))


def claim_notification(db, notification_id):
    db.execute('UPDATE customer_notifications SET attempts=attempts+1 WHERE id=?',(notification_id,))


def finish_notification(db, notification_id, error=''):
    db.execute('UPDATE customer_notifications SET sent_at=?,error=? WHERE id=?',(now(),error,notification_id))


def fail_notification(db, notification_id, error):
    db.execute('UPDATE customer_notifications SET error=? WHERE id=?',(error,notification_id))
