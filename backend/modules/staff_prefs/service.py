"""A staff member's working preferences (model.py): reading and saving them, whether they are available for new
cases, what their replies carry (signature, the name customers see), and the emails they asked for about their work."""
import json
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

from backend.database import db as D
from backend.database.db import one, rows
from backend.exceptions.errors import ChannelError
from backend.extensions import channel_transport as T
from backend.modules.staff_prefs import schema
from backend.modules.staff_prefs.model import DAYS, EVENTS, NOTICE_ATTEMPTS, NOTICE_KEEP_DAYS, STATUSES, WORK_TZ
from backend.utils.dates import after, now, utc_now
from backend.utils.security import uid
from backend.utils.validation import require


# Reading and saving
def prefs_of(cd, user_id):
    row = one(cd,'SELECT prefs FROM staff_preferences WHERE user_id=?',(user_id,))
    try:
        saved = json.loads(row['prefs']) if row else {}
    except ValueError:
        saved = {}
    return schema.merged(saved)


def _store(cd, user_id, prefs, status_changed=False):
    moment = now()
    cd.execute('''INSERT INTO staff_preferences(user_id,prefs,status_at,updated_at) VALUES(?,?,?,?)
                  ON CONFLICT(user_id) DO UPDATE SET prefs=excluded.prefs,updated_at=excluded.updated_at,
                  status_at=CASE WHEN ? THEN excluded.status_at ELSE staff_preferences.status_at END''',
               (user_id,json.dumps(prefs,ensure_ascii=False),moment,moment,int(status_changed)))


def status_since(cd, user_id):
    row = one(cd,'SELECT status_at FROM staff_preferences WHERE user_id=?',(user_id,))
    return row['status_at'] if row and row['status_at'] else None


def view(cd, user_id):
    """GET /api/account/preferences: the preferences, where the member stands now, and what the page offers."""
    from backend.modules.platform import service as platform
    prefs = prefs_of(cd,user_id)
    return {'preferences':prefs,'availability':{**availability(prefs),'since':status_since(cd,user_id)},
            'statuses':STATUSES,'events':EVENTS,'days':DAYS,'mail_ready':platform.registration_ready(cd)}


def save(cd, session, body):
    current = prefs_of(cd,session['user_id'])
    updated = schema.update(current,body)
    _store(cd,session['user_id'],updated,updated['status']!=current['status'])
    cd.commit()
    return view(cd,session['user_id'])


# Available for new cases
def availability(prefs, moment=None):
    """{'available', 'status', 'label', 'reason'}: whether routing may give this member a new case at `moment`."""
    moment = (moment or utc_now()).astimezone(WORK_TZ)
    status = prefs['status']
    found = {'status':status,'label':STATUSES[status]}
    if status!='online':
        return {**found,'available':False,'reason':STATUSES[status]}
    today = moment.date().isoformat()
    for item in prefs['leave']:
        if item['from']<=today<=item['to']:
            return {**found,'available':False,'reason':'ลาพัก'+(f" ({item['note']})" if item['note'] else '')}
    hours = prefs['hours']
    if hours['enabled'] and not _within(hours,moment):
        return {**found,'available':False,'reason':'นอกเวลาทำงาน'}
    return {**found,'available':True,'reason':''}


def _within(hours, moment):
    clock = moment.strftime('%H:%M')
    start,end = hours['start'],hours['end']
    if start<end:
        return moment.weekday() in hours['days'] and start<=clock<end
    # A shift past midnight belongs to the day it started on.
    if clock>=start:
        return moment.weekday() in hours['days']
    return clock<end and (moment.weekday()-1)%7 in hours['days']


def is_available(cd, user_id, moment=None):
    return availability(prefs_of(cd,user_id),moment)['available']


def availability_of(cd, user_ids):
    """{user_id: {'available','status','label','reason'}} for the members listed in the workspace."""
    ids = list(user_ids)
    saved = {row['user_id']:row['prefs'] for row in rows(cd,f"SELECT user_id,prefs FROM staff_preferences WHERE user_id IN ({','.join('?'*len(ids))})",ids)} if ids else {}
    found = {}
    for user_id in ids:
        try:
            prefs = schema.merged(json.loads(saved[user_id])) if user_id in saved else schema.merged({})
        except ValueError:
            prefs = schema.merged({})
        found[user_id] = availability(prefs)
    return found


# What a reply carries
def reply_parts(cd, user_id, name, text):
    """(the name the customer sees, the reply text with the member's signature when it is on)."""
    prefs = prefs_of(cd,user_id)
    signature = prefs['signature']
    if signature['enabled'] and signature['text'] and not text.rstrip().endswith(signature['text']):
        text = (text.rstrip()+'\n\n' if text.strip() else '')+signature['text']
    return prefs['alias'] or name,text


# Emails about the member's work
def queue(db, user_id, event, subject, detail='', path='', actor_id=None):
    """Queue an email for `user_id` inside the caller's transaction (the worker decides, with the member's
    preferences, whether it goes). Nothing for nobody, or for the member who did it themselves."""
    if not user_id or user_id==actor_id or event not in EVENTS:
        return
    db.execute('INSERT INTO staff_notices(id,user_id,event,subject,detail,path,created_at) VALUES(?,?,?,?,?,?,?)',
               (uid(),user_id,event,subject[:200],(detail or '')[:500],path[:200],now()))


def _mail(cfg, secret, recipient, subject, text):
    mail = EmailMessage()
    mail['Subject'],mail['From'],mail['To'] = subject,cfg['address'],recipient
    mail['Date'],mail['Message-ID'],mail['Auto-Submitted'] = formatdate(localtime=False,usegmt=True),make_msgid(),'auto-generated'
    mail.set_content(text)
    T.send_email(cfg,secret,recipient,mail)


def _body(name, organization, detail, link, event):
    return (f'สวัสดีคุณ{name}\n\n{EVENTS[event]} ใน {organization}\n\n{detail}\n\n'
            +(f'เปิดดู: {link}\n\n' if link else '')
            +'ปิดหรือเลือกเหตุการณ์ที่ต้องการรับอีเมลได้ที่ ตั้งค่าบัญชี → การแจ้งเตือน\n')


def send_notices(tenant_id):
    """Send the queued emails of one organization that their members asked for; returns how many went out. The
    others are closed unsent (email off, the event not chosen, or no platform email)."""
    from backend.modules.platform import service as platform
    with D.control() as cd, D.tenant(tenant_id) as db:
        D.begin(db)
        db.execute('DELETE FROM staff_notices WHERE created_at<?',(after(days=-NOTICE_KEEP_DAYS),))
        waiting = rows(db,'SELECT * FROM staff_notices WHERE sent_at IS NULL AND attempts<? ORDER BY created_at LIMIT 50',(NOTICE_ATTEMPTS,))
        ready = platform.registration_ready(cd)
        tasks = []
        for row in waiting:
            prefs = prefs_of(cd,row['user_id'])
            user = one(cd,'SELECT name,email FROM users WHERE id=?',(row['user_id'],))
            wanted = prefs['notify']['email'] and prefs['notify']['events'].get(row['event'])
            if ready and user and wanted:
                tasks.append((row,user))
            else:
                db.execute('UPDATE staff_notices SET sent_at=? WHERE id=?',(now(),row['id']))
        db.commit()
        if not tasks:
            return 0
        cfg,secret = platform.registration_config(cd),platform.registration_secret()
        organization = (one(cd,'SELECT name FROM tenants WHERE id=?',(tenant_id,)) or {}).get('name','')
        base = (cfg.get('public_base_url') or '').rstrip('/')
        sent = 0
        for row,user in tasks:
            try:
                _mail(cfg,secret,user['email'],f"{row['subject']} · {organization}",
                      _body(user['name'],organization,row['detail'] or row['subject'],base+row['path'] if base and row['path'] else '',row['event']))
            except ChannelError:
                db.execute('UPDATE staff_notices SET attempts=attempts+1 WHERE id=?',(row['id'],))
            else:
                db.execute('UPDATE staff_notices SET sent_at=? WHERE id=?',(now(),row['id']))
                sent += 1
            db.commit()
        return sent


def test_email(cd, session):
    """ตั้งค่าบัญชี → การแจ้งเตือน → ทดสอบอีเมล: one email to the member's own address, now."""
    from backend.modules.platform import service as platform
    require(platform.registration_ready(cd),'ระบบยังส่งอีเมลไม่ได้ ให้ผู้ดูแลแพลตฟอร์มตั้งค่าอีเมลกลางก่อน',503)
    try:
        _mail(platform.registration_config(cd),platform.registration_secret(),session['email'],'ทดสอบการแจ้งเตือนทางอีเมล',
              f"สวัสดีคุณ{session['name']}\n\nนี่คืออีเมลทดสอบจากตั้งค่าบัญชี → การแจ้งเตือน\n"
              'เมื่อเปิดการแจ้งเตือนทางอีเมล คุณจะได้รับอีเมลแบบนี้เมื่อมีเหตุการณ์ที่เลือกไว้\n')
    except ChannelError:
        require(False,'ส่งอีเมลทดสอบไม่สำเร็จ กรุณาลองใหม่ หรือให้ผู้ดูแลแพลตฟอร์มตรวจการตั้งค่าอีเมลกลาง',502)
    return {'ok':True,'email':session['email']}
