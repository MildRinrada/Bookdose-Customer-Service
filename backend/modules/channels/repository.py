"""LINE / Email queries and the per-organization channel credential files."""
import json
from pathlib import Path

from backend.database import db as D
from backend.database.db import one, rows
from backend.modules.channels.model import KINDS
from backend.utils.dates import now
from backend.utils import secret_box
from backend.utils.security import uid
from backend.utils.validation import require


# Credentials: a private JSON file per organization and channel, never in the database, API responses or backups,
# and sealed with the platform's secret key (utils/secret_box).
def secret_path(tenant_id, kind):
    D.tenant_path(tenant_id)
    require(kind in KINDS,'ช่องทางไม่ถูกต้อง')
    return D.DATA/'secrets'/f'{tenant_id}.{kind}.json'


def read_secret(tenant_id, kind):
    text = secret_box.read_file(secret_path(tenant_id,kind))
    return json.loads(text) if text else {}


def write_secret(tenant_id, kind, value):
    """Save the credentials, or delete the file when value is empty."""
    path = secret_path(tenant_id,kind)
    if not value:
        path.unlink(missing_ok=True)
        return
    secret_box.write_file(path,json.dumps(value))


def tenant_id_of(db):
    """The organization a tenant database connection belongs to (its file name)."""
    return Path(db.execute('PRAGMA database_list').fetchone()[2]).stem


# Routes (control database)
def find_route(cd, route_id):
    return one(cd,'SELECT * FROM channel_routes WHERE id=?',(route_id,))


def active_line_route(cd, route_id):
    return one(cd,"SELECT r.* FROM channel_routes r JOIN tenants t ON t.id=r.tenant_id WHERE r.id=? AND r.kind='line' AND t.status='active'",(route_id,))


def identity_taken(cd, kind, identity, route_id):
    return bool(one(cd,'SELECT id FROM channel_routes WHERE kind=? AND identity=? AND id!=?',(kind,identity,route_id)))


def insert_route(cd, route_id, tenant_id, kind, identity):
    cd.execute('INSERT INTO channel_routes VALUES(?,?,?,?)',(route_id,tenant_id,kind,identity))


def set_route_identity(cd, route_id, identity):
    cd.execute('UPDATE channel_routes SET identity=? WHERE id=?',(identity,route_id))


# Settings
def find_setting(db, kind):
    row = one(db,'SELECT * FROM channel_settings WHERE kind=?',(kind,))
    if row:
        row['config'] = json.loads(row['config'])
    return row


def insert_setting(db, kind, route_id, generation):
    db.execute('INSERT INTO channel_settings(kind,route_id,generation) VALUES(?,?,?)',(kind,route_id,generation))


def save_setting(db, kind, enabled, config_json, generation, last_checked):
    """New settings start a new generation: pending polls are released and errors cleared."""
    db.execute('''UPDATE channel_settings SET enabled=?,config=?,generation=?,last_error='',
                  last_checked=?,next_poll=NULL,poll_lease=NULL,poll_started=NULL WHERE kind=?''',
               (int(enabled),config_json,generation,last_checked,kind))


def set_check_result(db, kind, error):
    db.execute('UPDATE channel_settings SET last_error=?,last_checked=? WHERE kind=?',(error,now(),kind))


def set_mailbox_checkpoint(db, kind, uidvalidity, last_uid):
    db.execute('UPDATE channel_settings SET uidvalidity=?,last_uid=? WHERE kind=?',(uidvalidity,last_uid,kind))


def set_line_received(db):
    db.execute("UPDATE channel_settings SET last_received=?,last_error='' WHERE kind='line'",(now(),))


def outbox_counts(db, kind):
    return rows(db,'SELECT status,COUNT(*) AS count FROM channel_outbox WHERE kind=? GROUP BY status',(kind,))


def recent_events(db, kind):
    return rows(db,'SELECT status,error,created_at FROM channel_inbox WHERE kind=? ORDER BY created_at DESC LIMIT 10',(kind,))


def bot_conversations(db, kind):
    return rows(db,"SELECT c.* FROM conversations c JOIN ai_conversations a ON a.conversation_id=c.id WHERE c.channel=? AND a.mode='bot'",(kind,))


# Email polling
def claim_poll(db, lease, next_poll):
    db.execute("UPDATE channel_settings SET poll_lease=?,poll_started=?,next_poll=? WHERE kind='email'",(lease,now(),next_poll))


def release_poll(db):
    db.execute("UPDATE channel_settings SET poll_lease=NULL,poll_started=NULL WHERE kind='email'")


def finish_poll(db, error):
    db.execute("UPDATE channel_settings SET poll_lease=NULL,poll_started=NULL,last_checked=?,last_error=? WHERE kind='email'",(now(),error))


def request_sync(db):
    db.execute("UPDATE channel_settings SET next_poll=NULL WHERE kind='email'")


def bump_last_uid(db, mail_uid):
    db.execute("UPDATE channel_settings SET last_uid=MAX(last_uid,?) WHERE kind='email'",(mail_uid,))


def record_email_received(db, mail_uid):
    db.execute("UPDATE channel_settings SET last_uid=MAX(last_uid,?),last_received=? WHERE kind='email'",(mail_uid,now()))


# Received events (inbox)
def inbox_event_exists(db, route_id, event_key):
    return bool(one(db,'SELECT id FROM channel_inbox WHERE route_id=? AND event_key=?',(route_id,event_key)))


def insert_line_event(db, route_id, event_key, payload_json, generation):
    """Duplicates (LINE redelivers) are ignored by the unique event key."""
    db.execute('''INSERT OR IGNORE INTO channel_inbox(id,route_id,event_key,kind,payload,generation,created_at,updated_at)
                  VALUES(?,?,?,'line',?,?,?,?)''',(uid(),route_id,event_key,payload_json,generation,now(),now()))


def insert_email_event(db, route_id, event_key, generation, status, error=''):
    db.execute('''INSERT INTO channel_inbox(id,route_id,event_key,kind,generation,status,error,created_at,updated_at)
                  VALUES(?,?,?,'email',?,?,?,?,?)''',(uid(),route_id,event_key,generation,status,error,now(),now()))


def requeue_stale_line_events(db, started_before):
    db.execute("UPDATE channel_inbox SET status='pending' WHERE kind='line' AND status='running' AND updated_at<?",(started_before,))


def next_line_event(db, retry_before):
    """The oldest pending event; one that already failed waits until retry_before."""
    return one(db,"SELECT * FROM channel_inbox WHERE kind='line' AND status='pending' AND (attempts=0 OR updated_at<=?) ORDER BY rowid LIMIT 1",(retry_before,))


def find_event(db, event_id):
    return one(db,'SELECT * FROM channel_inbox WHERE id=?',(event_id,))


def claim_event(db, event_id, lease):
    db.execute("UPDATE channel_inbox SET status='running',lease=?,attempts=attempts+1,updated_at=? WHERE id=?",(lease,now(),event_id))


def retry_event_later(db, event_id, error):
    db.execute("UPDATE channel_inbox SET status='pending',error=?,updated_at=? WHERE id=?",(error,now(),event_id))


def set_event_status(db, event_id, status, error, clear_payload=False):
    """clear_payload drops the stored event once it no longer needs processing."""
    if clear_payload:
        db.execute("UPDATE channel_inbox SET status=?,error=?,payload='{}',updated_at=? WHERE id=?",(status,error,now(),event_id))
    else:
        db.execute('UPDATE channel_inbox SET status=?,error=?,updated_at=? WHERE id=?',(status,error,now(),event_id))


# Conversation links (who to reply to, through which account)
def find_link(db, route_id, external_key):
    return one(db,'SELECT * FROM channel_conversations WHERE route_id=? AND external_key=?',(route_id,external_key))


def link_for_conversation(db, conversation_id):
    return one(db,'SELECT * FROM channel_conversations WHERE conversation_id=?',(conversation_id,))


def link_for_reply(db, reference, route_id, sender):
    """The conversation an email replies to: a Message-ID we issued, on this mailbox, from the same sender."""
    return one(db,'''SELECT cc.* FROM email_reply_refs r JOIN channel_conversations cc ON cc.conversation_id=r.conversation_id
                    WHERE r.reference=? AND r.route_id=? AND cc.recipient=?''',(reference,route_id,sender))


def insert_link(db, conversation_id, route_id, external_key, recipient, account_identity):
    db.execute('INSERT INTO channel_conversations VALUES(?,?,?,?,?,?)',(conversation_id,route_id,external_key,recipient,account_identity,None))


def set_link_event_time(db, conversation_id, occurred):
    db.execute('UPDATE channel_conversations SET last_event_time=? WHERE conversation_id=?',(occurred,conversation_id))


def insert_reply_ref(db, reference, conversation_id, route_id):
    db.execute('INSERT INTO email_reply_refs VALUES(?,?,?)',(reference,conversation_id,route_id))


def latest_reply_reference(db, conversation_id, except_reference):
    row = one(db,'SELECT reference FROM email_reply_refs WHERE conversation_id=? AND reference!=? ORDER BY rowid DESC LIMIT 1',(conversation_id,except_reference))
    return row['reference'] if row else None


# LINE threads (a user chat, group or room)
def find_line_thread(db, conversation_id):
    return one(db,'SELECT * FROM line_threads WHERE conversation_id=?',(conversation_id,))


def insert_line_thread(db, conversation_id, source_type, source_id, occurred):
    db.execute('INSERT OR IGNORE INTO line_threads VALUES(?,?,?,?,?)',(conversation_id,source_type,source_id,1,occurred))


def save_line_membership(db, conversation_id, source_type, source_id, active, occurred):
    db.execute('INSERT INTO line_threads VALUES(?,?,?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET active=excluded.active,last_event_time=excluded.last_event_time',
               (conversation_id,source_type,source_id,active,occurred))


# Replies waiting for delivery (outbox)
def insert_outbox(db, job_id, message_id, route_id, kind, actor_id, generation, retry_key, provider_id):
    db.execute('''INSERT INTO channel_outbox(id,message_id,route_id,kind,actor_id,generation,retry_key,provider_id,created_at,updated_at)
                  VALUES(?,?,?,?,?,?,?,?,?,?)''',(job_id,message_id,route_id,kind,actor_id,generation,retry_key,provider_id,now(),now()))


def find_outbox(db, job_id):
    return one(db,'SELECT * FROM channel_outbox WHERE id=?',(job_id,))


def outbox_for_message(db, message_id):
    return one(db,'SELECT * FROM channel_outbox WHERE message_id=?',(message_id,))


def queued_for_conversation(db, conversation_id):
    return rows(db,"SELECT o.* FROM channel_outbox o JOIN messages m ON m.id=o.message_id WHERE m.conversation_id=? AND o.status='queued'",(conversation_id,))


def queued_ai_for_conversation(db, conversation_id):
    return rows(db,"SELECT o.* FROM channel_outbox o JOIN messages m ON m.id=o.message_id WHERE m.conversation_id=? AND o.actor_id='@ai' AND o.status='queued'",(conversation_id,))


def fail_queued(db, kind):
    """Settings changed: queued replies of this channel are not sent with the new settings."""
    db.execute("UPDATE channel_outbox SET status='failed',error='changed',updated_at=? WHERE kind=? AND status='queued'",(now(),kind))
    db.execute("UPDATE messages SET delivery='failed' WHERE id IN (SELECT message_id FROM channel_outbox WHERE kind=? AND status='failed')",(kind,))


# LINE / Email and Facebook have separate delivery rounds, so these take the kinds a round handles.
def _kinds(kinds):
    return 'kind IN ('+','.join('?'*len(kinds))+')'


def stale_sending(db, started_before, kinds=KINDS):
    return rows(db,f"SELECT * FROM channel_outbox WHERE status='sending' AND updated_at<? AND {_kinds(kinds)}",(started_before,*kinds))


def any_sending(db, kinds=KINDS):
    return bool(one(db,f"SELECT 1 FROM channel_outbox WHERE status='sending' AND {_kinds(kinds)}",kinds))


def next_queued(db, kinds=KINDS):
    return one(db,f"SELECT * FROM channel_outbox WHERE status='queued' AND (next_attempt_at IS NULL OR next_attempt_at<=?) AND {_kinds(kinds)} ORDER BY rowid LIMIT 1",(now(),*kinds))


def claim_outbox(db, job_id, lease, attempts):
    db.execute("UPDATE channel_outbox SET status='sending',lease=?,attempts=?,first_attempt_at=COALESCE(first_attempt_at,?),updated_at=? WHERE id=?",(lease,attempts,now(),now(),job_id))


def finish_outbox(db, job_id, status, error, provider_id=None):
    db.execute('UPDATE channel_outbox SET status=?,error=?,provider_id=COALESCE(?,provider_id),updated_at=? WHERE id=?',(status,error,provider_id,now(),job_id))


def requeue_outbox(db, job_id, actor_id, generation):
    db.execute("UPDATE channel_outbox SET status='queued',error='',actor_id=?,generation=?,attempts=0,next_attempt_at=NULL,updated_at=? WHERE id=?",(actor_id,generation,now(),job_id))


def set_next_attempt(db, job_id, next_attempt_at):
    db.execute('UPDATE channel_outbox SET next_attempt_at=? WHERE id=?',(next_attempt_at,job_id))


def insert_outbox_payload(db, job_id, payload_json):
    db.execute('INSERT INTO channel_outbox_payload VALUES(?,?)',(job_id,payload_json))


def outbox_payload(db, job_id):
    row = one(db,'SELECT payload FROM channel_outbox_payload WHERE outbox_id=?',(job_id,))
    return row['payload'] if row else None


# Chatbot answers on LINE / Email: what they were based on, checked again right before sending
def insert_ai_guard(db, message_id, job_id, config_version, signature, trigger_id, notice):
    db.execute('INSERT INTO channel_ai_guard VALUES(?,?,?,?,?,?)',(message_id,job_id,config_version,signature,trigger_id,int(notice)))


def find_ai_guard(db, message_id):
    return one(db,'SELECT * FROM channel_ai_guard WHERE message_id=?',(message_id,))


# Temporary links for files sent to LINE
def insert_file_link(db, token_hash, attachment_id, message_id, expires_at):
    db.execute('INSERT INTO channel_file_links VALUES(?,?,?,?,0)',(token_hash,attachment_id,message_id,expires_at))


def file_for_link(db, token_hash):
    """The attachment behind a valid link: not revoked or expired, on a LINE reply that was (or may have been) sent."""
    return one(db,"""SELECT a.* FROM channel_file_links l JOIN attachments a ON a.id=l.attachment_id
        JOIN messages m ON m.id=l.message_id JOIN channel_outbox o ON o.message_id=m.id
        WHERE l.token_hash=? AND l.revoked=0 AND l.expires_at>? AND m.kind='reply'
        AND o.kind='line' AND o.status IN ('sending','accepted','unknown')""",(token_hash,now()))


def has_unusable_file_links(db, message_id):
    return bool(one(db,'SELECT 1 FROM channel_file_links WHERE message_id=? AND (revoked=1 OR expires_at<=?)',(message_id,now())))


def has_active_file_links(db, message_id):
    return bool(one(db,'SELECT 1 FROM channel_file_links WHERE message_id=? AND revoked=0',(message_id,)))


def revoke_file_links(db, message_id):
    db.execute('UPDATE channel_file_links SET revoked=1 WHERE message_id=?',(message_id,))


# Facebook Messenger: the Page's route (control database) and the organization's settings row (tenant database)
def active_facebook_route(cd, route_id):
    return one(cd,"SELECT r.* FROM facebook_routes r JOIN tenants t ON t.id=r.tenant_id WHERE r.id=? AND t.status='active'",(route_id,))


def facebook_page_taken(cd, page_id, route_id):
    return bool(one(cd,'SELECT 1 FROM facebook_routes WHERE page_id=? AND id!=?',(page_id,route_id)))


def save_facebook_route(cd, route_id, tenant_id, page_id):
    cd.execute('INSERT INTO facebook_routes VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET page_id=excluded.page_id',(route_id,tenant_id,page_id))


def find_facebook_setting(db):
    row = one(db,'SELECT * FROM facebook_settings WHERE id=1')
    if row:
        row['config'] = json.loads(row['config'])
    return row


def save_facebook_setting(db, route_id, enabled, config_json, generation, last_checked):
    """New settings start a new generation and clear the last error."""
    db.execute('''INSERT INTO facebook_settings(id,route_id,enabled,config,generation,last_checked) VALUES(1,?,?,?,?,?)
                  ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,config=excluded.config,generation=excluded.generation,
                  last_error='',last_checked=excluded.last_checked''',(route_id,int(enabled),config_json,generation,last_checked))


def set_facebook_check(db, error):
    db.execute('UPDATE facebook_settings SET last_error=?,last_checked=? WHERE id=1',(error,now()))


def set_facebook_received(db):
    db.execute("UPDATE facebook_settings SET last_received=?,last_error='' WHERE id=1",(now(),))


def insert_channel_event(db, route_id, event_key, kind, generation):
    """A received event that was handled at once (recorded so a redelivery is recognised)."""
    db.execute('''INSERT INTO channel_inbox(id,route_id,event_key,kind,generation,status,created_at,updated_at)
                  VALUES(?,?,?,?,?,'done',?,?)''',(uid(),route_id,event_key,kind,generation,now(),now()))


# Email OAuth token refresh: a short lease so only one worker refreshes at a time
def refresh_lock(db):
    return one(db,"SELECT * FROM oauth_refresh WHERE kind='email'")


def take_refresh_lock(db, lease, expires_at):
    db.execute("INSERT OR REPLACE INTO oauth_refresh VALUES('email',?,?)",(lease,expires_at))


def release_refresh_lock(db, lease):
    db.execute("DELETE FROM oauth_refresh WHERE kind='email' AND lease=?",(lease,))
