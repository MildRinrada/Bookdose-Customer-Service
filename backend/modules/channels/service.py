"""LINE and Email: channel settings, receiving (LINE webhook, IMAP polling), the transactional outbox for replies,
chatbot answers on these channels, and the background workers. Provider calls never run inside a database transaction."""
import base64
import datetime as dt
import hashlib
import hmac
import json
import re
import threading
import uuid

from backend.database import audit, db as D
from backend.exceptions.errors import ChannelError, CHANNEL_ERRORS
from backend.extensions import channel_transport as T
from backend.middleware.access import get_scoped
from backend.modules.ai import service as ai
from backend.modules.channels import email_oauth as O, facebook, file_links as F, repository, schema
from backend.modules.channels.model import KINDS
from backend.modules.contacts import repository as contacts
from backend.modules.conversations import repository as conversations, service as conversation_service
from backend.modules.organization import repository as organization
from backend.modules.platform import repository as tenants
from backend.modules.tickets import repository as tickets, service as ticket_service
from backend.utils.dates import after, now, utc_now
from backend.utils.security import token_hash, uid
from backend.utils.validation import require

LEASE_SECONDS = 120          # a claimed event / delivery / poll older than this is treated as abandoned
LINE_RETRY_KEY_HOURS = 23    # LINE only deduplicates a retried push within 24 hours
AI_ACTOR = '@ai'             # outbox actor for chatbot answers


# Settings and credentials
def setting(db, kind):
    return repository.find_setting(db,kind)


def read_secret(tenant_id, kind):
    return repository.read_secret(tenant_id,kind)


def write_secret(tenant_id, kind, value):
    repository.write_secret(tenant_id,kind,value)


def credentials_ready(kind, cfg, secret):
    if kind=='line':
        return all(secret.get(key) for key in ('channel_secret','access_token'))
    return O.configured(cfg,secret)


def workspace_summary(db):
    """Which channels are on, and whether their chatbot is on (shown to every staff member)."""
    return {kind:{'chatbot_enabled':bool((setting(db,kind) or {}).get('config',{}).get('chatbot_enabled')),'enabled':bool((setting(db,kind) or {}).get('enabled'))} for kind in KINDS}


def overview(db, tenant_id):
    output = []
    team = organization.first_team_id(db)
    for kind in KINDS:
        row = setting(db,kind)
        cfg = row['config'] if row else {'team_id':team}
        secret = read_secret(tenant_id,kind)
        output.append({'kind':kind,'enabled':bool(row and row['enabled']),'config':cfg,
            'credentials_configured':credentials_ready(kind,cfg,secret),
            'oauth_client_configured':bool(secret.get('oauth_client_secret')),'route_id':row['route_id'] if row else None,
            'last_error':CHANNEL_ERRORS.get(row['last_error'],'') if row else '',
            'last_checked':row['last_checked'] if row else None,'last_received':row['last_received'] if row else None,
            'outbox':repository.outbox_counts(db,kind),'events':repository.recent_events(db,kind)})
    return output


def bind_identity(cd, route_id, tenant_id, kind, identity):
    """A channel keeps the account it was first connected to, and one account belongs to one organization."""
    route = repository.find_route(cd,route_id)
    if route and route['identity']:
        require(route['identity']==identity,'ช่องทางนี้ผูกบัญชีเดิมแล้ว ไม่สามารถเปลี่ยนเป็นบัญชีอื่นในประวัติเดิมได้')
    require(not repository.identity_taken(cd,kind,identity,route_id),'บัญชีช่องทางนี้ถูกใช้งานในองค์กรอื่นแล้ว')
    if route:
        repository.set_route_identity(cd,route_id,identity)
    else:
        repository.insert_route(cd,route_id,tenant_id,kind,identity)


def save_channel(cd, db, ctx, kind, body):
    """Validate and verify the settings with the provider first, then save them as a new generation.
    Replies still queued for the old settings are not sent."""
    require(kind in KINDS,'ช่องทางไม่ถูกต้อง')
    old = setting(db,kind)
    cfg = dict(old['config']) if old else {}
    route_id = old['route_id'] if old else uid()
    enabled = schema.enabled_flag(body,bool(old and old['enabled']))
    cfg['team_id'] = schema.text_field(body,'team_id',cfg.get('team_id',ctx['team_id']),32)
    require(organization.team_exists(db,cfg['team_id']),'ไม่พบทีมรับเรื่อง')
    secret = read_secret(ctx['tenant_id'],kind)
    remove = schema.remove_credentials(body,enabled)
    schema.credentials(body,kind,secret)
    if remove:
        secret = {}
    info = None
    if kind=='email':
        schema.email_account(body,cfg)
        O.configure(cfg,body,secret)
        if remove:
            secret = {}
        schema.email_servers(body,cfg,fixed_by_provider=cfg.get('auth_mode') in O.PROVIDERS)
        if enabled:
            require(O.configured(cfg,secret),'กรุณาระบุรหัสผ่าน หรือบันทึกการตั้งค่า OAuth แล้วกดเชื่อมบัญชีก่อนเปิดใช้')
            info = T.verify_email(cfg,O.access_secret(ctx['tenant_id'],cfg,secret))
    else:
        schema.line_options(body,cfg)
        if enabled:
            require(bool(secret.get('access_token') and secret.get('channel_secret')),'กรุณาระบุ Channel Secret และ Channel Access Token')
            info = T.verify_line(secret)
            cfg.update(info)
    cfg['chatbot_enabled'] = schema.chatbot_flag(body,cfg)
    if cfg['chatbot_enabled']:
        require(ai.has_key(ctx['tenant_id']),'กรุณาตั้งค่า OpenAI API Key ในส่วน AI ก่อนเปิด Chatbot')
    # Provider checks happen before starting write transactions.
    D.begin(cd)
    D.begin(db)
    identity = cfg.get('identity')
    if identity:
        bind_identity(cd,route_id,ctx['tenant_id'],kind,identity)
    elif not old:
        repository.insert_route(cd,route_id,ctx['tenant_id'],kind,None)
    generation = uid()
    if not old:
        repository.insert_setting(db,kind,route_id,generation)
    if kind=='email' and info and not (old and old['uidvalidity']):
        repository.set_mailbox_checkpoint(db,kind,info['uidvalidity'],max(0,info['uidnext']-1))
    write_secret(ctx['tenant_id'],kind,secret)
    repository.save_setting(db,kind,enabled,json.dumps(cfg,ensure_ascii=False),generation,now() if info else (old['last_checked'] if old else None))
    # Never migrate a queued message silently onto newly edited credentials/settings.
    repository.fail_queued(db,kind)
    for conversation in repository.bot_conversations(db,kind):
        if not bot_enabled(db,conversation):
            ai.stop_bot(db,conversation['id'],'channel_disabled')
    audit.record(db,ctx['name'],'channel.settings_updated',route_id,kind)
    db.commit()
    cd.commit()
    return overview(db,ctx['tenant_id'])


def test_channel(db, tenant_id, kind):
    """Sign in to the provider without sending a message; the result is shown on the settings page."""
    row = setting(db,kind)
    if not row:
        raise ChannelError('credentials')
    secret = read_secret(tenant_id,kind)
    if not credentials_ready(kind,row['config'],secret):
        raise ChannelError('credentials')
    try:
        info = T.verify_line(secret) if kind=='line' else T.verify_email(row['config'],O.access_secret(tenant_id,row['config'],secret))
        if kind=='line' and row['config'].get('identity') and info['identity']!=row['config']['identity']:
            raise ChannelError('credentials')
    except ChannelError as error:
        repository.set_check_result(db,kind,error.code)
        db.commit()
        raise
    repository.set_check_result(db,kind,'')
    db.commit()
    return {'ok':True,'message':'เชื่อมต่อสำเร็จ (ยังไม่ได้ส่งข้อความจริง)'}


def start_email_oauth(db, ctx, origin):
    D.begin(db)
    return O.start(db,ctx,origin)


def complete_email_oauth(cd, db, ctx, body):
    return O.complete(cd,db,ctx,body)


def request_email_sync(db):
    """Ask the email worker to check the mailbox on its next round."""
    repository.request_sync(db)
    db.commit()


# Receiving from LINE
def accept_line_webhook(route_id, raw, signature):
    with D.control() as cd:
        return accept_line(cd,route_id,raw,signature)


def accept_line(cd, route_id, raw, signature):
    """Store signed webhook events for the worker; nothing else happens during LINE's request."""
    route = repository.active_line_route(cd,route_id)
    if not route:
        raise ChannelError('disabled')
    secret = read_secret(route['tenant_id'],'line').get('channel_secret','')
    expected = base64.b64encode(hmac.new(secret.encode(),raw,hashlib.sha256).digest()).decode()
    if not secret or not hmac.compare_digest(signature,expected):
        raise PermissionError('Invalid LINE signature')
    events = schema.line_webhook_events(raw,route['identity'])
    with D.tenant(route['tenant_id']) as db:
        D.begin(db)
        row = setting(db,'line')
        if not row or not row['enabled']:
            raise ChannelError('disabled')
        for event in events:
            repository.insert_line_event(db,route_id,event['webhookEventId'],json.dumps(event,ensure_ascii=False),row['generation'])
        repository.set_line_received(db)
    return {'ok':True}


def active(cd, tenant_id):
    return tenants.is_active(cd,tenant_id)


def new_conversation(db, row, key, recipient, name, email, subject):
    cid,conv = uid(),uid()
    contacts.insert(db,cid,name[:100],email,'','','','channel')
    conversations.insert(db,conv,cid,subject[:300],row['kind'],row['config']['team_id'])
    repository.insert_link(db,conv,row['route_id'],key,recipient,row['config']['identity'])
    return conv


def ingest_line(db, tenant_id, row, event, attachment, store_message):
    """Turn one LINE event into a message (or a group membership change). Raises ChannelError('ignored') to skip it."""
    source = event.get('source') or {}
    message = event.get('message') or {}
    if not isinstance(source,dict) or not isinstance(message,dict):
        raise ChannelError('ignored')
    kind = source.get('type')
    source_id = source.get({'user':'userId','group':'groupId','room':'roomId'}.get(kind,''),'')
    pattern = {'user':'U','group':'C','room':'R'}.get(kind)
    if not pattern or not isinstance(source_id,str) or not re.fullmatch(pattern+r'[a-fA-F0-9]{32}',source_id):
        raise ChannelError('ignored')
    if kind!='user' and not row['config'].get('groups_enabled'):
        raise ChannelError('ignored')
    key = source_id if kind=='user' else kind+':'+source_id
    link = repository.find_link(db,row['route_id'],key)
    try:
        occurred = dt.datetime.fromtimestamp(int(event.get('timestamp',0))/1000,dt.timezone.utc).isoformat(timespec='seconds')
    except (ValueError,TypeError,OverflowError,OSError):
        raise ChannelError('ignored') from None
    event_type = event.get('type')
    if event_type!='message':
        if link and event_type in ('join','leave','memberJoined','memberLeft') and (not link['last_event_time'] or occurred>=link['last_event_time']):
            repository.save_line_membership(db,link['conversation_id'],kind,source_id,int(event_type!='leave'),occurred)
            repository.set_link_event_time(db,link['conversation_id'],occurred)
            ai.stop_bot(db,link['conversation_id'],'group_membership_changed')
            if event_type=='leave':
                for job in repository.queued_for_conversation(db,link['conversation_id']):
                    finish(db,job,'failed','changed')
            audit.record(db,'LINE','line.'+event_type,link['conversation_id'])
        raise ChannelError('ignored')
    thread = repository.find_line_thread(db,link['conversation_id']) if link else None
    if thread and not thread['active']:
        raise ChannelError('ignored')
    message_type = message.get('type','unknown')
    text = message.get('text','') if message_type=='text' else f'[ได้รับ {message_type} ผ่าน LINE]'
    if not isinstance(text,str):
        raise ChannelError('ignored')
    if message_type in ('image','video','file') and not attachment:
        text += '\n[นำเข้าไฟล์ไม่สำเร็จ กรุณาตรวจจาก LINE ต้นทาง]'
    text = text.strip() or '(ข้อความว่างจาก LINE)'
    label = ('LINE • ' if kind=='user' else 'กลุ่ม LINE • ' if kind=='group' else 'ห้อง LINE • ')+source_id[-6:]
    conv = link['conversation_id'] if link else new_conversation(db,row,key,source_id,label,'',text if kind=='user' else label)
    repository.insert_line_thread(db,conv,kind,source_id,occurred)
    if not link and kind!='user':
        ai.set_initial_mode(db,conv,bot_enabled(db,conversations.find(db,conv)) and ai.has_key(tenant_id))
    previous = conversations.find(db,conv)
    ticket_states = tickets.states_for_conversation(db,conv)
    sender = source.get('userId','')
    name = 'LINE • '+sender[-6:] if isinstance(sender,str) and re.fullmatch(r'U[a-fA-F0-9]{32}',sender) else 'สมาชิก LINE (ไม่ระบุ ID)'
    mid = store_message(db,tenant_id,conv,None,name,'customer',{'body':text[:19000],'attachments':[attachment] if attachment else []})
    conversations.set_message_created_at(db,mid,occurred)
    late = link and link['last_event_time'] and occurred<link['last_event_time']
    if late:
        # A delayed event must not reopen or reorder newer activity.
        conversations.restore_state(db,conv,previous['status'],previous['updated_at'])
        for state in ticket_states:
            tickets.restore_state(db,state)
    else:
        repository.set_link_event_time(db,conv,occurred)
        # A group bot only responds when explicitly called; its prompt sees this message alone.
        mentions = (message.get('mention') or {}).get('mentionees',[]) if isinstance(message.get('mention',{}),dict) else []
        called = kind=='user' or text.lower().startswith('/bookdose ') or any(isinstance(m,dict) and m.get('isSelf') is True for m in mentions)
        if called and message_type=='text' or attachment:
            on_external_customer(db,tenant_id,conv,text,is_new=not bool(link))
    audit.record(db,'LINE','channel.message_received',conv)
    return mid


def process_line(tenant_id, store_message):
    """Process one stored LINE event: download its file outside the transaction, then ingest it."""
    with D.control() as cd, D.tenant(tenant_id) as db:
        D.begin(db)
        row = setting(db,'line')
        if not active(cd,tenant_id) or not row or not row['enabled']:
            return False
        repository.requeue_stale_line_events(db,after(seconds=-LEASE_SECONDS))
        event = repository.next_line_event(db,after(seconds=-10))
        if not event:
            return False
        if event['generation']!=row['generation']:
            repository.set_event_status(db,event['id'],'failed','changed',clear_payload=True)
            return True
        lease = uid()
        repository.claim_event(db,event['id'],lease)
        payload = json.loads(event['payload'])
        secret = read_secret(tenant_id,'line')
    attachment = None
    media_error = None
    if payload.get('type')=='message' and isinstance(payload.get('message'),dict) and payload['message'].get('type') in ('image','video','file'):
        try:
            attachment = T.line_media(secret,payload['message'])
        except ChannelError as error:
            media_error = error
    with D.control() as cd, D.tenant(tenant_id) as db:
        D.begin(cd)
        D.begin(db)
        current = repository.find_event(db,event['id'])
        latest = setting(db,'line')
        if current['lease']!=lease or current['status']!='running':
            return True
        if not active(cd,tenant_id) or not latest['enabled'] or latest['generation']!=row['generation']:
            repository.set_event_status(db,event['id'],'failed','changed')
            return True
        if media_error and media_error.retryable and current['attempts']<3:
            repository.retry_event_later(db,event['id'],media_error.code)
            return True
        try:
            ingest_line(db,tenant_id,row,payload,attachment,store_message)
            status,error = 'done','media' if media_error else ''
        except ChannelError as problem:
            status,error = 'ignored',problem.code
        repository.set_event_status(db,event['id'],status,error,clear_payload=True)
    return True


# Receiving email
def ingest_email(db, tenant_id, row, record, store_message):
    conversation = None
    # Thread only using an opaque Message-ID that this system issued and the same sender.
    for reference in reversed(record['references']):
        conversation = repository.link_for_reply(db,reference,row['route_id'],record['sender'])
        if conversation:
            break
    key = 'mail:'+uid()
    conv = conversation['conversation_id'] if conversation else new_conversation(db,row,key,record['sender'],record['name'],record['sender'],record['subject'])
    mid = store_message(db,tenant_id,conv,None,record['name'],'customer',record)
    on_external_customer(db,tenant_id,conv,record['body'],is_new=not bool(conversation))
    audit.record(db,'Email','channel.message_received',conv)
    return mid


def poll_email(tenant_id, store_message):
    """Fetch new mail over IMAP (outside any transaction) and store each message once."""
    with D.control() as cd, D.tenant(tenant_id) as db:
        D.begin(db)
        row = setting(db,'email')
        if not active(cd,tenant_id) or not row or not row['enabled']:
            return False
        if row['next_poll'] and row['next_poll']>now():
            return False
        if row['poll_lease'] and row['poll_started'] and row['poll_started']>after(seconds=-LEASE_SECONDS):
            return False
        lease = uid()
        repository.claim_poll(db,lease,after(seconds=row['config']['poll_seconds']))
        secret = read_secret(tenant_id,'email')
    try:
        batch = T.fetch_email(row['config'],O.access_secret(tenant_id,row['config'],secret),row)
        failure = None
    except ChannelError as error:
        batch,failure = None,error.code
    except Exception:
        batch,failure = None,'network'
    with D.control() as cd, D.tenant(tenant_id) as db:
        D.begin(cd)
        D.begin(db)
        current = setting(db,'email')
        if current['poll_lease']!=lease:
            return True
        if not active(cd,tenant_id) or not current['enabled'] or current['generation']!=row['generation']:
            repository.release_poll(db)
            return True
        error = failure or ('mailbox_reset' if batch['reset'] else '')
        if batch and batch['reset']:
            repository.set_mailbox_checkpoint(db,'email',batch['uidvalidity'],max(0,batch['uidnext']-1))
        if batch and not batch['reset']:
            for mail_uid,raw in batch['messages']:
                event_key = batch['uidvalidity']+':'+str(mail_uid)
                if repository.inbox_event_exists(db,row['route_id'],event_key):
                    repository.bump_last_uid(db,mail_uid)
                    continue
                status,reason = 'done',''
                try:
                    if raw is None:
                        raise ChannelError('size')
                    record = T.parse_email(raw,row['config']['address'])
                    # Deduplicate copies with the same Message-ID + sender without merging contact identities.
                    dedup = 'message:'+token_hash(record['sender']+'\n'+record['message_id']) if record['message_id'] else None
                    if dedup and repository.inbox_event_exists(db,row['route_id'],dedup):
                        status,reason = 'ignored','ignored'
                    else:
                        ingest_email(db,tenant_id,row,record,store_message)
                        if dedup:
                            repository.insert_email_event(db,row['route_id'],dedup,row['generation'],'done')
                except ChannelError as problem:
                    status,reason = 'ignored',problem.code
                except (ValueError,TypeError,UnicodeError):
                    status,reason = 'ignored','ignored'
                repository.insert_email_event(db,row['route_id'],event_key,row['generation'],status,reason)
                repository.record_email_received(db,mail_uid)
                if reason not in ('','ignored'):
                    error = reason
        repository.finish_poll(db,error)
    return True


# Replies (outbox)
def check_reply(db, tenant_id, conv, body):
    """A staff reply can go out on this conversation's channel right now."""
    row = setting(db,conv['channel'])
    link = repository.link_for_conversation(db,conv['id'])
    if not row or not row['enabled'] or not link:
        raise ChannelError('disabled')
    if row['config'].get('identity')!=link['account_identity']:
        raise ChannelError('changed')
    if not credentials_ready(conv['channel'],row['config'],read_secret(tenant_id,conv['channel'])):
        raise ChannelError('credentials')
    if conv['channel']=='line':
        schema.line_reply(body,row['config'])
        thread = repository.find_line_thread(db,conv['id'])
        require(not thread or thread['active'] and (thread['source_type']=='user' or row['config'].get('groups_enabled')),'บอตไม่ได้อยู่ในกลุ่มแล้ว หรือปิดการรับกลุ่ม')
    return row,link


def enqueue_reply(db, ctx, conv, mid):
    """Queue a stored reply for the delivery worker (same transaction as the message)."""
    row = setting(db,conv['channel'])
    job_id = uid()
    reference = f'<bookdose.{job_id}@{row["config"]["address"].split("@")[1]}>' if conv['channel']=='email' else ''
    repository.insert_outbox(db,job_id,mid,row['route_id'],conv['channel'],ctx['id'],row['generation'],str(uuid.UUID(job_id)),reference)
    if conv['channel']=='line':
        F.prepare(db,conv,mid,{**row['config'],'_tenant_id':ctx['tenant_id']},job_id)
    if reference:
        repository.insert_reply_ref(db,reference,conv['id'],row['route_id'])
    conversations.set_delivery(db,mid,'queued')


def delivery(db, mid):
    """Delivery state shown next to a message, or None for messages that are not sent anywhere."""
    row = repository.outbox_for_message(db,mid)
    if not row:
        return None
    return schema.delivery_view(row,CHANNEL_ERRORS.get(row['error'],''),
                                row['status']=='failed' and not repository.find_ai_guard(db,mid),
                                repository.has_active_file_links(db,mid))


def line_retry_window_passed(job):
    return job['kind']=='line' and job['first_attempt_at'] and utc_now()-dt.datetime.fromisoformat(job['first_attempt_at'])>=dt.timedelta(hours=LINE_RETRY_KEY_HOURS)


def retry_message(db, ctx, mid):
    job = repository.outbox_for_message(db,mid)
    if job and job['kind']==facebook.KIND:
        return facebook.retry(db,ctx,job)
    require(not repository.find_ai_guard(db,mid),'ข้อความ AI ที่ยกเลิกแล้วไม่ส่งซ้ำ กรุณาตรวจและส่งข้อความใหม่')
    require(F.valid(db,mid),'ลิงก์ไฟล์หมดอายุหรือถูกถอน กรุณาสร้างข้อความใหม่')
    require(job and job['status']=='failed','ส่งซ้ำได้เฉพาะรายการที่ยืนยันว่าส่งไม่สำเร็จ')
    message = conversations.find_message(db,mid)
    conv = conversations.find(db,message['conversation_id'])
    check_reply(db,ctx['tenant_id'],conv,{'body':message['body'],'attachments':conversations.attachment_records(db,mid)})
    if line_retry_window_passed(job):
        raise ChannelError('expired',uncertain=True)
    row = setting(db,job['kind'])
    repository.requeue_outbox(db,job['id'],ctx['id'],row['generation'])
    conversations.set_delivery(db,mid,'queued')
    audit.record(db,ctx['name'],'channel.retry_requested',message['conversation_id'])


def retry_failed_delivery(db, ctx, message_id):
    D.begin(db)
    message = conversations.find_message(db,message_id)
    require(message,'ไม่พบข้อความ',404)
    get_scoped(db,'conversations',message['conversation_id'],ctx)
    retry_message(db,ctx,message_id)
    db.commit()


def revoke_message_files(db, ctx, message_id):
    """Invalidate the temporary links of files sent to LINE with this message."""
    D.begin(db)
    message = conversations.find_message(db,message_id)
    require(message,'ไม่พบข้อความ',404)
    get_scoped(db,'conversations',message['conversation_id'],ctx)
    F.revoke(db,message_id)
    audit.record(db,ctx['name'],'message.files_revoked',message['conversation_id'])
    db.commit()


def file_link_download(tenant_id, token):
    """(name, mime, bytes) behind a temporary LINE file link; the token is the permission (no sign-in)."""
    with D.control() as cd:
        file = F.resolve(cd,tenant_id,token)
    require(file,'ลิงก์ไฟล์ไม่ถูกต้อง หมดอายุ หรือถูกถอนแล้ว',404)
    return conversation_service.attachment_content(tenant_id,file)


def sender_permitted(cd, tenant_id, job, conv, db):
    """The author may still send: an active member with access to the team, or a still-valid chatbot answer."""
    member = organization.find_active_membership(cd,tenant_id,job['actor_id'])
    if job['actor_id']==AI_ACTOR:
        return active(cd,tenant_id) and ai_send_allowed(db,tenant_id,job,conv)
    return active(cd,tenant_id) and member and (member['role']!='agent' or member['team_id']==conv['team_id'])


def finish(db, job, status, error='', provider_id=None):
    repository.finish_outbox(db,job['id'],status,error,provider_id)
    conversations.set_delivery(db,job['message_id'],status)
    # A staff reply on LINE / Email counts as the first response once the provider accepts it.
    if status=='accepted' and not conversations.ai_meta(db,job['message_id']):
        tickets.record_first_response_for_message(db,job['message_id'])


def process_outbox(tenant_id):
    """Send one queued reply: re-check permission and settings, send outside the transaction, record the result."""
    with D.control() as cd, D.tenant(tenant_id) as db:
        D.begin(cd)
        D.begin(db)
        for old in repository.stale_sending(db,after(seconds=-LEASE_SECONDS)):
            # An email may already have gone out; LINE's retry key makes a resend safe.
            finish(db,old,'unknown' if old['kind']=='email' else 'queued','unknown' if old['kind']=='email' else '')
        if repository.any_sending(db):
            return False
        job = repository.next_queued(db)
        if not job:
            return False
        message = conversations.find_message(db,job['message_id'])
        conv = conversations.find(db,message['conversation_id'])
        row = setting(db,job['kind'])
        link = repository.link_for_conversation(db,conv['id'])
        if not sender_permitted(cd,tenant_id,job,conv,db) or not row['enabled'] or row['generation']!=job['generation'] or not link or link['account_identity']!=row['config']['identity']:
            finish(db,job,'failed','changed')
            return True
        if line_retry_window_passed(job):
            finish(db,job,'unknown','expired')
            return True
        thread = repository.find_line_thread(db,conv['id'])
        if job['kind']=='line' and (not F.valid(db,job['message_id']) or thread and (not thread['active'] or thread['source_type']!='user' and not row['config'].get('groups_enabled'))):
            finish(db,job,'failed','changed')
            return True
        secret = read_secret(tenant_id,job['kind'])
        if job['kind']=='line' and not secret.get('access_token') or job['kind']=='email' and not O.configured(row['config'],secret):
            finish(db,job,'failed','credentials')
            return True
        lease = uid()
        attempts = job['attempts']+1
        repository.claim_outbox(db,job['id'],lease,attempts)
        conversations.set_delivery(db,job['message_id'],'sending')
        attachments = conversations.attachment_records(db,job['message_id'])
        line_payload = repository.outbox_payload(db,job['id'])
        reference = repository.latest_reply_reference(db,conv['id'],job['provider_id'])
    error = None
    provider_id = None
    try:
        if job['kind']=='line':
            provider_id = T.send_line(secret,link['recipient'],json.loads(line_payload) if line_payload else message['body'],job['retry_key'])
        else:
            secret = O.access_secret(tenant_id,row['config'],secret)
            for file in attachments:
                file['content'] = conversations.attachment_path(tenant_id,file['storage_key']).read_bytes()
            mail = T.build_email(row['config'],link['recipient'],conv['subject'],message['body'],job['provider_id'],reference,attachments)
            provider_id = T.send_email(row['config'],secret,link['recipient'],mail)
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
        if job['actor_id']==AI_ACTOR and status in ('failed','unknown'):
            ai.stop_bot(db,conv['id'],'delivery_failed')
            if not tickets.is_conversation_linked(db,conv['id']):
                ticket_service.open_ticket(db,conv['contact_id'],conv['team_id'],conv['subject'],'normal',conversation_id=conv['id'])
        if status=='queued':
            repository.set_next_attempt(db,job['id'],after(seconds=10*3**(attempts-1)))
        audit.record(db,'ระบบส่งข้อความ','channel.'+status,conv['id'],job['kind'])
    return True


# Chatbot on LINE / Email
def bot_enabled(db, conv):
    row = setting(db,conv['channel'])
    if not row or not row['enabled'] or not row['config'].get('chatbot_enabled'):
        return False
    if conv['channel']=='line':
        thread = repository.find_line_thread(db,conv['id'])
        if thread and (not thread['active'] or thread['source_type']!='user' and not (row['config'].get('groups_enabled') and row['config'].get('group_chatbot_enabled'))):
            return False
    return True


def on_external_customer(db, tenant_id, conv_id, text, is_new=False):
    conv = conversations.find(db,conv_id)
    if bot_enabled(db,conv):
        ai.on_customer_message(db,tenant_id,conv_id,text,is_new=is_new)


def queue_ai(db, mid, job=None, signature=None, notice=False):
    """Send a chatbot answer or notice through the channel, remembering what it was based on for a last check before sending."""
    tenant_id = repository.tenant_id_of(db)
    message = conversations.find_message(db,mid)
    conv = conversations.find(db,message['conversation_id'])
    if not bot_enabled(db,conv) or not ai.has_key(tenant_id):
        conversations.make_note(db,mid)
        return
    text = '[Bookdose AI]\n'+message['body']
    meta = conversations.ai_meta(db,mid)
    if meta:
        citations = json.loads(meta['citations'])
        if citations:
            text += '\n\nอ้างอิง: '+'; '.join(c['title']+' - '+c['quote'] for c in citations if c.get('visibility')=='public')
    if conv['channel']=='line' and schema.line_text_length(text)>schema.LINE_TEXT_LIMIT:
        conversations.make_note(db,mid)
        ai.handoff(db,conv['id'],'answer_too_long')
        return
    conversations.set_body(db,mid,text)
    enqueue_reply(db,{'tenant_id':tenant_id,'id':AI_ACTOR},conv,mid)
    trigger = conversations.latest_message_id(db,conv['id'],kind='customer')
    repository.insert_ai_guard(db,mid,job['id'] if job else None,ai.config(db)['version'],signature,job['trigger_id'] if job else trigger,notice)


def ai_send_allowed(db, tenant_id, job, conv):
    """A chatbot answer is only sent if nothing it relied on has changed since it was written."""
    guard = repository.find_ai_guard(db,job['message_id'])
    if not guard or not bot_enabled(db,conv) or not ai.has_key(tenant_id) or ai.config(db)['version']!=guard['config_version']:
        return False
    latest = conversations.latest_message_id(db,conv['id'],kind='customer')
    if not latest or latest!=guard['trigger_id']:
        return False
    if guard['notice']:
        return ai.conversation_state(db,conv['id'])['mode']=='human'
    if ai.conversation_state(db,conv['id'])['mode']!='bot' or conv['status']!='open':
        return False
    source_job = ai.find_job(db,guard['job_id'])
    return bool(source_job and guard['signature']==ai.snapshot(db,source_job,exclude_message=job['message_id'])[2])


def cancel_ai_outbox(db, conversation_id):
    for job in repository.queued_ai_for_conversation(db,conversation_id):
        finish(db,job,'failed','changed')


class Worker:
    """Two background threads: LINE events and outgoing replies (LINE, Email, Facebook) every second,
    email polling every two seconds."""
    def __init__(self, store_message):
        self.stop = threading.Event()
        self.store_message = store_message
        self.threads = [threading.Thread(target=self.run,args=(mail,),daemon=True,name='bookdose-email' if mail else 'bookdose-channels') for mail in (False,True)]

    def start(self):
        for thread in self.threads:
            thread.start()

    def run(self, mail):
        while not self.stop.wait(1 if not mail else 2):
            try:
                with D.control() as cd:
                    ids = tenants.active_tenant_ids(cd)
                for tid in ids:
                    if self.stop.is_set():
                        return
                    try:
                        if mail:
                            poll_email(tid,self.store_message)
                        else:
                            process_outbox(tid)
                            process_line(tid,self.store_message)
                            facebook.process_outbox(tid)
                    except Exception as error:
                        print(f'Channel worker: {type(error).__name__}; retrying scan',flush=True)
            except Exception as error:
                print(f'Channel worker: {type(error).__name__}; retrying scan',flush=True)
