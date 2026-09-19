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


def set_notify_prefs(cd, account_id, prefs_json):
    cd.execute('UPDATE customer_accounts SET notify_prefs=? WHERE id=?',(prefs_json,account_id))


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


# Sessions (control). id is the plain name a session is listed and signed out by; the token itself never leaves
# the browser's cookie and only its hash is stored.
def insert_session(cd, token_hash, account_id, csrf, expires_at, session_id, user_agent='', ip=''):
    cd.execute('''INSERT INTO customer_sessions(token_hash,account_id,csrf,expires_at,created_at,id,user_agent,ip,last_seen_at,last_active_at)
                  VALUES(?,?,?,?,?,?,?,?,?,?)''',(token_hash,account_id,csrf,expires_at,now(),session_id,user_agent,ip,now(),now()))


def find_session(cd, token_hash):
    """The session with its account, whatever its limits say (customers.service.load_session judges them)."""
    return one(cd,'''SELECT s.token_hash,s.csrf,s.account_id,s.id AS session_id,s.last_seen_at,s.created_at AS session_created_at,
                   s.last_active_at,s.expires_at,a.name,a.email,a.phone,
                   a.email_verified,a.notify_email,a.notify_prefs,a.consent_version,a.consent_at,a.created_at
                   FROM customer_sessions s
                   JOIN customer_accounts a ON a.id=s.account_id WHERE s.token_hash=?''',(token_hash,))


def touch_session(cd, token_hash):
    cd.execute('UPDATE customer_sessions SET last_seen_at=? WHERE token_hash=?',(now(),token_hash))


def touch_activity(cd, token_hash):
    """The customer really used the session (a change, or the page's activity signal)."""
    moment = now()
    cd.execute('UPDATE customer_sessions SET last_active_at=?,last_seen_at=? WHERE token_hash=?',(moment,moment,token_hash))
    return moment


def sessions_of(cd, account_id):
    """The account's live sessions, newest first (never the token hash: the list is shown to the customer)."""
    cd.execute("UPDATE customer_sessions SET id=lower(hex(randomblob(16))) WHERE id=''")
    return rows(cd,'''SELECT id,account_id,user_agent,ip,created_at,last_seen_at,last_active_at,expires_at,token_hash FROM customer_sessions
                      WHERE account_id=? AND expires_at>? ORDER BY created_at DESC''',(account_id,now()))


def delete_session_by_id(cd, account_id, session_id):
    return cd.execute('DELETE FROM customer_sessions WHERE account_id=? AND id=?',(account_id,session_id)).rowcount


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


# A reference the customer gave when starting the chat (an earlier case number, a member number…)
def set_reference(db, conversation_id, reference):
    db.execute('INSERT OR REPLACE INTO conversation_references VALUES(?,?)',(conversation_id,reference))


def reference_of(db, conversation_id):
    row = one(db,'SELECT reference FROM conversation_references WHERE conversation_id=?',(conversation_id,))
    return row['reference'] if row else ''


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


def insert_notification(db, notification_id, account_id, conversation_id, event='reply'):
    db.execute('INSERT INTO customer_notifications(id,account_id,conversation_id,created_at,event) VALUES(?,?,?,?,?)',
               (notification_id,account_id,conversation_id,now(),event))


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


# LINE linking (tenant)
def line_link(db, account_id):
    return one(db,'SELECT * FROM customer_line_links WHERE account_id=?',(account_id,))


def set_line_link(db, account_id, line_user_id):
    """One LINE user per account and one account per LINE user: a new link replaces either old one."""
    db.execute('DELETE FROM customer_line_links WHERE account_id=? OR line_user_id=?',(account_id,line_user_id))
    db.execute('INSERT INTO customer_line_links VALUES(?,?,?)',(account_id,line_user_id,now()))


def delete_line_link(db, account_id):
    db.execute('DELETE FROM customer_line_links WHERE account_id=?',(account_id,))


def replace_line_code(db, code_hash, account_id, expires_at):
    """The account's new code; its earlier ones stop working."""
    db.execute('DELETE FROM customer_line_codes WHERE account_id=? OR expires_at<=?',(account_id,now()))
    db.execute('INSERT INTO customer_line_codes(code_hash,account_id,expires_at,created_at) VALUES(?,?,?,?)',
               (code_hash,account_id,expires_at,now()))


def live_line_code(db, code_hash):
    return one(db,'SELECT * FROM customer_line_codes WHERE code_hash=? AND expires_at>?',(code_hash,now()))


def pending_line_code(db, account_id):
    return one(db,'SELECT expires_at FROM customer_line_codes WHERE account_id=? AND expires_at>?',(account_id,now()))


def delete_line_codes(db, account_id):
    db.execute('DELETE FROM customer_line_codes WHERE account_id=?',(account_id,))


def count_wrong_code(db, since):
    """A wrong code was sent to the LINE account (in a 1:1 chat, or in a group): every live code has one attempt less."""
    db.execute('UPDATE customer_line_codes SET attempts=attempts+1 WHERE expires_at>?',(since,))


def drop_worn_codes(db, max_attempts):
    db.execute('DELETE FROM customer_line_codes WHERE attempts>=?',(max_attempts,))


def line_guesses(db, line_user_id):
    return one(db,'SELECT * FROM customer_line_guesses WHERE line_user_id=?',(line_user_id,))


def record_line_guess(db, line_user_id, window_start):
    """One more wrong code from this LINE user; the count starts over once its window has passed."""
    db.execute('''INSERT INTO customer_line_guesses VALUES(?,1,?) ON CONFLICT(line_user_id) DO UPDATE SET
                  failures=CASE WHEN since<=? THEN 1 ELSE failures+1 END,since=CASE WHEN since<=? THEN excluded.since ELSE since END''',
               (line_user_id,now(),window_start,window_start))


# Notices waiting to be sent (tenant)
def insert_alert(db, alert_id, account_id, channel, subject, text, link, dedup_key=None):
    """Queue one notice; returns False when one with the same dedup_key exists already (told before)."""
    return db.execute('''INSERT OR IGNORE INTO customer_alert_outbox(id,account_id,channel,subject,text,link,dedup_key,created_at,next_at)
                         VALUES(?,?,?,?,?,?,?,?,?)''',(alert_id,account_id,channel,subject,text,link,dedup_key,now(),now())).rowcount==1


def due_alerts(db, limit=20):
    """Unsent notices whose time has come."""
    return rows(db,'SELECT * FROM customer_alert_outbox WHERE sent_at IS NULL AND next_at<=? ORDER BY created_at,rowid LIMIT ?',(now(),limit))


def claim_alert(db, alert_id, retry_at):
    """Taken for sending: a worker that stops halfway leaves it to be tried again at retry_at."""
    db.execute('UPDATE customer_alert_outbox SET attempts=attempts+1,next_at=? WHERE id=?',(retry_at,alert_id))


def finish_alert(db, alert_id, error=''):
    db.execute('UPDATE customer_alert_outbox SET sent_at=?,error=? WHERE id=?',(now(),error,alert_id))


def retry_alert(db, alert_id, error, next_at):
    db.execute('UPDATE customer_alert_outbox SET error=?,next_at=? WHERE id=?',(error,next_at,alert_id))
