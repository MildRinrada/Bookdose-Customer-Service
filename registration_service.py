"""Platform registration mail. Pending applicants have no account or tenant access."""
import datetime as dt
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
import json
import os
import re
import secrets
import tempfile
from urllib.parse import urlsplit

import database as D
import channel_transport as T

LINK_SECONDS = 3600
PENDING_SECONDS = 86400
COOLDOWN_SECONDS = 60


class RegistrationError(Exception):
    def __init__(self, message, status=400):
        self.status = status
        super().__init__(message)


def check(condition, message, status=400):
    if not condition:
        raise RegistrationError(message, status)


def after(seconds):
    return (dt.datetime.now(dt.timezone.utc)+dt.timedelta(seconds=seconds)).isoformat(timespec='seconds')


def secret_path():
    return D.DATA/'secrets'/'registration-smtp.json'


def read_secret():
    try:
        return json.loads(secret_path().read_text())
    except (OSError, ValueError):
        return {}


def config(db):
    row = D.one(db,"SELECT value FROM platform_settings WHERE key='registration_mail'")
    return json.loads(row['value']) if row else {'enabled':False,'smtp_port':465}


def ready(db):
    return bool(config(db).get('enabled') and read_secret().get('password'))


def public_config(db):
    return {**config(db),'has_password':bool(read_secret().get('password'))}


def save_config(db, body):
    cfg = {'enabled':body.get('enabled') is True}
    for key in ('smtp_host','username','address','public_base_url'):
        value = body.get(key,'')
        check(isinstance(value,str) and len(value)<=500 and not any(ord(c)<32 for c in value), 'ข้อมูลการส่งอีเมลไม่ถูกต้อง')
        cfg[key] = value.strip()
    port = body.get('smtp_port',465)
    check(type(port) is int and port in (465,587), 'SMTP รองรับพอร์ต 465 หรือ 587')
    cfg['smtp_port'] = port
    password = body.get('password','')
    check(isinstance(password,str) and len(password)<=2000, 'รหัสผ่าน SMTP ไม่ถูกต้อง')
    old = config(db)
    old_secret = read_secret()
    if any(old.get(k)!=cfg.get(k) for k in ('smtp_host','smtp_port','username')):
        old_secret = {}
    secret = {'password':password} if password else old_secret
    if cfg['enabled']:
        check(re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?',cfg['smtp_host']), 'กรุณาระบุชื่อเซิร์ฟเวอร์ SMTP')
        check(cfg['username'] and secret.get('password'), 'กรุณาระบุชื่อผู้ใช้และรหัสผ่าน SMTP / App Password')
        check(re.fullmatch(r'[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+',cfg['address']), 'กรุณาระบุอีเมลผู้ส่งให้ถูกต้อง')
        try:
            url = urlsplit(cfg['public_base_url'])
            port = url.port
        except ValueError:
            raise RegistrationError('โดเมนเว็บไซต์ไม่ถูกต้อง') from None
        local = url.hostname in ('localhost','127.0.0.1')
        check(url.hostname and (url.scheme=='https' or (local and url.scheme=='http'))
              and not url.username and not url.password and not url.query and not url.fragment
              and url.path in ('','/') and not any(c in cfg['public_base_url'] for c in '\\<> "'),
              'ใช้โดเมน HTTPS โดยไม่มี path เช่น https://support.example.com (localhost ใช้ HTTP ได้)')
        cfg['public_base_url'] = cfg['public_base_url'].rstrip('/')
    folder = secret_path().parent
    folder.mkdir(parents=True,exist_ok=True,mode=0o700)
    # Atomic replacement; never place the credential in API responses or backups.
    fd, temporary = tempfile.mkstemp(dir=folder,prefix='.registration-')
    try:
        with os.fdopen(fd,'w') as output:
            json.dump(secret,output)
        os.replace(temporary,secret_path())
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    db.execute("INSERT INTO platform_settings VALUES('registration_mail',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(json.dumps(cfg),))


def purge(db):
    db.execute('DELETE FROM pending_registrations WHERE created_at<?',(after(-PENDING_SECONDS),))


def prepare(db, applicant=None, email=None):
    """Called inside a write transaction; returns a private mail task, never API data."""
    check(ready(db), 'ยังไม่เปิดรับสมัคร กรุณาให้ผู้ดูแลแพลตฟอร์มตั้งค่าอีเมลยืนยันก่อน',503)
    purge(db)
    email = applicant['email'] if applicant else email
    if D.one(db,'SELECT id FROM users WHERE email=?',(email,)):
        return None
    pending = D.one(db,'SELECT * FROM pending_registrations WHERE email=?',(email,))
    if pending and pending['last_sent_at']>after(-COOLDOWN_SECONDS):
        return None
    if applicant:
        # A repeat signup must not replace an unexpired applicant's password or organization.
        if pending and pending['expires_at']>D.now() and not D.one(db,'SELECT id FROM tenants WHERE slug=?',(pending['slug'],)):
            applicant = pending
        else:
            check(not D.one(db,'SELECT id FROM tenants WHERE slug=?',(applicant['slug'],)),
                  'รหัสองค์กรนี้ถูกใช้แล้ว กรุณาเลือกรหัสอื่น',409)
    elif pending:
        applicant = pending
        if D.one(db,'SELECT id FROM tenants WHERE slug=?',(pending['slug'],)):
            return None
    else:
        return None
    token = secrets.token_urlsafe(32)
    db.execute('''INSERT INTO pending_registrations VALUES(?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(email) DO UPDATE SET name=excluded.name,password=excluded.password,
                  organization=excluded.organization,slug=excluded.slug,token_hash=excluded.token_hash,
                  expires_at=excluded.expires_at,created_at=excluded.created_at,last_sent_at=excluded.last_sent_at''',
               (email,applicant['name'],applicant['password'],applicant['organization'],applicant['slug'],
                D.token_hash(token),after(LINK_SECONDS),applicant.get('created_at',D.now()),D.now()))
    return {'email':email,'token':token,'organization':applicant['organization'],
            'config':config(db),'secret':read_secret()}


def deliver(task):
    if task is None:
        return
    cfg = task['config']
    link = cfg['public_base_url']+'/#verify-email?token='+task['token']
    mail = EmailMessage()
    mail['Subject'] = 'ยืนยันอีเมลเพื่อเปิดใช้งาน Bookdose Customer Service'
    mail['From'] = cfg['address']
    mail['To'] = task['email']
    mail['Date'] = formatdate(localtime=False,usegmt=True)
    mail['Message-ID'] = make_msgid()
    mail['Auto-Submitted'] = 'auto-generated'
    mail.set_content(f"มีการสมัครองค์กร {task['organization']} ด้วยอีเมลนี้\n\n"
                     f"เปิดลิงก์แล้วกดยืนยันอีเมลเพื่อสร้างองค์กร:\n{link}\n\n"
                     "ลิงก์มีอายุ 1 ชั่วโมงและใช้ได้ครั้งเดียว ลิงก์ใหม่จะยกเลิกลิงก์เดิม\n"
                     "หากคุณไม่ได้สมัคร กรุณาไม่กดยืนยันและลบอีเมลนี้\n")
    try:
        T.send_email(cfg,task['secret'],task['email'],mail)
    except T.ChannelError:
        # Do not retry an uncertain SMTP delivery. The applicant can explicitly request another link.
        raise RegistrationError('ยังยืนยันผลการส่งอีเมลไม่ได้ กรุณาตรวจกล่องจดหมายและสแปม หากไม่พบให้รอ 1 นาทีแล้วขอลิงก์ใหม่ หรือติดต่อผู้ดูแล',503) from None


def verify(db, token):
    check(isinstance(token,str) and re.fullmatch(r'[A-Za-z0-9_-]{43}',token), 'ลิงก์ยืนยันไม่ถูกต้องหรือหมดอายุ กรุณาขอลิงก์ใหม่')
    purge(db)
    pending = D.one(db,'SELECT * FROM pending_registrations WHERE token_hash=?',(D.token_hash(token),))
    check(pending and pending['expires_at']>D.now(), 'ลิงก์ยืนยันไม่ถูกต้อง หมดอายุ หรือใช้ไปแล้ว กรุณาขอลิงก์ใหม่')
    check(not D.one(db,'SELECT id FROM tenants WHERE slug=?',(pending['slug'],)),
          'รหัสองค์กรนี้ถูกใช้แล้ว กรุณาสมัครใหม่ด้วยรหัสองค์กรอื่น',409)
    check(not D.one(db,'SELECT id FROM users WHERE email=?',(pending['email'],)), 'อีเมลนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบ',409)
    user_id = D.uid()
    db.execute('INSERT INTO users VALUES(?,?,?,?,?,?)',(user_id,pending['name'],pending['email'],pending['password'],0,D.now()))
    tenant_id = D.create_tenant(db,pending['organization'],pending['slug'],user_id,False)
    db.execute('INSERT INTO email_verifications VALUES(?,?)',(user_id,D.now()))
    db.execute('DELETE FROM pending_registrations WHERE email=?',(pending['email'],))
    D.audit(db,user_id,'tenant.register',tenant_id)
    D.audit(db,user_id,'auth.email_verified',user_id)
    return user_id
