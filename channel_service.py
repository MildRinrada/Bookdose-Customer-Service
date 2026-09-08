"""Tenant-aware inbound adapters and transactional outbox for LINE and Email."""
import base64
import datetime as dt
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import threading
import uuid

import database as D
import channel_transport as T


class ConfigError(ValueError):pass


def check(condition,message):
    if not condition:raise ConfigError(message)


def text_field(body,key,default='',maximum=250):
    value=body.get(key,default)
    check(isinstance(value,str) and len(value)<=maximum and not any(ord(c)<32 for c in value),f'ข้อมูล {key} ไม่ถูกต้อง')
    return value.strip()


def secret_path(tenant_id,kind):
    D.tenant_path(tenant_id)
    check(kind in ('line','email'),'ช่องทางไม่ถูกต้อง')
    return D.DATA/'secrets'/f'{tenant_id}.{kind}.json'


def read_secret(tenant_id,kind):
    path=secret_path(tenant_id,kind)
    return json.loads(path.read_text()) if path.is_file() else {}


def write_secret(tenant_id,kind,value):
    path=secret_path(tenant_id,kind)
    path.parent.mkdir(exist_ok=True,mode=0o700)
    if not value:
        path.unlink(missing_ok=True);return
    temporary=path.with_suffix('.'+D.uid()+'.tmp')
    fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as file:json.dump(value,file)
    os.replace(temporary,path)


def setting(db,kind):
    row=D.one(db,'SELECT * FROM channel_settings WHERE kind=?',(kind,))
    if row:row['config']=json.loads(row['config'])
    return row


def overview(db,tenant_id):
    output=[]
    team=db.execute('SELECT id FROM teams ORDER BY rowid LIMIT 1').fetchone()[0]
    for kind in ('line','email'):
        row=setting(db,kind)
        cfg=row['config'] if row else {'team_id':team}
        secrets=read_secret(tenant_id,kind)
        fields=('channel_secret','access_token') if kind=='line' else ('password',)
        output.append({'kind':kind,'enabled':bool(row and row['enabled']),'config':cfg,
            'credentials_configured':all(secrets.get(key) for key in fields),'route_id':row['route_id'] if row else None,
            'last_error':T.ERRORS.get(row['last_error'],'') if row else '',
            'last_checked':row['last_checked'] if row else None,'last_received':row['last_received'] if row else None,
            'outbox':D.rows(db,'SELECT status,COUNT(*) AS count FROM channel_outbox WHERE kind=? GROUP BY status',(kind,)),
            'events':D.rows(db,'SELECT status,error,created_at FROM channel_inbox WHERE kind=? ORDER BY created_at DESC LIMIT 10',(kind,))})
    return output


def bind_identity(cd,route_id,tenant_id,kind,identity):
    route=D.one(cd,'SELECT * FROM channel_routes WHERE id=?',(route_id,))
    if route and route['identity']:
        check(route['identity']==identity,'ช่องทางนี้ผูกบัญชีเดิมแล้ว ไม่สามารถเปลี่ยนเป็นบัญชีอื่นในประวัติเดิมได้')
    duplicate=D.one(cd,'SELECT id FROM channel_routes WHERE kind=? AND identity=? AND id!=?',(kind,identity,route_id))
    check(not duplicate,'บัญชีช่องทางนี้ถูกใช้งานในองค์กรอื่นแล้ว')
    if route:
        cd.execute('UPDATE channel_routes SET identity=? WHERE id=?',(identity,route_id))
    else:
        cd.execute('INSERT INTO channel_routes VALUES(?,?,?,?)',(route_id,tenant_id,kind,identity))


def save_channel(cd,db,ctx,kind,body):
    check(kind in ('line','email'),'ช่องทางไม่ถูกต้อง')
    old=setting(db,kind);cfg=dict(old['config']) if old else {}
    route_id=old['route_id'] if old else D.uid()
    enabled=body.get('enabled',bool(old and old['enabled']))
    check(type(enabled) is bool,'สถานะช่องทางไม่ถูกต้อง')
    cfg['team_id']=text_field(body,'team_id',cfg.get('team_id',ctx['team_id']),32)
    check(D.one(db,'SELECT 1 FROM teams WHERE id=?',(cfg['team_id'],)),'ไม่พบทีมรับเรื่อง')
    secret=read_secret(ctx['tenant_id'],kind)
    remove=body.get('remove_credentials',False)
    check(type(remove) is bool and not (remove and enabled),'ปิดช่องทางก่อนลบข้อมูลเชื่อมต่อ')
    for key in ('channel_secret','access_token') if kind=='line' else ('password',):
        value=body.get(key,'')
        check(isinstance(value,str) and len(value)<=2000 and not any(ord(c)<32 for c in value),f'ข้อมูล {key} ไม่ถูกต้อง')
        if value:secret[key]=value
    if remove:secret={}
    info=None
    if kind=='email':
        address=text_field(body,'address',cfg.get('address',''))
        try:cfg['address']=T.email_address(address)
        except T.ChannelError:raise ConfigError('กรุณาระบุอีเมลของช่องทางให้ถูกต้อง') from None
        cfg['username']=text_field(body,'username',cfg.get('username',cfg['address'])) or cfg['address']
        for key in ('imap_host','smtp_host'):
            value=text_field(body,key,cfg.get(key,''))
            check(re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?',value),'กรุณาระบุชื่อเซิร์ฟเวอร์ IMAP และ SMTP โดยไม่ใส่ https://')
            cfg[key]=value.lower()
        port=body.get('smtp_port',cfg.get('smtp_port',465))
        check(type(port) is int and port in (465,587),'SMTP รองรับ 465 (TLS) หรือ 587 (STARTTLS)')
        cfg['smtp_port']=port
        interval=body.get('poll_seconds',cfg.get('poll_seconds',60))
        check(type(interval) is int and 30<=interval<=600,'รอบรับอีเมลต้องอยู่ระหว่าง 30–600 วินาที')
        cfg['poll_seconds']=interval
        cfg['identity']=cfg['address']
        if enabled:
            check(bool(secret.get('password')),'กรุณาระบุรหัสผ่านหรือ App Password ของอีเมล')
            info=T.verify_email(cfg,secret)
    else:
        if enabled:
            check(bool(secret.get('access_token') and secret.get('channel_secret')),'กรุณาระบุ Channel Secret และ Channel Access Token')
            info=T.verify_line(secret);cfg.update(info)
    # Provider checks happen before starting write transactions.
    cd.execute('BEGIN IMMEDIATE');db.execute('BEGIN IMMEDIATE')
    identity=cfg.get('identity')
    if identity:bind_identity(cd,route_id,ctx['tenant_id'],kind,identity)
    elif not old:cd.execute('INSERT INTO channel_routes VALUES(?,?,?,?)',(route_id,ctx['tenant_id'],kind,None))
    generation=D.uid()
    if not old:
        db.execute('INSERT INTO channel_settings(kind,route_id,generation) VALUES(?,?,?)',(kind,route_id,generation))
    if kind=='email' and info and not (old and old['uidvalidity']):
        db.execute('UPDATE channel_settings SET uidvalidity=?,last_uid=? WHERE kind=?',(info['uidvalidity'],max(0,info['uidnext']-1),kind))
    write_secret(ctx['tenant_id'],kind,secret)
    db.execute('''UPDATE channel_settings SET enabled=?,config=?,generation=?,last_error='',
                  last_checked=?,next_poll=NULL,poll_lease=NULL,poll_started=NULL WHERE kind=?''',
               (int(enabled),json.dumps(cfg,ensure_ascii=False),generation,D.now() if info else (old['last_checked'] if old else None),kind))
    # Never migrate a queued message silently onto newly edited credentials/settings.
    db.execute("UPDATE channel_outbox SET status='failed',error='changed',updated_at=? WHERE kind=? AND status='queued'",(D.now(),kind))
    db.execute("UPDATE messages SET delivery='failed' WHERE id IN (SELECT message_id FROM channel_outbox WHERE kind=? AND status='failed')",(kind,))
    D.audit(db,ctx['name'],'channel.settings_updated',route_id,kind)
    db.commit();cd.commit()
    return overview(db,ctx['tenant_id'])


def test_channel(db,tenant_id,kind):
    row=setting(db,kind)
    if not row:raise T.ChannelError('credentials')
    secret=read_secret(tenant_id,kind)
    if not all(secret.get(k) for k in (('channel_secret','access_token') if kind=='line' else ('password',))):raise T.ChannelError('credentials')
    try:
        info=T.verify_line(secret) if kind=='line' else T.verify_email(row['config'],secret)
        if kind=='line' and row['config'].get('identity') and info['identity']!=row['config']['identity']:
            raise T.ChannelError('credentials')
    except T.ChannelError as error:
        db.execute('UPDATE channel_settings SET last_error=?,last_checked=? WHERE kind=?',(error.code,D.now(),kind));db.commit();raise
    db.execute("UPDATE channel_settings SET last_error='',last_checked=? WHERE kind=?",(D.now(),kind));db.commit()
    return {'ok':True,'message':'เชื่อมต่อสำเร็จ (ยังไม่ได้ส่งข้อความจริง)'}


def accept_line(cd,route_id,raw,signature):
    route=D.one(cd,"SELECT r.* FROM channel_routes r JOIN tenants t ON t.id=r.tenant_id WHERE r.id=? AND r.kind='line' AND t.status='active'",(route_id,))
    if not route:raise T.ChannelError('disabled')
    secret=read_secret(route['tenant_id'],'line').get('channel_secret','')
    expected=base64.b64encode(hmac.new(secret.encode(),raw,hashlib.sha256).digest()).decode()
    if not secret or not hmac.compare_digest(signature,expected):raise PermissionError('Invalid LINE signature')
    try:data=json.loads(raw)
    except (ValueError,UnicodeError):raise ConfigError('Webhook JSON ไม่ถูกต้อง') from None
    check(isinstance(data,dict) and data.get('destination')==route['identity'],'Webhook ไม่ตรงกับบัญชี LINE ที่เชื่อมไว้')
    events=data.get('events')
    check(isinstance(events,list) and len(events)<=100,'Webhook events ไม่ถูกต้อง')
    for event in events:
        check(isinstance(event,dict) and isinstance(event.get('webhookEventId'),str) and 1<=len(event['webhookEventId'])<=100,'Webhook event ID ไม่ถูกต้อง')
    with D.tenant(route['tenant_id']) as db:
        db.execute('BEGIN IMMEDIATE');row=setting(db,'line')
        if not row or not row['enabled']:raise T.ChannelError('disabled')
        for event in events:
            db.execute('''INSERT OR IGNORE INTO channel_inbox(id,route_id,event_key,kind,payload,generation,created_at,updated_at)
                          VALUES(?,?,?,'line',?,?,?,?)''',(D.uid(),route_id,event['webhookEventId'],json.dumps(event,ensure_ascii=False),row['generation'],D.now(),D.now()))
        db.execute("UPDATE channel_settings SET last_received=?,last_error='' WHERE kind='line'",(D.now(),))
    return {'ok':True}


def active(cd,tenant_id):return bool(D.one(cd,"SELECT 1 FROM tenants WHERE id=? AND status='active'",(tenant_id,)))


def new_conversation(db,row,key,recipient,name,email,subject):
    cid,conv=D.uid(),D.uid()
    db.execute('INSERT INTO contacts VALUES(?,?,?,?,?,?,?,?)',(cid,name[:100],email,'','','','channel',D.now()))
    db.execute('INSERT INTO conversations VALUES(?,?,?,?,?,?,?,?,?)',(conv,cid,subject[:300],row['kind'],row['config']['team_id'],'open',None,D.now(),D.now()))
    db.execute('INSERT INTO channel_conversations VALUES(?,?,?,?,?,?)',(conv,row['route_id'],key,recipient,row['config']['identity'],None))
    return conv


def ingest_line(db,tenant_id,row,event,attachment,store_message):
    source=event.get('source') or {};message=event.get('message') or {}
    if not isinstance(source,dict) or not isinstance(message,dict):raise T.ChannelError('ignored')
    sender=source.get('userId','')
    if event.get('type')!='message' or source.get('type')!='user' or not isinstance(sender,str) or not re.fullmatch(r'U[a-fA-F0-9]{32}',sender):
        raise T.ChannelError('ignored')
    message_type=message.get('type','unknown')
    text=message.get('text','') if message_type=='text' else f'[ได้รับ {message_type} ผ่าน LINE]'
    if not isinstance(text,str):raise T.ChannelError('ignored')
    if message_type in ('image','file') and not attachment:text+='\n[นำเข้าไฟล์ไม่สำเร็จ กรุณาตรวจจาก LINE ต้นทาง]'
    text=text.strip() or '(ข้อความว่างจาก LINE)'
    link=D.one(db,'SELECT * FROM channel_conversations WHERE route_id=? AND external_key=?',(row['route_id'],sender))
    try:occurred=dt.datetime.fromtimestamp(int(event.get('timestamp',0))/1000,dt.timezone.utc).isoformat(timespec='seconds')
    except (ValueError,TypeError,OverflowError,OSError):raise T.ChannelError('ignored') from None
    conv=link['conversation_id'] if link else new_conversation(db,row,sender,sender,'LINE • '+sender[-6:],'',text or 'ข้อความจาก LINE')
    previous=D.one(db,'SELECT status,updated_at FROM conversations WHERE id=?',(conv,))
    tickets=D.rows(db,'SELECT t.id,t.status,t.resolved_at,t.updated_at FROM tickets t JOIN ticket_conversations tc ON tc.ticket_id=t.id WHERE tc.conversation_id=?',(conv,))
    name=db.execute('SELECT c.name FROM contacts c JOIN conversations v ON v.contact_id=c.id WHERE v.id=?',(conv,)).fetchone()[0]
    mid=store_message(db,tenant_id,conv,None,name,'customer',{'body':text[:19000] or '(ข้อความว่างจาก LINE)','attachments':[attachment] if attachment else []})
    db.execute('UPDATE messages SET created_at=? WHERE id=?',(occurred,mid))
    late=link and link['last_event_time'] and occurred<link['last_event_time']
    if late:
        db.execute('UPDATE conversations SET status=?,updated_at=? WHERE id=?',(previous['status'],previous['updated_at'],conv))
        for ticket in tickets:db.execute('UPDATE tickets SET status=?,resolved_at=?,updated_at=? WHERE id=?',(ticket['status'],ticket['resolved_at'],ticket['updated_at'],ticket['id']))
    else:db.execute('UPDATE channel_conversations SET last_event_time=? WHERE conversation_id=?',(occurred,conv))
    D.audit(db,'LINE','channel.message_received',conv)
    return mid


def process_line(tenant_id,store_message):
    with D.control() as cd,D.tenant(tenant_id) as db:
        db.execute('BEGIN IMMEDIATE');row=setting(db,'line')
        if not active(cd,tenant_id) or not row or not row['enabled']:return False
        expired=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(seconds=120)).isoformat(timespec='seconds')
        db.execute("UPDATE channel_inbox SET status='pending' WHERE kind='line' AND status='running' AND updated_at<?",(expired,))
        retry_at=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(seconds=10)).isoformat(timespec='seconds')
        event=D.one(db,"SELECT * FROM channel_inbox WHERE kind='line' AND status='pending' AND (attempts=0 OR updated_at<=?) ORDER BY rowid LIMIT 1",(retry_at,))
        if not event:return False
        if event['generation']!=row['generation']:
            db.execute("UPDATE channel_inbox SET status='failed',error='changed',payload='{}',updated_at=? WHERE id=?",(D.now(),event['id']));return True
        lease=D.uid()
        db.execute("UPDATE channel_inbox SET status='running',lease=?,attempts=attempts+1,updated_at=? WHERE id=?",(lease,D.now(),event['id']))
        payload=json.loads(event['payload']);secret=read_secret(tenant_id,'line')
    attachment=None;media_error=None
    if payload.get('type')=='message' and isinstance(payload.get('message'),dict) and payload['message'].get('type') in ('image','file'):
        try:attachment=T.line_media(secret,payload['message'])
        except T.ChannelError as error:media_error=error
    with D.control() as cd,D.tenant(tenant_id) as db:
        cd.execute('BEGIN IMMEDIATE');db.execute('BEGIN IMMEDIATE')
        current=D.one(db,'SELECT * FROM channel_inbox WHERE id=?',(event['id'],));latest=setting(db,'line')
        if current['lease']!=lease or current['status']!='running':return True
        if not active(cd,tenant_id) or not latest['enabled'] or latest['generation']!=row['generation']:
            db.execute("UPDATE channel_inbox SET status='failed',error='changed',updated_at=? WHERE id=?",(D.now(),event['id']));return True
        if media_error and media_error.retryable and current['attempts']<3:
            db.execute("UPDATE channel_inbox SET status='pending',error=?,updated_at=? WHERE id=?",(media_error.code,D.now(),event['id']));return True
        try:
            ingest_line(db,tenant_id,row,payload,attachment,store_message)
            status,error='done','media' if media_error else ''
        except T.ChannelError as problem:
            status,error='ignored',problem.code
        db.execute('UPDATE channel_inbox SET status=?,error=?,payload=\'{}\',updated_at=? WHERE id=?',(status,error,D.now(),event['id']))
    return True


def ingest_email(db,tenant_id,row,record,store_message):
    conversation=None
    # Thread only using an opaque Message-ID that this system issued and the same sender.
    for reference in reversed(record['references']):
        conversation=D.one(db,'''SELECT cc.* FROM email_reply_refs r JOIN channel_conversations cc ON cc.conversation_id=r.conversation_id
                    WHERE r.reference=? AND r.route_id=? AND cc.recipient=?''',(reference,row['route_id'],record['sender']))
        if conversation:break
    key='mail:'+D.uid()
    conv=conversation['conversation_id'] if conversation else new_conversation(db,row,key,record['sender'],record['name'],record['sender'],record['subject'])
    mid=store_message(db,tenant_id,conv,None,record['name'],'customer',record)
    D.audit(db,'Email','channel.message_received',conv)
    return mid


def poll_email(tenant_id,store_message):
    with D.control() as cd,D.tenant(tenant_id) as db:
        db.execute('BEGIN IMMEDIATE');row=setting(db,'email')
        if not active(cd,tenant_id) or not row or not row['enabled']:return False
        if row['next_poll'] and row['next_poll']>D.now():return False
        expired=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(seconds=120)).isoformat(timespec='seconds')
        if row['poll_lease'] and row['poll_started'] and row['poll_started']>expired:return False
        lease=D.uid()
        db.execute('UPDATE channel_settings SET poll_lease=?,poll_started=?,next_poll=? WHERE kind=\'email\'',
            (lease,D.now(),(dt.datetime.now(dt.timezone.utc)+dt.timedelta(seconds=row['config']['poll_seconds'])).isoformat(timespec='seconds')))
        secret=read_secret(tenant_id,'email')
    try:batch=T.fetch_email(row['config'],secret,row);failure=None
    except T.ChannelError as error:batch=None;failure=error.code
    except Exception:batch=None;failure='network'
    with D.control() as cd,D.tenant(tenant_id) as db:
        cd.execute('BEGIN IMMEDIATE');db.execute('BEGIN IMMEDIATE')
        current=setting(db,'email')
        if current['poll_lease']!=lease:return True
        if not active(cd,tenant_id) or not current['enabled'] or current['generation']!=row['generation']:
            db.execute("UPDATE channel_settings SET poll_lease=NULL,poll_started=NULL WHERE kind='email'");return True
        error=failure or ('mailbox_reset' if batch['reset'] else '')
        if batch and batch['reset']:
            db.execute("UPDATE channel_settings SET uidvalidity=?,last_uid=? WHERE kind='email'",(batch['uidvalidity'],max(0,batch['uidnext']-1)))
        if batch and not batch['reset']:
            for uid,raw in batch['messages']:
                event_key=batch['uidvalidity']+':'+str(uid)
                duplicate=D.one(db,'SELECT id FROM channel_inbox WHERE route_id=? AND event_key=?',(row['route_id'],event_key))
                if duplicate:
                    db.execute("UPDATE channel_settings SET last_uid=MAX(last_uid,?) WHERE kind='email'",(uid,));continue
                status,reason='done',''
                try:
                    if raw is None:raise T.ChannelError('size')
                    record=T.parse_email(raw,row['config']['address'])
                    # Deduplicate copies with the same Message-ID + sender without merging contact identities.
                    dedup='message:'+D.token_hash(record['sender']+'\n'+record['message_id']) if record['message_id'] else None
                    if dedup and D.one(db,'SELECT id FROM channel_inbox WHERE route_id=? AND event_key=?',(row['route_id'],dedup)):
                        status,reason='ignored','ignored'
                    else:
                        ingest_email(db,tenant_id,row,record,store_message)
                        if dedup:db.execute('''INSERT INTO channel_inbox(id,route_id,event_key,kind,generation,status,created_at,updated_at) VALUES(?,?,?,'email',?,'done',?,?)''',(D.uid(),row['route_id'],dedup,row['generation'],D.now(),D.now()))
                except T.ChannelError as problem:status,reason='ignored',problem.code
                except (ValueError,TypeError,UnicodeError):status,reason='ignored','ignored'
                db.execute('''INSERT INTO channel_inbox(id,route_id,event_key,kind,generation,status,error,created_at,updated_at)
                              VALUES(?,?,?,'email',?,?,?,?,?)''',(D.uid(),row['route_id'],event_key,row['generation'],status,reason,D.now(),D.now()))
                db.execute("UPDATE channel_settings SET last_uid=MAX(last_uid,?),last_received=? WHERE kind='email'",(uid,D.now()))
                if reason not in ('','ignored'):error=reason
        db.execute("UPDATE channel_settings SET poll_lease=NULL,poll_started=NULL,last_checked=?,last_error=? WHERE kind='email'",(D.now(),error))
    return True


def check_reply(db,tenant_id,conv,body):
    row=setting(db,conv['channel']);link=D.one(db,'SELECT * FROM channel_conversations WHERE conversation_id=?',(conv['id'],))
    if not row or not row['enabled'] or not link:raise T.ChannelError('disabled')
    if row['config'].get('identity')!=link['account_identity']:raise T.ChannelError('changed')
    secret=read_secret(tenant_id,conv['channel'])
    if not all(secret.get(key) for key in (('access_token','channel_secret') if conv['channel']=='line' else ('password',))):raise T.ChannelError('credentials')
    if conv['channel']=='line':
        text=body.get('body','')
        check(isinstance(text,str) and text.strip() and len(text.encode('utf-16-le'))//2<=5000,'LINE ส่งได้เฉพาะข้อความยาวไม่เกิน 5,000 หน่วยอักขระ')
        check(not body.get('attachments'),'การตอบ LINE รุ่นนี้รองรับข้อความเท่านั้น ไฟล์แนบใช้บันทึกภายในได้')
    return row,link


def enqueue_reply(db,ctx,conv,mid):
    row=setting(db,conv['channel']);job_id=D.uid()
    reference=f'<bookdose.{job_id}@{row["config"]["address"].split("@")[1]}>' if conv['channel']=='email' else ''
    db.execute('''INSERT INTO channel_outbox(id,message_id,route_id,kind,actor_id,generation,retry_key,provider_id,created_at,updated_at)
                  VALUES(?,?,?,?,?,?,?,?,?,?)''',(job_id,mid,row['route_id'],conv['channel'],ctx['id'],row['generation'],str(uuid.UUID(job_id)),reference,D.now(),D.now()))
    if reference:db.execute('INSERT INTO email_reply_refs VALUES(?,?,?)',(reference,conv['id'],row['route_id']))
    db.execute("UPDATE messages SET delivery='queued' WHERE id=?",(mid,))


def delivery(db,mid):
    row=D.one(db,'SELECT status,error,attempts FROM channel_outbox WHERE message_id=?',(mid,))
    return {'error':T.ERRORS.get(row['error'],''),'retryable':row['status']=='failed','attempts':row['attempts']} if row else None


def retry_message(db,ctx,mid):
    job=D.one(db,'SELECT * FROM channel_outbox WHERE message_id=?',(mid,))
    check(job and job['status']=='failed','ส่งซ้ำได้เฉพาะรายการที่ยืนยันว่าส่งไม่สำเร็จ')
    message=D.one(db,'SELECT * FROM messages WHERE id=?',(mid,));conv=D.one(db,'SELECT * FROM conversations WHERE id=?',(message['conversation_id'],))
    check_reply(db,ctx['tenant_id'],conv,{'body':message['body']})
    if job['kind']=='line' and job['first_attempt_at'] and dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(job['first_attempt_at'])>=dt.timedelta(hours=23):
        raise T.ChannelError('expired',uncertain=True)
    row=setting(db,job['kind'])
    db.execute("UPDATE channel_outbox SET status='queued',error='',actor_id=?,generation=?,attempts=0,next_attempt_at=NULL,updated_at=? WHERE id=?",(ctx['id'],row['generation'],D.now(),job['id']))
    db.execute("UPDATE messages SET delivery='queued' WHERE id=?",(mid,))
    D.audit(db,ctx['name'],'channel.retry_requested',message['conversation_id'])


def sender_permitted(cd,tenant_id,job,conv):
    member=D.one(cd,'SELECT * FROM memberships WHERE tenant_id=? AND user_id=? AND active=1',(tenant_id,job['actor_id']))
    return active(cd,tenant_id) and member and (member['role']!='agent' or member['team_id']==conv['team_id'])


def finish(db,job,status,error='',provider_id=None):
    db.execute('UPDATE channel_outbox SET status=?,error=?,provider_id=COALESCE(?,provider_id),updated_at=? WHERE id=?',(status,error,provider_id,D.now(),job['id']))
    db.execute('UPDATE messages SET delivery=? WHERE id=?',(status,job['message_id']))
    if status=='accepted':
        db.execute('''UPDATE tickets SET first_response_at=COALESCE(first_response_at,?),updated_at=? WHERE id IN
            (SELECT ticket_id FROM ticket_conversations WHERE conversation_id=(SELECT conversation_id FROM messages WHERE id=?))''',(D.now(),D.now(),job['message_id']))


def process_outbox(tenant_id):
    with D.control() as cd,D.tenant(tenant_id) as db:
        cd.execute('BEGIN IMMEDIATE');db.execute('BEGIN IMMEDIATE')
        expired=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(seconds=120)).isoformat(timespec='seconds')
        for old in D.rows(db,"SELECT * FROM channel_outbox WHERE status='sending' AND updated_at<?",(expired,)):
            finish(db,old,'unknown' if old['kind']=='email' else 'queued','unknown' if old['kind']=='email' else '')
        if D.one(db,"SELECT 1 FROM channel_outbox WHERE status='sending'"):return False
        job=D.one(db,"SELECT * FROM channel_outbox WHERE status='queued' AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY rowid LIMIT 1",(D.now(),))
        if not job:return False
        message=D.one(db,'SELECT * FROM messages WHERE id=?',(job['message_id'],));conv=D.one(db,'SELECT * FROM conversations WHERE id=?',(message['conversation_id'],))
        row=setting(db,job['kind']);link=D.one(db,'SELECT * FROM channel_conversations WHERE conversation_id=?',(conv['id'],))
        if not sender_permitted(cd,tenant_id,job,conv) or not row['enabled'] or row['generation']!=job['generation'] or not link or link['account_identity']!=row['config']['identity']:
            finish(db,job,'failed','changed');return True
        if job['kind']=='line' and job['first_attempt_at'] and dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(job['first_attempt_at'])>=dt.timedelta(hours=23):
            finish(db,job,'unknown','expired');return True
        secret=read_secret(tenant_id,job['kind'])
        if not all(secret.get(key) for key in (('access_token',) if job['kind']=='line' else ('password',))):
            finish(db,job,'failed','credentials');return True
        lease=D.uid();attempts=job['attempts']+1
        db.execute("UPDATE channel_outbox SET status='sending',lease=?,attempts=?,first_attempt_at=COALESCE(first_attempt_at,?),updated_at=? WHERE id=?",(lease,attempts,D.now(),D.now(),job['id']))
        db.execute("UPDATE messages SET delivery='sending' WHERE id=?",(job['message_id'],))
        attachments=D.rows(db,'SELECT * FROM attachments WHERE message_id=?',(job['message_id'],))
        reference=D.one(db,'SELECT reference FROM email_reply_refs WHERE conversation_id=? AND reference!=? ORDER BY rowid DESC LIMIT 1',(conv['id'],job['provider_id']))
    error=None;provider_id=None
    try:
        if job['kind']=='line':provider_id=T.send_line(secret,link['recipient'],message['body'],job['retry_key'])
        else:
            for file in attachments:file['content']=(D.DATA/'files'/tenant_id/file['storage_key']).read_bytes()
            mail=T.build_email(row['config'],link['recipient'],conv['subject'],message['body'],job['provider_id'],reference['reference'] if reference else None,attachments)
            provider_id=T.send_email(row['config'],secret,link['recipient'],mail)
    except T.ChannelError as failure:error=failure
    except Exception:error=T.ChannelError('unknown',uncertain=True)
    with D.tenant(tenant_id) as db:
        db.execute('BEGIN IMMEDIATE')
        current=D.one(db,'SELECT * FROM channel_outbox WHERE id=?',(job['id'],))
        if current['lease']!=lease or current['status']!='sending':return True
        status='accepted' if not error else 'unknown' if error.uncertain else 'queued' if error.retryable and attempts<3 else 'failed'
        finish(db,job,status,error.code if error else '',provider_id)
        if status=='queued':
            next_time=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(seconds=10*3**(attempts-1))).isoformat(timespec='seconds')
            db.execute('UPDATE channel_outbox SET next_attempt_at=? WHERE id=?',(next_time,job['id']))
        D.audit(db,'ระบบส่งข้อความ','channel.'+status,conv['id'],job['kind'])
    return True


class Worker:
    def __init__(self,store_message):
        self.stop=threading.Event();self.store_message=store_message
        self.threads=[threading.Thread(target=self.run,args=(mail,),daemon=True,name='bookdose-email' if mail else 'bookdose-channels') for mail in (False,True)]
    def start(self):
        for thread in self.threads:thread.start()
    def run(self,mail):
        while not self.stop.wait(1 if not mail else 2):
            try:
                with D.control() as db:ids=[r[0] for r in db.execute("SELECT id FROM tenants WHERE status='active'")]
                for tid in ids:
                    if self.stop.is_set():return
                    try:
                        if mail:poll_email(tid,self.store_message)
                        else:process_outbox(tid);process_line(tid,self.store_message)
                    except Exception as error:print(f'Channel worker: {type(error).__name__}; retrying scan',flush=True)
            except Exception as error:print(f'Channel worker: {type(error).__name__}; retrying scan',flush=True)
