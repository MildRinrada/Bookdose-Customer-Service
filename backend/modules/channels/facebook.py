"""Facebook Messenger: a Facebook Page connected with its Page access token and the Meta app's App Secret.
Messages arrive on a signed webhook and are stored at once (text; a file is noted for staff to open on the Page).
Staff replies wait in the shared outbox and a background round sends them through the Graph API, outside any
database transaction. The chatbot does not answer on Messenger."""
import hashlib
import hmac
import json
import re
import secrets

from backend.database import audit, db as D
from backend.exceptions.errors import ChannelError, CHANNEL_ERRORS
from backend.extensions import channel_transport as T
from backend.modules.channels import repository, schema
from backend.modules.contacts import repository as contacts
from backend.modules.conversations import repository as conversations
from backend.modules.organization import repository as organization
from backend.modules.platform import repository as tenants
from backend.modules.tickets import repository as tickets
from backend.realtime import events as realtime
from backend.utils.dates import after, now
from backend.utils.files import write_private_file
from backend.utils.security import uid
from backend.utils.validation import require

KIND = 'facebook'
TEXT_LIMIT = 2000           # Messenger's limit for one text message
LEASE_SECONDS = 120
PSID = re.compile(r'[0-9]{1,40}')


# Credentials: a private file per organization, never in the database, API responses or backups.
def secret_path(tenant_id):
    D.tenant_path(tenant_id)
    return D.DATA/'secrets'/f'{tenant_id}.facebook.json'


def read_secret(tenant_id):
    path = secret_path(tenant_id)
    return json.loads(path.read_text()) if path.is_file() else {}


def write_secret(tenant_id, value):
    path = secret_path(tenant_id)
    if not value:
        path.unlink(missing_ok=True)
        return
    write_private_file(path,json.dumps(value))


def ready(secret):
    return bool(secret.get('page_access_token') and secret.get('app_secret'))


# Settings
def overview(db, tenant_id):
    row = repository.find_facebook_setting(db)
    cfg = row['config'] if row else {'team_id':organization.first_team_id(db)}
    return {'kind':KIND,'enabled':bool(row and row['enabled']),
            'config':{key:cfg.get(key,'') for key in ('team_id','page_id','page_name','verify_token')},
            'credentials_configured':ready(read_secret(tenant_id)),'route_id':row['route_id'] if row else None,
            'last_error':CHANNEL_ERRORS.get(row['last_error'],'') if row else '',
            'last_checked':row['last_checked'] if row else None,'last_received':row['last_received'] if row else None,
            'outbox':repository.outbox_counts(db,KIND)}


def save(cd, db, ctx, body):
    """Check the Page token with Facebook first, then save the settings as a new generation.
    A channel keeps the Page it was first connected to, and one Page belongs to one organization."""
    old = repository.find_facebook_setting(db)
    cfg = dict(old['config']) if old else {}
    route_id = old['route_id'] if old else uid()
    enabled = schema.enabled_flag(body,bool(old and old['enabled']))
    cfg['team_id'] = schema.text_field(body,'team_id',cfg.get('team_id',ctx['team_id']),32)
    require(organization.team_exists(db,cfg['team_id']),'ไม่พบทีมรับเรื่อง')
    secret = read_secret(ctx['tenant_id'])
    remove = schema.remove_credentials(body,enabled)
    schema.credentials(body,KIND,secret)
    if remove:
        secret = {}
    cfg.setdefault('verify_token',secrets.token_urlsafe(24))
    checked = old['last_checked'] if old else None
    if enabled:
        require(ready(secret),'กรุณาระบุ Page Access Token และ App Secret')
        info = T.verify_facebook(secret['page_access_token'])
        require(not cfg.get('page_id') or cfg['page_id']==info['identity'],'ช่องทางนี้ผูกกับเพจเดิมแล้ว ไม่สามารถเปลี่ยนเป็นเพจอื่นในประวัติเดิมได้')
        cfg.update(page_id=info['identity'],page_name=info['display_name'])
        checked = now()
    # Provider checks happen before starting write transactions.
    D.begin(cd)
    D.begin(db)
    if cfg.get('page_id'):
        require(not repository.facebook_page_taken(cd,cfg['page_id'],route_id),'เพจนี้เชื่อมกับองค์กรอื่นแล้ว')
    repository.save_facebook_route(cd,route_id,ctx['tenant_id'],cfg.get('page_id'))
    repository.save_facebook_setting(db,route_id,enabled,json.dumps(cfg,ensure_ascii=False),uid(),checked)
    write_secret(ctx['tenant_id'],secret)
    # Replies queued under the old settings are never sent with the new ones.
    repository.fail_queued(db,KIND)
    audit.record(db,ctx['name'],'channel.settings_updated',route_id,KIND)
    db.commit()
    cd.commit()
    return overview(db,ctx['tenant_id'])


def test(db, tenant_id):
    """Sign in to the Graph API without sending a message; the result is shown on the settings page."""
    row = repository.find_facebook_setting(db)
    secret = read_secret(tenant_id)
    if not row or not ready(secret):
        raise ChannelError('credentials')
    try:
        info = T.verify_facebook(secret['page_access_token'])
        if row['config'].get('page_id') and info['identity']!=row['config']['page_id']:
            raise ChannelError('credentials')
    except ChannelError as error:
        repository.set_facebook_check(db,error.code)
        db.commit()
        raise
    repository.set_facebook_check(db,'')
    db.commit()


# Receiving
def verify_subscription(route_id, query):
    """Meta's webhook check: answer hub.challenge when hub.verify_token matches the one shown in the settings."""
    def first(key):
        return (query.get(key) or [''])[0]
    with D.control() as cd:
        route = repository.active_facebook_route(cd,route_id)
    require(route,'ไม่พบช่องทาง',404)
    with D.tenant(route['tenant_id']) as db:
        row = repository.find_facebook_setting(db)
    token = row['config'].get('verify_token','') if row else ''
    require(first('hub.mode')=='subscribe' and token and hmac.compare_digest(first('hub.verify_token'),token),'Verify token ไม่ถูกต้อง',403)
    challenge = first('hub.challenge')
    require(re.fullmatch(r'[A-Za-z0-9_-]{1,200}',challenge),'hub.challenge ไม่ถูกต้อง')
    return challenge


def accept_webhook(route_id, raw, signature):
    """Check Meta's X-Hub-Signature-256 over the raw body, then store each new message."""
    with D.control() as cd:
        route = repository.active_facebook_route(cd,route_id)
    if not route:
        raise ChannelError('disabled')
    app_secret = read_secret(route['tenant_id']).get('app_secret','')
    expected = 'sha256='+hmac.new(app_secret.encode(),raw,hashlib.sha256).hexdigest()
    if not app_secret or not hmac.compare_digest(signature,expected):
        raise PermissionError('Invalid Facebook signature')
    events = schema.facebook_events(raw,route['page_id'])
    with D.tenant(route['tenant_id']) as db:
        D.begin(db)
        row = repository.find_facebook_setting(db)
        if not row or not row['enabled']:
            raise ChannelError('disabled')
        stored = [mid for event in events if (mid := ingest(db,route['tenant_id'],row,event))]
        repository.set_facebook_received(db)
    return len(stored)


def ingest(db, tenant_id, row, event):
    """One Messenger event -> a customer message. Echoes of the Page's own messages, other event types and
    redeliveries (same message id) are skipped. Returns the message id or None."""
    from backend.modules.conversations.service import store_message
    message,sender = event.get('message'),event.get('sender')
    sender_id = sender.get('id') if isinstance(sender,dict) else None
    if not isinstance(message,dict) or message.get('is_echo') or not isinstance(sender_id,str) or not PSID.fullmatch(sender_id):
        return None
    external_id = message.get('mid')
    if not isinstance(external_id,str) or not 1<=len(external_id)<=300:
        return None
    key = 'fb:'+external_id
    if repository.inbox_event_exists(db,row['route_id'],key):
        return None
    repository.insert_channel_event(db,row['route_id'],key,KIND,row['generation'])
    text = message.get('text') if isinstance(message.get('text'),str) else ''
    if message.get('attachments'):
        text = (text+'\n' if text else '')+'[ลูกค้าส่งไฟล์แนบผ่าน Facebook กรุณาตรวจจากกล่องข้อความของเพจ]'
    text = text.strip()[:19000] or '(ข้อความว่างจาก Facebook)'
    name = 'Facebook • '+sender_id[-6:]
    link = repository.find_link(db,row['route_id'],sender_id)
    if link:
        conv = link['conversation_id']
    else:
        contact_id,conv = uid(),uid()
        contacts.insert(db,contact_id,name,'','','','','channel')
        conversations.insert(db,conv,contact_id,text.split('\n')[0][:300],KIND,row['config']['team_id'])
        repository.insert_link(db,conv,row['route_id'],sender_id,sender_id,row['config']['page_id'])
    mid = store_message(db,tenant_id,conv,None,name,'customer',{'body':text})
    audit.record(db,'Facebook','channel.message_received',conv)
    return mid


# Replies (outbox)
def check_reply(db, tenant_id, conv, body):
    """A reply can go out on this conversation's Page right now: text only, within Messenger's length limit."""
    row = repository.find_facebook_setting(db)
    link = repository.link_for_conversation(db,conv['id'])
    if not row or not row['enabled'] or not link:
        raise ChannelError('disabled')
    if row['config'].get('page_id')!=link['account_identity']:
        raise ChannelError('changed')
    if not ready(read_secret(tenant_id)):
        raise ChannelError('credentials')
    text = body.get('body','')
    require(not body.get('attachments'),'Facebook Messenger รองรับเฉพาะข้อความ กรุณาส่งไฟล์เป็นลิงก์')
    require(isinstance(text,str) and text.strip() and len(text)<=TEXT_LIMIT,f'Facebook ส่งข้อความได้ไม่เกิน {TEXT_LIMIT:,} ตัวอักษร')
    return row


def enqueue_reply(db, ctx, conv, mid):
    """Queue a stored reply for the delivery round (same transaction as the message)."""
    row = repository.find_facebook_setting(db)
    job_id = uid()
    repository.insert_outbox(db,job_id,mid,row['route_id'],KIND,ctx['id'],row['generation'],job_id,'')
    conversations.set_delivery(db,mid,'queued')


def retry(db, ctx, job):
    require(job['status']=='failed','ส่งซ้ำได้เฉพาะรายการที่ยืนยันว่าส่งไม่สำเร็จ')
    message = conversations.find_message(db,job['message_id'])
    conv = conversations.find(db,message['conversation_id'])
    row = check_reply(db,ctx['tenant_id'],conv,{'body':message['body']})
    repository.requeue_outbox(db,job['id'],ctx['id'],row['generation'])
    conversations.set_delivery(db,job['message_id'],'queued')
    realtime.delivery(db,job['message_id'])
    audit.record(db,ctx['name'],'channel.retry_requested',message['conversation_id'])


def finish(db, job, status, error='', provider_id=None):
    repository.finish_outbox(db,job['id'],status,error,provider_id)
    conversations.set_delivery(db,job['message_id'],status)
    # A staff reply counts as the first response once Facebook accepts it.
    if status=='accepted' and not conversations.ai_meta(db,job['message_id']):
        tickets.record_first_response_for_message(db,job['message_id'])
    realtime.delivery(db,job['message_id'])


def process_outbox(tenant_id):
    """Send one queued reply: re-check permission and settings, send outside the transaction, record the result."""
    with D.control() as cd, D.tenant(tenant_id) as db:
        D.begin(db)
        for old in repository.stale_sending(db,after(seconds=-LEASE_SECONDS),(KIND,)):
            # The Send API has no retry key, so a send that may have gone out is never repeated automatically.
            finish(db,old,'unknown','unknown')
        if repository.any_sending(db,(KIND,)):
            return False
        job = repository.next_queued(db,(KIND,))
        if not job:
            return False
        message = conversations.find_message(db,job['message_id'])
        conv = conversations.find(db,message['conversation_id'])
        row = repository.find_facebook_setting(db)
        link = repository.link_for_conversation(db,conv['id'])
        member = organization.find_active_membership(cd,tenant_id,job['actor_id'])
        permitted = tenants.is_active(cd,tenant_id) and member and (member['role']!='agent' or member['team_id']==conv['team_id'])
        if not permitted or not row or not row['enabled'] or row['generation']!=job['generation'] or not link or link['account_identity']!=row['config'].get('page_id'):
            finish(db,job,'failed','changed')
            return True
        secret = read_secret(tenant_id)
        if not secret.get('page_access_token'):
            finish(db,job,'failed','credentials')
            return True
        lease,attempts = uid(),job['attempts']+1
        repository.claim_outbox(db,job['id'],lease,attempts)
        conversations.set_delivery(db,job['message_id'],'sending')
    error = provider_id = None
    try:
        provider_id = T.send_facebook(secret['page_access_token'],link['recipient'],message['body'])
    except ChannelError as failure:
        error = failure
    except Exception:
        error = ChannelError('unknown',uncertain=True)
    with D.tenant(tenant_id) as db:
        D.begin(db)
        current = repository.find_outbox(db,job['id'])
        if current['lease']!=lease or current['status']!='sending':
            return True
        status = 'accepted' if not error else 'unknown' if error.uncertain else 'queued' if error.retryable and attempts<3 else 'failed'
        finish(db,job,status,error.code if error else '',provider_id)
        if status=='queued':
            repository.set_next_attempt(db,job['id'],after(seconds=10*3**(attempts-1)))
        audit.record(db,'ระบบส่งข้อความ','channel.'+status,conv['id'],KIND)
    return True
