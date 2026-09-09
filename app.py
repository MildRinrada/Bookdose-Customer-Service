#!/usr/bin/env python3
"""Bookdose Customer Service. Python 3.10+; no third-party runtime dependencies."""
import argparse
import base64
from collections import defaultdict, deque
import csv
from contextlib import closing
import datetime as dt
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import sqlite3
import sys
import tempfile
import threading
import time
from urllib.parse import parse_qs, quote, unquote, urlsplit
import zipfile

import database as D
import ai_service as AI
import channel_service as CS
import channel_transport as CT
import email_oauth as EO
import channel_files as CF

ROOT = Path(__file__).resolve().parent
STATUSES = ('new','open','pending_customer','pending_internal','resolved','closed')
PRIORITIES = ('low','normal','high','urgent')
RATE_LOCK = threading.Lock()
RATES = defaultdict(deque)
SETUP_LOCK = threading.Lock()


class APIError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def require(condition, message, status=400):
    if not condition:
        raise APIError(status, message)


def field(body, name, maximum=500, required=True):
    value = body.get(name, '')
    require(isinstance(value, str), f'ข้อมูล {name} ไม่ถูกต้อง')
    value = value.strip()
    require((not required or value) and len(value) <= maximum, f'กรุณาระบุ {name} (ไม่เกิน {maximum} ตัวอักษร)')
    return value


def email_field(body):
    email = field(body,'email',254).lower()
    require(re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email), 'กรุณาระบุอีเมลให้ถูกต้อง')
    return email


def new_password(body):
    value = body.get('password','')
    require(isinstance(value,str) and 10 <= len(value) <= 200, 'รหัสผ่านต้องมี 10–200 ตัวอักษร')
    return D.password_hash(value)


def existing_password(body, name='password'):
    value = body.get(name,'')
    require(isinstance(value,str) and 1<=len(value)<=200,'กรุณาระบุรหัสผ่าน')
    return value


def limited(key, count, period=60):
    with RATE_LOCK:
        current = time.monotonic()
        if len(RATES) > 10000:
            for old_key in list(RATES):
                if not RATES[old_key] or current-RATES[old_key][-1] > 900:
                    del RATES[old_key]
        bucket = RATES[key]
        while bucket and current-bucket[0] > period:
            bucket.popleft()
        require(len(bucket) < count, 'ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',429)
        bucket.append(current)


def team_scope(context, alias=''):
    prefix = f'{alias}.' if alias else ''
    return (f'{prefix}team_id=?',[context['team_id']]) if context['role']=='agent' else ('1=1',[])


def get_scoped(db, table, entity_id, context):
    assert table in ('tickets','conversations')
    scope, params = team_scope(context)
    entity = D.one(db,f'SELECT * FROM {table} WHERE id=? AND {scope}',[entity_id]+params)
    require(entity is not None,'ไม่พบข้อมูลหรือคุณไม่มีสิทธิ์เข้าถึง',404)
    return entity


def members(control_db, tenant_id):
    return D.rows(control_db,'''SELECT u.id,u.name,u.email,m.role,m.team_id,m.active FROM memberships m
                    JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? ORDER BY u.name''',(tenant_id,))


def contact_visible(db, contact_id, ctx):
    if ctx['role']!='agent':
        return D.one(db,'SELECT * FROM contacts WHERE id=?',(contact_id,))
    return D.one(db,'''SELECT * FROM contacts WHERE id=? AND (created_by=? OR id IN
        (SELECT contact_id FROM conversations WHERE team_id=?) OR id IN
        (SELECT contact_id FROM tickets WHERE team_id=?))''',(contact_id,ctx['id'],ctx['team_id'],ctx['team_id']))


def message_list(db, conversation_id, public=False):
    extra = " AND kind!='note'" if public else ''
    result = D.rows(db,'SELECT id,author_name,kind,body,delivery,created_at FROM messages WHERE conversation_id=?'+extra+' ORDER BY created_at,rowid',(conversation_id,))
    for message in result:
        message['attachments'] = D.rows(db,'SELECT id,name,mime,size FROM attachments WHERE message_id=?',(message['id'],))
        meta = D.one(db,'SELECT source,citations FROM ai_message_meta WHERE message_id=?',(message['id'],))
        message['channel_delivery'] = CS.delivery(db,message['id']) if not public else None
        message['source'] = meta['source'] if meta else 'human'
        message['citations'] = json.loads(meta['citations']) if meta else []
    return result


def store_message(db, tenant_id, conversation_id, author_id, author_name, kind, body):
    text = field(body,'body',20000,False)
    files = body.get('attachments',[])
    require(isinstance(files,list) and len(files)<=3,'แนบไฟล์ได้สูงสุด 3 ไฟล์')
    require(text or files,'กรุณาพิมพ์ข้อความหรือแนบไฟล์')
    validated = []
    total = 0
    for item in files:
        require(isinstance(item,dict),'ไฟล์แนบไม่ถูกต้อง')
        name = field(item,'name',150)
        require('/' not in name and '\\' not in name and not any(ord(c)<32 for c in name),'ชื่อไฟล์ไม่ถูกต้อง')
        encoded = item.get('data','')
        require(isinstance(encoded,str),'ไฟล์แนบไม่ถูกต้อง')
        try:
            content = base64.b64decode(encoded,validate=True)
        except (ValueError,TypeError):
            raise APIError(400,'ไฟล์แนบไม่ถูกต้อง')
        total += len(content)
        require(0 < len(content) and total<=5*1024*1024,'ขนาดไฟล์รวมต้องไม่เกิน 5 MB')
        ext = Path(name).suffix.lower()
        mime = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.pdf':'application/pdf','.txt':'text/plain'}.get(ext)
        require(mime,'รองรับเฉพาะ PNG, JPG, PDF และ TXT')
        valid = ((ext=='.png' and content.startswith(b'\x89PNG\r\n\x1a\n')) or
                 (ext in ('.jpg','.jpeg') and content.startswith(b'\xff\xd8\xff')) or
                 (ext=='.pdf' and content.startswith(b'%PDF-')))
        if ext=='.txt':
            try:
                content.decode('utf-8')
                valid = b'\x00' not in content
            except UnicodeDecodeError:
                valid = False
        require(valid,'เนื้อหาไฟล์ไม่ตรงกับชนิดไฟล์ที่รองรับ')
        validated.append((name,mime,content))
    mid = D.uid()
    db.execute('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)',(mid,conversation_id,author_id,author_name,kind,text,'stored',D.now()))
    for name,mime,content in validated:
        file_id = D.uid()
        folder = D.DATA/'files'/tenant_id
        folder.mkdir(exist_ok=True,mode=0o700)
        path = folder/file_id
        with path.open('xb') as out:
            out.write(content)
        path.chmod(0o600)
        db.execute('INSERT INTO attachments VALUES(?,?,?,?,?,?)',(file_id,mid,name,mime,len(content),file_id))
    db.execute('UPDATE conversations SET updated_at=? WHERE id=?',(D.now(),conversation_id))
    if kind=='reply' and D.one(db,'SELECT channel FROM conversations WHERE id=?',(conversation_id,))['channel'] not in ('line','email'):
        db.execute('''UPDATE tickets SET first_response_at=COALESCE(first_response_at,?),updated_at=?
           WHERE id IN (SELECT ticket_id FROM ticket_conversations WHERE conversation_id=?)''',(D.now(),D.now(),conversation_id))
    if kind=='customer':
        db.execute("UPDATE conversations SET status='open' WHERE id=?",(conversation_id,))
        db.execute('''UPDATE tickets SET status='open',resolved_at=NULL,updated_at=?
            WHERE id IN (SELECT ticket_id FROM ticket_conversations WHERE conversation_id=?)
            AND status IN ('pending_customer','resolved','closed')''',(D.now(),conversation_id))
    return mid


def make_backup(tenant_id=None):
    buffer = io.BytesIO()
    paths = [D.tenant_path(tenant_id)] if tenant_id else [D.DATA/'control.sqlite3',*sorted((D.DATA/'tenants').glob('*.sqlite3'))]
    with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as archive:
        with tempfile.TemporaryDirectory(prefix='bookdose-backup-') as temporary:
            for index,path in enumerate(paths):
                target = Path(temporary)/f'{index}.sqlite3'
                with D.connect(path) as source:
                    with closing(sqlite3.connect(target)) as destination:
                        source.backup(destination)
                archive.write(target,str(path.relative_to(D.DATA)))
                # Use attachment references from the snapshot so later new uploads are not mixed in.
                if path.name!='control.sqlite3':
                    with closing(sqlite3.connect(target)) as snapshot:
                        keys = [r[0] for r in snapshot.execute('SELECT storage_key FROM attachments')]
                    for key in keys:
                        file = D.DATA/'files'/path.stem/key
                        if not file.is_file():
                            raise RuntimeError('A referenced attachment is missing; backup aborted')
                        archive.write(file,str(file.relative_to(D.DATA)))
        archive.writestr('manifest.json',json.dumps({'app':'Bookdose Customer Service','version':1,'created_at':D.now(),
                            'scope':'tenant' if tenant_id else 'platform','tenant_id':tenant_id},ensure_ascii=False))
    return buffer.getvalue()


class Handler(BaseHTTPRequestHandler):
    server_version = 'Bookdose/1.0'

    def log_message(self, fmt, *args):
        # Omit request paths, which can contain user-entered search terms.
        if args and isinstance(args[0], str) and args[0].startswith(('GET ','POST ','PATCH ','DELETE ')):
            print(f'[{D.now()}] {self.command} {args[1] if len(args)>1 else ""}',flush=True)

    def send(self, status, data, content_type='application/json; charset=utf-8', headers=None):
        if content_type.startswith('application/json'):
            data = json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type',content_type)
        self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('X-Frame-Options','DENY')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        for key,value in (headers or {}).items():
            self.send_header(key,value)
        self.end_headers()
        self.wfile.write(data)

    def json_body(self):
        require(self.headers.get('Content-Type','').split(';')[0]=='application/json','ต้องส่งข้อมูลแบบ JSON',415)
        try:
            length = int(self.headers.get('Content-Length','0'))
        except ValueError:
            raise APIError(400,'ข้อมูลไม่ถูกต้อง')
        require(0<length<=8*1024*1024,'ขนาดข้อมูลมากเกินไป',413)
        try:
            body = json.loads(self.rfile.read(length))
        except (ValueError,UnicodeDecodeError):
            raise APIError(400,'ข้อมูล JSON ไม่ถูกต้อง')
        require(isinstance(body,dict),'ข้อมูลต้องเป็น JSON object')
        return body

    def session(self, db, optional=False):
        jar = cookies.SimpleCookie()
        try:
            jar.load(self.headers.get('Cookie',''))
        except cookies.CookieError:
            pass
        token = jar.get('bookdose_session')
        token = D.token_hash(token.value) if token else ''
        session = D.one(db,'''SELECT s.*,u.name,u.email,u.platform_admin FROM sessions s
                   JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?''',(token,D.now()))
        if not optional:
            require(session,'กรุณาเข้าสู่ระบบ',401)
        return session

    def new_session(self, db, user_id):
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
        membership = D.one(db,"SELECT m.tenant_id FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=? AND m.active=1 AND t.status='active' ORDER BY t.created_at LIMIT 1",(user_id,))
        expires = (dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=12)).isoformat(timespec='seconds')
        db.execute('DELETE FROM sessions WHERE expires_at<?',(D.now(),))
        db.execute('INSERT INTO sessions VALUES(?,?,?,?,?)',(D.token_hash(token),user_id,membership['tenant_id'] if membership else None,csrf,expires))
        return {'Set-Cookie':f'bookdose_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200'+ ('; Secure' if self.server.secure_cookies else '')}

    def context(self, db, session):
        ctx = D.one(db,'''SELECT m.*,t.name AS tenant_name,t.slug FROM memberships m JOIN tenants t ON t.id=m.tenant_id
                      WHERE m.user_id=? AND m.tenant_id=? AND m.active=1 AND t.status='active' ''',(session['user_id'],session['tenant_id']))
        require(ctx,'ไม่มีสิทธิ์เข้าองค์กรนี้ หรือองค์กรถูกระงับ',403)
        ctx.update(id=session['user_id'],name=session['name'],session_token=session['token'])
        return ctx

    def do_GET(self):
        self.handle_request()

    def do_POST(self):
        self.handle_request()

    def do_PATCH(self):
        self.handle_request()

    def handle_request(self):
        try:
            self.connection.settimeout(30)
            parsed = urlsplit(self.path)
            path = unquote(parsed.path)
            self.query = parse_qs(parsed.query)
            host = self.headers.get('Host','')
            require(host and not any(c in host for c in '/\\@'),'Host ไม่ถูกต้อง',400)
            if self.server.server_address[0] in ('127.0.0.1','localhost'):
                require(host.split(':')[0] in ('localhost','127.0.0.1'),'Host ไม่ได้รับอนุญาต',403)
            if self.command!='GET':
                origin = self.headers.get('Origin')
                require(not origin or origin in ('http://'+host,'https://'+host),'ไม่อนุญาตคำขอจากเว็บไซต์อื่น',403)
            if path==EO.CALLBACK and self.command=='GET':
                return self.send(200,(ROOT/'static'/'oauth-callback.html').read_bytes(),'text/html; charset=utf-8')
            file_link=re.fullmatch(r'/api/channel-files/([a-f0-9]{32})/([A-Za-z0-9_-]{43})',path)
            if file_link and self.command=='GET':
                with D.control() as cd:file=CF.resolve(cd,file_link[1],file_link[2])
                require(file,'ลิงก์ไฟล์ไม่ถูกต้อง หมดอายุ หรือถูกถอนแล้ว',404)
                return self.send_attachment(file_link[1],file)
            if not path.startswith('/api/'):
                require(self.command=='GET','ไม่พบหน้านี้',404)
                file = ROOT/'static'/('index.html' if path=='/' or path.startswith('/support/') else path.lstrip('/'))
                require(file.resolve().is_relative_to(ROOT/'static') and file.is_file(),'ไม่พบหน้านี้',404)
                mime = mimetypes.guess_type(file.name)[0] or 'application/octet-stream'
                return self.send(200,file.read_bytes(),mime+'; charset=utf-8')
            webhook = re.fullmatch(r'/api/webhooks/line/([a-f0-9]{32})',path)
            if webhook and self.command=='POST':
                length=self.headers.get('Content-Length','')
                require(length.isdigit() and 0<int(length)<=2*1024*1024,'ขนาด Webhook ไม่ถูกต้อง',413)
                raw=self.rfile.read(int(length))
                require(len(raw)==int(length),'Webhook ไม่ครบ',400)
                with D.control() as cd:
                    try:CS.accept_line(cd,webhook[1],raw,self.headers.get('X-Line-Signature',''))
                    except PermissionError:raise APIError(403,'ลายเซ็น Webhook ไม่ถูกต้อง') from None
                return self.send(200,{'ok':True})
            body = self.json_body() if self.command!='GET' else {}
            if path.startswith('/api/public/'):
                return self.public_route(path,body)
            if path in ('/api/setup','/api/login') and self.command=='POST':
                return self.auth_route(path,body)
            with D.control() as cd:
                session = self.session(cd,optional=path=='/api/bootstrap')
                if path=='/api/bootstrap' and self.command=='GET':
                    return self.send(200,{'setup_required':cd.execute('SELECT COUNT(*) FROM users').fetchone()[0]==0,
                         'user':{'id':session['user_id'],'name':session['name'],'email':session['email'],'platform_admin':bool(session['platform_admin'])} if session else None,
                         'csrf':session['csrf'] if session else None,'tenant_id':session['tenant_id'] if session else None,
                         'memberships':D.rows(cd,'''SELECT t.id,t.name,t.slug,t.status,m.role FROM memberships m JOIN tenants t ON t.id=m.tenant_id
                             WHERE m.user_id=? AND m.active=1 ORDER BY t.name''',(session['user_id'],)) if session else []})
                if self.command!='GET':
                    require(secrets.compare_digest(self.headers.get('X-CSRF-Token',''),session['csrf']),'เซสชันไม่ถูกต้อง กรุณารีเฟรชหน้า',403)
                if path=='/api/logout' and self.command=='POST':
                    cd.execute('DELETE FROM sessions WHERE token=?',(session['token'],))
                    cd.commit()
                    return self.send(200,{'ok':True},headers={'Set-Cookie':'bookdose_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'})
                if path=='/api/session/tenant' and self.command=='POST':
                    tid = field(body,'tenant_id',32)
                    require(D.one(cd,"SELECT 1 FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE tenant_id=? AND user_id=? AND active=1 AND t.status='active'",(tid,session['user_id'])),'ไม่มีสิทธิ์เข้าองค์กรนี้',403)
                    cd.execute('UPDATE sessions SET tenant_id=? WHERE token=?',(tid,session['token']))
                    cd.commit()
                    return self.send(200,{'ok':True})
                if path=='/api/account/password' and self.command=='POST':
                    encoded = new_password(body)
                    account = D.one(cd,'SELECT password FROM users WHERE id=?',(session['user_id'],))
                    require(D.password_ok(existing_password(body,'current_password'),account['password']),'รหัสผ่านเดิมไม่ถูกต้อง',403)
                    cd.execute('UPDATE users SET password=? WHERE id=?',(encoded,session['user_id']))
                    cd.execute('DELETE FROM sessions WHERE user_id=?',(session['user_id'],))
                    headers = self.new_session(cd,session['user_id'])
                    cd.commit()
                    return self.send(200,{'ok':True},headers=headers)
                if path.startswith('/api/platform'):
                    require(session['platform_admin'],'เฉพาะผู้ดูแลแพลตฟอร์ม',403)
                    return self.platform_route(cd,session,path,body)
                ctx = self.context(cd,session)
                # A tab must declare its selected tenant, preventing writes after another tab switches the session.
                require(self.headers.get('X-Tenant-ID')==ctx['tenant_id'],'องค์กรที่เลือกเปลี่ยนไป กรุณารีเฟรชหน้า',409)
                with D.tenant(ctx['tenant_id']) as td:
                    return self.workspace_route(cd,td,ctx,path,body)
        except APIError as error:
            self.send(error.status,{'error':error.message})
        except AI.AIError as error:
            self.send(429 if error.code=='quota' else 400,{'error':str(error)})
        except CS.ConfigError as error:
            self.send(400,{'error':str(error)})
        except CT.ChannelError as error:
            self.send(503 if error.code=='disabled' or error.retryable else 400,{'error':str(error)})
        except sqlite3.IntegrityError:
            self.send(409,{'error':'ข้อมูลซ้ำหรือรายการที่อ้างอิงไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง'})
        except (BrokenPipeError,ConnectionResetError,TimeoutError):
            pass
        except Exception as error:
            print(f'[{D.now()}] Server error: {type(error).__name__}',file=sys.stderr,flush=True)
            self.send(500,{'error':'ระบบไม่สามารถทำรายการได้ กรุณาลองใหม่'})

    def auth_route(self,path,body):
        limited(('login',self.client_address[0]),15,900)
        with SETUP_LOCK, D.control() as db:
            if path=='/api/setup':
                require(db.execute('SELECT COUNT(*) FROM users').fetchone()[0]==0,'ระบบตั้งค่าเรียบร้อยแล้ว',409)
                name, email, password = field(body,'name',100),email_field(body),new_password(body)
                org, slug = field(body,'organization',100),field(body,'slug',60)
                require(re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*',slug),'รหัสองค์กรใช้ a-z, 0-9 และขีดกลาง')
                user_id = D.uid()
                db.execute('INSERT INTO users VALUES(?,?,?,?,?,?)',(user_id,name,email,password,1,D.now()))
                D.create_tenant(db,org,slug,user_id,body.get('demo') is True)
            else:
                email = email_field(body)
                password = existing_password(body)
                user = D.one(db,'SELECT * FROM users WHERE email=?',(email,))
                # Do equivalent work for nonexistent accounts to reduce account enumeration by timing.
                encoded = user['password'] if user else 'pbkdf2_sha256$600000$'+'00'*16+'$'+'00'*32
                require(D.password_ok(password,encoded) and user,'อีเมลหรือรหัสผ่านไม่ถูกต้อง',401)
                user_id = user['id']
            old = self.session(db,True)
            if old:
                db.execute('DELETE FROM sessions WHERE token=?',(old['token'],))
            headers = self.new_session(db,user_id)
            D.audit(db,user_id,'auth.login',user_id)
            db.commit()
            return self.send(200,{'ok':True},headers=headers)

    def platform_route(self,cd,session,path,body):
        if path=='/api/platform/tenants':
            if self.command=='GET':
                return self.send(200,{'tenants':D.rows(cd,'''SELECT t.*,(SELECT COUNT(*) FROM memberships m WHERE m.tenant_id=t.id AND m.active=1) AS member_count FROM tenants t ORDER BY t.created_at'''),
                                      'audit':D.rows(cd,'SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100')})
            if self.command=='POST':
                name,slug = field(body,'name',100),field(body,'slug',60)
                require(re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*',slug),'รหัสองค์กรใช้ a-z, 0-9 และขีดกลาง')
                require(not D.one(cd,'SELECT id FROM tenants WHERE slug=?',(slug,)),'รหัสองค์กรนี้มีอยู่แล้ว',409)
                email = email_field(body)
                user = D.one(cd,'SELECT id FROM users WHERE email=?',(email,))
                if user:
                    admin_id = user['id']
                else:
                    admin_id = D.uid()
                    cd.execute('INSERT INTO users VALUES(?,?,?,?,?,?)',(admin_id,field(body,'admin_name',100),email,new_password(body),0,D.now()))
                tid = D.create_tenant(cd,name,slug,admin_id,False)
                cd.commit()
                return self.send(201,{'id':tid})
        match = re.fullmatch(r'/api/platform/tenants/([a-f0-9]{32})',path)
        if match and self.command=='PATCH':
            status = body.get('status')
            require(status in ('active','suspended'),'สถานะไม่ถูกต้อง')
            require(D.one(cd,'SELECT id FROM tenants WHERE id=?',(match[1],)),'ไม่พบองค์กร',404)
            cd.execute('UPDATE tenants SET status=? WHERE id=?',(status,match[1]))
            D.audit(cd,session['name'],'tenant.'+status,match[1])
            cd.commit()
            return self.send(200,{'ok':True})
        raise APIError(404,'ไม่พบรายการ')

    def workspace_route(self,cd,db,ctx,path,body):
        method = self.command
        scope,params = team_scope(ctx,'t')
        if path in ('/api/channels/email/oauth/start','/api/channels/email/oauth/complete') and method=='POST':
            require(ctx['role']=='admin','เฉพาะผู้ดูแลองค์กร',403)
            limited(('email-oauth',ctx['tenant_id'],ctx['id']),10,60)
            if path.endswith('/start'):
                db.execute('BEGIN IMMEDIATE')
                return self.send(200,EO.start(db,ctx,'https://'+self.headers.get('Host','')))
            return self.send(200,EO.complete(cd,db,ctx,body))
        revoke=re.fullmatch(r'/api/messages/([a-f0-9]{32})/revoke-files',path)
        if revoke and method=='POST':
            db.execute('BEGIN IMMEDIATE')
            message=D.one(db,'SELECT conversation_id FROM messages WHERE id=?',(revoke[1],))
            require(message,'ไม่พบข้อความ',404)
            get_scoped(db,'conversations',message['conversation_id'],ctx)
            CF.revoke(db,revoke[1]);D.audit(db,ctx['name'],'message.files_revoked',message['conversation_id']);db.commit()
            return self.send(200,{'ok':True})
        if path=='/api/channels' and method=='GET':
            require(ctx['role']=='admin','เฉพาะผู้ดูแลองค์กร',403)
            return self.send(200,CS.overview(db,ctx['tenant_id']))
        channel=re.fullmatch(r'/api/channels/(line|email)(?:/(test|sync))?',path)
        if channel:
            require(ctx['role']=='admin','เฉพาะผู้ดูแลองค์กร',403)
            limited(('channel-config',ctx['tenant_id']),20,60)
            if method=='PATCH' and not channel[2]:
                return self.send(200,CS.save_channel(cd,db,ctx,channel[1],body))
            if method=='POST' and channel[2]=='test':
                CS.test_channel(db,ctx['tenant_id'],channel[1])
                return self.send(200,{'ok':True})
            if method=='POST' and channel[1]=='email' and channel[2]=='sync':
                db.execute("UPDATE channel_settings SET next_poll=NULL WHERE kind='email'")
                db.commit()
                return self.send(200,{'ok':True})
        retry=re.fullmatch(r'/api/messages/([a-f0-9]{32})/retry',path)
        if retry and method=='POST':
            db.execute('BEGIN IMMEDIATE')
            message=D.one(db,'SELECT conversation_id FROM messages WHERE id=?',(retry[1],))
            require(message,'ไม่พบข้อความ',404)
            get_scoped(db,'conversations',message['conversation_id'],ctx)
            CS.retry_message(db,ctx,retry[1]);db.commit()
            return self.send(200,{'ok':True})
        if path.startswith('/api/ai/'):
            return self.ai_route(cd,db,ctx,path,body)
        if path=='/api/workspace' and method=='GET':
            team_members = members(cd,ctx['tenant_id'])
            if ctx['role']=='agent':
                team_members = [m for m in team_members if m['team_id']==ctx['team_id'] and m['active']]
            return self.send(200,{'tenant':{'id':ctx['tenant_id'],'name':ctx['tenant_name'],'slug':ctx['slug']},
                 'role':ctx['role'],'team_id':ctx['team_id'],'members':team_members,
                 'teams':D.rows(db,'SELECT * FROM teams ORDER BY name'),
                 'settings':dict(db.execute('SELECT key,value FROM settings').fetchall()),
                 'channels':{kind:{'chatbot_enabled':bool((CS.setting(db,kind) or {}).get('config',{}).get('chatbot_enabled')),'enabled':bool((CS.setting(db,kind) or {}).get('enabled'))} for kind in ('line','email')},
                 'ai':{**AI.config(db),'key_configured':bool(AI.read_key(ctx['tenant_id']))}})
        if path=='/api/tickets' and method=='GET':
            result = D.rows(db,f'''SELECT t.*,c.name AS contact_name,c.company FROM tickets t
                      JOIN contacts c ON c.id=t.contact_id WHERE {scope} ORDER BY t.updated_at DESC,t.number DESC''',params)
            return self.send(200,{'tickets':result})
        if path=='/api/tickets' and method=='POST':
            db.execute('BEGIN IMMEDIATE')
            subject = field(body,'subject',300)
            contact_id = field(body,'contact_id',32)
            require(contact_visible(db,contact_id,ctx),'ไม่พบลูกค้า',404)
            team_id = body.get('team_id') or ctx['team_id']
            self.validate_team(db,ctx,team_id)
            assignee = body.get('assignee_id') or None
            self.validate_assignee(cd,ctx,assignee,team_id)
            priority = body.get('priority','normal')
            require(priority in PRIORITIES,'ความเร่งด่วนไม่ถูกต้อง')
            conv_id = D.uid()
            db.execute('INSERT INTO conversations VALUES(?,?,?,?,?,?,?,?,?)',(conv_id,contact_id,subject,'manual',team_id,'open',None,D.now(),D.now()))
            tid = D.create_ticket(db,contact_id,team_id,subject,priority,assignee,field(body,'category',80,False) or 'ทั่วไป',conv_id)
            if body.get('body'):
                store_message(db,ctx['tenant_id'],conv_id,ctx['id'],ctx['name'],'note',body)
            D.audit(db,ctx['name'],'ticket.created',tid,subject)
            db.commit()
            return self.send(201,{'id':tid})
        match = re.fullmatch(r'/api/tickets/([a-f0-9]{32})',path)
        if match:
            ticket = get_scoped(db,'tickets',match[1],ctx)
            if method=='GET':
                convs = D.rows(db,'SELECT c.* FROM conversations c JOIN ticket_conversations tc ON tc.conversation_id=c.id WHERE tc.ticket_id=?',(ticket['id'],))
                for conv in convs:
                    conv['messages'] = message_list(db,conv['id'])
                    conv['ai'] = AI.conversation_state(db,conv['id'])
                    conv['line'] = D.one(db,'SELECT source_type,active FROM line_threads WHERE conversation_id=?',(conv['id'],))
                    conv.pop('portal_token',None)
                return self.send(200,{'ticket':ticket,'contact':D.one(db,'SELECT * FROM contacts WHERE id=?',(ticket['contact_id'],)),
                         'conversations':convs,'events':D.rows(db,'SELECT * FROM audit_logs WHERE entity=? ORDER BY id DESC LIMIT 40',(ticket['id'],))})
            if method=='PATCH':
                status = body.get('status',ticket['status'])
                priority = body.get('priority',ticket['priority'])
                team_id = body.get('team_id',ticket['team_id'])
                assignee = body.get('assignee_id',ticket['assignee_id']) or None
                require(status in STATUSES and priority in PRIORITIES,'สถานะหรือความเร่งด่วนไม่ถูกต้อง')
                self.validate_team(db,ctx,team_id)
                self.validate_assignee(cd,ctx,assignee,team_id)
                resolved_at = (ticket['resolved_at'] or D.now()) if status in ('resolved','closed') else None
                db.execute('UPDATE tickets SET status=?,priority=?,team_id=?,assignee_id=?,resolved_at=?,updated_at=? WHERE id=?',
                    (status,priority,team_id,assignee,resolved_at,D.now(),ticket['id']))
                db.execute('UPDATE conversations SET team_id=? WHERE id IN (SELECT conversation_id FROM ticket_conversations WHERE ticket_id=?)',(team_id,ticket['id']))
                changes = {key:{'before':ticket[key],'after':value} for key,value in [('status',status),('priority',priority),('team_id',team_id),('assignee_id',assignee)] if ticket[key]!=value}
                D.audit(db,ctx['name'],'ticket.updated',ticket['id'],json.dumps(changes,ensure_ascii=False))
                db.commit()
                return self.send(200,{'ok':True})
        if path=='/api/conversations' and method=='GET':
            conv_scope,conv_params = team_scope(ctx,'c')
            return self.send(200,{'conversations':D.rows(db,f'''SELECT c.id,c.contact_id,c.subject,c.channel,c.team_id,c.status,c.created_at,c.updated_at,
                p.name AS contact_name,p.company,tc.ticket_id,t.number AS ticket_number,
                (SELECT body FROM messages m WHERE m.conversation_id=c.id ORDER BY created_at DESC,rowid DESC LIMIT 1) AS preview,
                (SELECT kind FROM messages m WHERE m.conversation_id=c.id ORDER BY created_at DESC,rowid DESC LIMIT 1) AS last_kind
                FROM conversations c JOIN contacts p ON p.id=c.contact_id LEFT JOIN ticket_conversations tc ON tc.conversation_id=c.id
                LEFT JOIN tickets t ON t.id=tc.ticket_id WHERE {conv_scope} ORDER BY c.updated_at DESC''',conv_params)})
        match = re.fullmatch(r'/api/conversations/([a-f0-9]{32})(?:/(messages|ticket|ai-draft|ai-mode))?',path)
        if match:
            conv = get_scoped(db,'conversations',match[1],ctx)
            if method=='GET' and not match[2]:
                conv.pop('portal_token',None)
                conv['ai'] = AI.conversation_state(db,conv['id'])
                conv['line'] = D.one(db,'SELECT source_type,active FROM line_threads WHERE conversation_id=?',(conv['id'],))
                return self.send(200,{'conversation':conv,'messages':message_list(db,conv['id']),
                         'contact':D.one(db,'SELECT * FROM contacts WHERE id=?',(conv['contact_id'],)),
                         'ticket':D.one(db,'SELECT t.* FROM tickets t JOIN ticket_conversations tc ON tc.ticket_id=t.id WHERE tc.conversation_id=?',(conv['id'],))})
            if method=='PATCH' and not match[2]:
                require(body.get('status') in ('open','closed'),'สถานะไม่ถูกต้อง')
                db.execute('UPDATE conversations SET status=?,updated_at=? WHERE id=?',(body['status'],D.now(),conv['id']))
                if body['status']=='closed':
                    AI.stop_bot(db,conv['id'])
                D.audit(db,ctx['name'],'conversation.'+body['status'],conv['id'])
                db.commit()
                return self.send(200,{'ok':True})
            if method=='POST' and match[2]=='messages':
                kind = body.get('kind','reply')
                require(kind in ('reply','note'),'ชนิดข้อความไม่ถูกต้อง')
                require(kind=='note' or conv['channel'] in ('web','line','email'),'เคสที่บันทึกเองรองรับบันทึกภายใน กรุณารับเรื่องผ่านหน้าช่วยเหลือเพื่อสนทนากับลูกค้า')
                db.execute('BEGIN IMMEDIATE')
                if kind=='reply' and conv['channel'] in ('line','email'):
                    CS.check_reply(db,ctx['tenant_id'],conv,body)
                mid = store_message(db,ctx['tenant_id'],conv['id'],ctx['id'],ctx['name'],kind,body)
                if kind=='reply' and conv['channel'] in ('line','email'):
                    CS.enqueue_reply(db,ctx,conv,mid)
                if kind=='reply':
                    AI.stop_bot(db,conv['id'])
                D.audit(db,ctx['name'],'message.'+kind,conv['id'])
                db.commit()
                return self.send(201,{'id':mid})
            if method=='POST' and match[2]=='ai-draft':
                limited(('ai-draft',ctx['tenant_id'],ctx['id']),10,60)
                db.execute('BEGIN IMMEDIATE')
                job_id = AI.enqueue(db,ctx['tenant_id'],'draft',conv['id'],ctx['id'])
                AI.stop_bot(db,conv['id'])
                db.commit()
                return self.send(201,{'id':job_id,'status':'pending'})
            if method=='POST' and match[2]=='ai-mode':
                mode = body.get('mode')
                require(mode in ('human','bot'),'โหมดไม่ถูกต้อง')
                db.execute('BEGIN IMMEDIATE')
                if mode=='human':
                    AI.handoff(db,conv['id'],'staff')
                else:
                    require(conv['channel'] in ('web','line','email') and conv['status']=='open','เปิด AI ได้เฉพาะบทสนทนาที่เปิดอยู่')
                    require(AI.bot_enabled(db,conv['id']) and AI.read_key(ctx['tenant_id']),'กรุณาเปิด Chatbot สำหรับช่องทางนี้และตั้งค่า API Key ก่อน')
                    db.execute("INSERT INTO ai_conversations VALUES(?,'bot','',?) ON CONFLICT(conversation_id) DO UPDATE SET mode='bot',reason='',updated_at=excluded.updated_at",(conv['id'],D.now()))
                    D.audit(db,ctx['name'],'ai.resumed',conv['id'])
                db.commit()
                return self.send(200,{'ok':True})
            if method=='POST' and match[2]=='ticket':
                db.execute('BEGIN IMMEDIATE')
                require(not D.one(db,'SELECT 1 FROM ticket_conversations WHERE conversation_id=?',(conv['id'],)),'บทสนทนานี้เชื่อมเคสแล้ว',409)
                if body.get('ticket_id'):
                    ticket = get_scoped(db,'tickets',field(body,'ticket_id',32),ctx)
                    require(ticket['contact_id']==conv['contact_id'],'ต้องเป็นข้อมูลลูกค้าคนเดียวกันที่ยืนยันแล้ว')
                    require(ticket['team_id']==conv['team_id'],'เคสและบทสนทนาต้องอยู่ทีมเดียวกัน')
                    tid = ticket['id']
                    db.execute('INSERT INTO ticket_conversations VALUES(?,?)',(tid,conv['id']))
                else:
                    priority = body.get('priority','normal')
                    require(priority in PRIORITIES,'ความเร่งด่วนไม่ถูกต้อง')
                    tid = D.create_ticket(db,conv['contact_id'],conv['team_id'],conv['subject'],priority,conversation_id=conv['id'])
                D.audit(db,ctx['name'],'conversation.linked',tid,conv['id'])
                db.commit()
                return self.send(201,{'id':tid})
        if path=='/api/contacts':
            if method=='GET':
                where,args = ('1=1',[]) if ctx['role']!='agent' else ('''c.created_by=? OR c.id IN (SELECT contact_id FROM conversations WHERE team_id=?) OR c.id IN (SELECT contact_id FROM tickets WHERE team_id=?)''',[ctx['id'],ctx['team_id'],ctx['team_id']])
                return self.send(200,{'contacts':D.rows(db,f'SELECT c.* FROM contacts c WHERE {where} ORDER BY c.name',args)})
            if method=='POST':
                cid = D.uid()
                db.execute('INSERT INTO contacts VALUES(?,?,?,?,?,?,?,?)',(cid,field(body,'name',100),field(body,'email',254,False),field(body,'phone',40,False),field(body,'company',150,False),field(body,'notes',3000,False),ctx['id'],D.now()))
                D.audit(db,ctx['name'],'contact.created',cid)
                db.commit()
                return self.send(201,{'id':cid})
        match = re.fullmatch(r'/api/contacts/([a-f0-9]{32})',path)
        if match and method=='PATCH':
            require(contact_visible(db,match[1],ctx),'ไม่พบลูกค้า',404)
            # Shared contact details are edited by managers to avoid cross-team mutations.
            require(ctx['role'] in ('admin','manager'),'เฉพาะผู้ดูแลหรือหัวหน้าทีมแก้ไขข้อมูลลูกค้าได้',403)
            db.execute('UPDATE contacts SET name=?,email=?,phone=?,company=?,notes=? WHERE id=?',(field(body,'name',100),field(body,'email',254,False),field(body,'phone',40,False),field(body,'company',150,False),field(body,'notes',3000,False),match[1]))
            D.audit(db,ctx['name'],'contact.updated',match[1])
            db.commit()
            return self.send(200,{'ok':True})
        if path=='/api/articles' and method=='GET':
            return self.send(200,{'articles':D.rows(db,'SELECT * FROM knowledge_articles ORDER BY updated_at DESC')})
        match = re.fullmatch(r'/api/articles(?:/([a-f0-9]{32}))?',path)
        if match and method in ('POST','PATCH'):
            require(ctx['role'] in ('admin','manager'),'เฉพาะผู้ดูแลหรือหัวหน้าทีมจัดการบทความได้',403)
            visibility = body.get('visibility','internal')
            require(visibility in ('internal','public'),'สิทธิ์การอ่านไม่ถูกต้อง')
            article_id = match[1] or D.uid()
            if method=='PATCH':
                require(match[1] and D.one(db,'SELECT id FROM knowledge_articles WHERE id=?',(article_id,)),'ไม่พบบทความ',404)
            else:
                require(not match[1],'เส้นทางไม่ถูกต้อง',404)
            values = (field(body,'title',200),field(body,'category',80),field(body,'body',50000),visibility,ctx['name'],D.now())
            if method=='POST':
                db.execute('INSERT INTO knowledge_articles VALUES(?,?,?,?,?,?,?)',(article_id,)+values)
            else:
                db.execute('UPDATE knowledge_articles SET title=?,category=?,body=?,visibility=?,author=?,updated_at=? WHERE id=?',values+(article_id,))
            D.audit(db,ctx['name'],'article.saved',article_id)
            db.commit()
            return self.send(200,{'id':article_id})
        if path=='/api/settings' and method=='PATCH':
            require(ctx['role']=='admin','เฉพาะผู้ดูแลองค์กร',403)
            for key in ('response_hours','resolution_hours'):
                try:
                    value = float(body.get(key,''))
                except (TypeError,ValueError):
                    raise APIError(400,'กรุณาระบุชั่วโมง SLA เป็นตัวเลข')
                require(0.25<=value<=8760,'SLA ต้องอยู่ระหว่าง 0.25–8,760 ชั่วโมง')
                db.execute('UPDATE settings SET value=? WHERE key=?',(str(value),key))
            for key,maximum in [('welcome',500),('canned_reply',3000)]:
                db.execute('UPDATE settings SET value=? WHERE key=?',(field(body,key,maximum),key))
            D.audit(db,ctx['name'],'settings.updated',ctx['tenant_id'])
            db.commit()
            return self.send(200,{'ok':True})
        if path=='/api/teams' and method=='POST':
            require(ctx['role']=='admin','เฉพาะผู้ดูแลองค์กร',403)
            team_id = D.uid()
            db.execute('INSERT INTO teams VALUES(?,?)',(team_id,field(body,'name',100)))
            D.audit(db,ctx['name'],'team.created',team_id)
            db.commit()
            return self.send(201,{'id':team_id})
        match = re.fullmatch(r'/api/members(?:/([a-f0-9]{32}))?',path)
        if match and method in ('POST','PATCH'):
            require(ctx['role']=='admin','เฉพาะผู้ดูแลองค์กร',403)
            role,team_id = body.get('role','agent'),field(body,'team_id',32)
            require(role in ('admin','manager','agent'),'สิทธิ์ไม่ถูกต้อง')
            self.validate_team(db,ctx,team_id)
            if method=='POST' and not match[1]:
                email = email_field(body)
                user = D.one(cd,'SELECT id FROM users WHERE email=?',(email,))
                require(not user,'อีเมลนี้มีบัญชีแล้ว ให้เจ้าของบัญชีติดต่อผู้ดูแลแพลตฟอร์มเพื่อเพิ่มสมาชิก',409)
                user_id = D.uid()
                cd.execute('INSERT INTO users VALUES(?,?,?,?,?,?)',(user_id,field(body,'name',100),email,new_password(body),0,D.now()))
                cd.execute('INSERT INTO memberships VALUES(?,?,?,?,1)',(ctx['tenant_id'],user_id,role,team_id))
            elif method=='PATCH' and match[1]:
                user_id = match[1]
                member = D.one(cd,'SELECT * FROM memberships WHERE tenant_id=? AND user_id=?',(ctx['tenant_id'],user_id))
                require(member,'ไม่พบสมาชิก',404)
                active = body.get('active',True)
                require(isinstance(active,bool),'สถานะไม่ถูกต้อง')
                require(user_id!=ctx['id'] or (active and role=='admin'),'ไม่สามารถถอนสิทธิ์ผู้ดูแลของตัวเองได้')
                cd.execute('UPDATE memberships SET role=?,team_id=?,active=? WHERE tenant_id=? AND user_id=?',(role,team_id,int(active),ctx['tenant_id'],user_id))
                db.execute('UPDATE tickets SET assignee_id=NULL WHERE assignee_id=? AND (?=0 OR team_id!=?)',(user_id,int(active),team_id))
            else:
                raise APIError(404,'ไม่พบรายการ')
            D.audit(db,ctx['name'],'member.updated',user_id,role)
            cd.commit()
            db.commit()
            return self.send(200,{'id':user_id})
        if path=='/api/audit' and method=='GET':
            require(ctx['role'] in ('admin','manager'),'เฉพาะผู้ดูแลหรือหัวหน้าทีม',403)
            return self.send(200,{'events':D.rows(db,'SELECT * FROM audit_logs ORDER BY id DESC LIMIT 300')})
        if path=='/api/export/tickets.csv' and method=='GET':
            records = D.rows(db,f'''SELECT t.number,t.subject,c.name AS customer,t.status,t.priority,t.category,t.created_at,t.first_response_at,t.resolved_at
                FROM tickets t JOIN contacts c ON c.id=t.contact_id WHERE {scope} ORDER BY t.number''',params)
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(['Case','Subject','Customer','Status','Priority','Category','Created at','First response at','Resolved at'])
            for record in records:
                values = [str(v) if v is not None else '' for v in record.values()]
                writer.writerow(["'"+v if v.lstrip().startswith(('=','+','-','@')) or v.startswith(('\t','\r','\n')) else v for v in values])
            D.audit(db,ctx['name'],'tickets.exported',ctx['tenant_id'],str(len(records)))
            db.commit()
            return self.send(200,('\ufeff'+output.getvalue()).encode(),'text/csv; charset=utf-8',{'Content-Disposition':'attachment; filename="bookdose-tickets.csv"'})
        if path=='/api/backup' and method=='GET':
            require(ctx['role']=='admin','เฉพาะผู้ดูแลองค์กร',403)
            D.audit(db,ctx['name'],'backup.created',ctx['tenant_id'])
            db.commit()
            return self.send(200,make_backup(ctx['tenant_id']),'application/zip',{'Content-Disposition':f'attachment; filename="bookdose-{ctx["slug"]}-backup.zip"'})
        match = re.fullmatch(r'/api/attachments/([a-f0-9]{32})',path)
        if match and method=='GET':
            file = D.one(db,'SELECT a.*,m.conversation_id FROM attachments a JOIN messages m ON m.id=a.message_id WHERE a.id=?',(match[1],))
            require(file,'ไม่พบไฟล์',404)
            get_scoped(db,'conversations',file['conversation_id'],ctx)
            return self.send_attachment(ctx['tenant_id'],file)
        raise APIError(404,'ไม่พบรายการ')

    def ai_route(self,cd,db,ctx,path,body):
        if path=='/api/ai/settings':
            require(ctx['role']=='admin','เฉพาะผู้ดูแลองค์กรจัดการ AI ได้',403)
            if self.command=='GET':
                return self.send(200,AI.overview(db,ctx['tenant_id']))
            if self.command=='PATCH':
                cfg = AI.config(db)
                for key in ('drafts_enabled','chatbot_enabled'):
                    value = body.get(key,cfg[key])
                    require(type(value) is bool,'สถานะ AI ไม่ถูกต้อง')
                    cfg[key] = value
                model = body.get('model',cfg['model'])
                require(isinstance(model,str) and re.fullmatch(r'[A-Za-z0-9_.:-]{1,100}',model),'ชื่อโมเดลไม่ถูกต้อง')
                for name,low,high in [('daily_limit',1,10000),('conversation_limit',1,100),('max_output_tokens',200,2000)]:
                    value = body.get(name,cfg[name])
                    require(type(value) is int and low<=value<=high,f'{name} ต้องเป็นจำนวนเต็มระหว่าง {low}–{high}')
                    cfg[name] = value
                key = body.get('api_key','')
                require(isinstance(key,str) and (not key or re.fullmatch(r'sk-[A-Za-z0-9_\-]{16,500}',key)),'รูปแบบ API Key ไม่ถูกต้อง')
                remove = body.get('remove_key',False)
                require(type(remove) is bool and not (remove and key),'ข้อมูลลบ API Key ไม่ถูกต้อง')
                effective_key = '' if remove else key or AI.read_key(ctx['tenant_id'])
                require(effective_key or not (cfg['drafts_enabled'] or cfg['chatbot_enabled']),'ต้องตั้งค่า API Key ก่อนเปิด AI หรือปิดทั้งสองโหมดก่อนลบคีย์')
                db.execute('BEGIN IMMEDIATE')
                if key or remove:
                    AI.write_key(ctx['tenant_id'],effective_key)
                pairs = [('ai_drafts',str(int(cfg['drafts_enabled']))),('ai_chatbot',str(int(cfg['chatbot_enabled']))),
                         ('ai_model',model),('ai_daily_limit',str(cfg['daily_limit'])),('ai_conversation_limit',str(cfg['conversation_limit'])),
                         ('ai_max_output_tokens',str(cfg['max_output_tokens'])),('ai_version',D.uid())]
                db.executemany('UPDATE settings SET value=? WHERE key=?',[(value,key) for key,value in pairs])
                # An edit invalidates in-flight work, including key/model changes.
                waiting = D.rows(db,"SELECT DISTINCT conversation_id FROM ai_jobs WHERE mode='bot' AND status IN ('pending','running')")
                db.execute("UPDATE ai_jobs SET status='cancelled',error='stale',updated_at=? WHERE status IN ('pending','running')",(D.now(),))
                for row in waiting:
                    AI.handoff(db,row['conversation_id'],'settings_changed')
                if not cfg['chatbot_enabled']:
                    db.execute("UPDATE ai_conversations SET mode='human',reason='disabled',updated_at=? WHERE mode='bot' AND conversation_id IN (SELECT id FROM conversations WHERE channel='web')",(D.now(),))
                D.audit(db,ctx['name'],'ai.settings_updated',ctx['tenant_id'])
                db.commit()
                return self.send(200,AI.overview(db,ctx['tenant_id']))
        if path=='/api/ai/test' and self.command=='POST':
            require(ctx['role']=='admin','เฉพาะผู้ดูแลองค์กร',403)
            limited(('ai-test',ctx['tenant_id']),3,60)
            db.execute('BEGIN IMMEDIATE')
            job_id = AI.enqueue(db,ctx['tenant_id'],'test',requested_by=ctx['id'])
            db.commit()
            return self.send(201,{'id':job_id,'status':'pending'})
        match = re.fullmatch(r'/api/ai/jobs/([a-f0-9]{32})',path)
        if match and self.command=='GET':
            job = D.one(db,'SELECT * FROM ai_jobs WHERE id=? AND requested_by=?',(match[1],ctx['id']))
            require(job,'ไม่พบงาน AI',404)
            if job['conversation_id']:
                get_scoped(db,'conversations',job['conversation_id'],ctx)
            else:
                require(ctx['role']=='admin','เฉพาะผู้ดูแลองค์กร',403)
            result = json.loads(job['result'])
            signature = result.pop('_context_hash',None)
            if job['mode']=='draft' and job['status']=='done' and (signature!=AI.snapshot(db,job)[2] or job['config_version']!=AI.config(db)['version']):
                job['status'],job['error'],result = 'cancelled','stale',{}
            return self.send(200,{'id':job['id'],'status':job['status'],'result':result,
                 'error':AI.ERRORS.get(job['error'],''),'input_tokens':job['input_tokens'],'output_tokens':job['output_tokens']})
        raise APIError(404,'ไม่พบรายการ AI')

    def validate_team(self,db,ctx,team_id):
        require(isinstance(team_id,str) and D.one(db,'SELECT id FROM teams WHERE id=?',(team_id,)),'ไม่พบทีม')
        require(ctx['role']!='agent' or ctx['team_id']==team_id,'ไม่มีสิทธิ์มอบหมายข้ามทีม',403)

    def validate_assignee(self,cd,ctx,user_id,team_id):
        if user_id:
            require(isinstance(user_id,str) and D.one(cd,'SELECT 1 FROM memberships WHERE tenant_id=? AND user_id=? AND active=1 AND team_id=?',(ctx['tenant_id'],user_id,team_id)),'ผู้รับผิดชอบต้องเป็นสมาชิกที่ใช้งานอยู่ในทีมนี้')

    def send_attachment(self,tenant_id,file):
        path = D.DATA/'files'/tenant_id/file['storage_key']
        require(path.is_file(),'ไม่พบไฟล์',404)
        return self.send(200,path.read_bytes(),file['mime'],{'Content-Disposition':f"attachment; filename=download{Path(file['name']).suffix}; filename*=UTF-8''{quote(file['name'])}"})

    def public_route(self,path,body):
        match = re.fullmatch(r'/api/public/([a-z0-9-]+)(?:/(conversations|session|messages|attachments|handoff)(?:/([a-f0-9]{32}))?)?',path)
        require(match,'ไม่พบหน้าช่วยเหลือ',404)
        slug,action,file_id = match.groups()
        limited(('public',self.client_address[0]),180 if self.command=='GET' else 30,60)
        with D.control() as cd:
            org = D.one(cd,"SELECT * FROM tenants WHERE slug=? AND status='active'",(slug,))
            require(org,'ไม่พบหน้าช่วยเหลือ หรือองค์กรหยุดให้บริการชั่วคราว',404)
            with D.tenant(org['id']) as db:
                if not action and self.command=='GET':
                    return self.send(200,{'organization':{'name':org['name'],'slug':slug},
                           'welcome':db.execute("SELECT value FROM settings WHERE key='welcome'").fetchone()[0],
                           'ai_enabled':AI.config(db)['chatbot_enabled'] and bool(AI.read_key(org['id'])),
                           'articles':D.rows(db,"SELECT id,title,category,body,updated_at FROM knowledge_articles WHERE visibility='public' ORDER BY updated_at DESC")})
                if action=='conversations' and self.command=='POST':
                    db.execute('BEGIN IMMEDIATE')
                    name,email,subject = field(body,'name',100),email_field(body),field(body,'subject',300)
                    require(field(body,'body',20000),'กรุณาระบุรายละเอียด')
                    cid,conv_id,token = D.uid(),D.uid(),secrets.token_urlsafe(32)
                    # Never merge contacts based on unverified visitor-supplied email.
                    team_id = db.execute('SELECT id FROM teams ORDER BY rowid LIMIT 1').fetchone()[0]
                    db.execute('INSERT INTO contacts VALUES(?,?,?,?,?,?,?,?)',(cid,name,email,'','','','portal',D.now()))
                    db.execute('INSERT INTO conversations VALUES(?,?,?,?,?,?,?,?,?)',(conv_id,cid,subject,'web',team_id,'open',D.token_hash(token),D.now(),D.now()))
                    store_message(db,org['id'],conv_id,None,name,'customer',body)
                    AI.on_customer_message(db,org['id'],conv_id,body['body'],is_new=True)
                    D.audit(db,'ผู้ติดต่อผ่านเว็บ','conversation.created',conv_id)
                    db.commit()
                    return self.send(201,{'token':token,'conversation_id':conv_id})
                token = self.headers.get('X-Portal-Token','')
                require(20<=len(token)<=100,'กรุณาใช้ลิงก์ติดตามเรื่องของคุณ',401)
                conv = D.one(db,'SELECT * FROM conversations WHERE portal_token=?',(D.token_hash(token),))
                require(conv,'ลิงก์ติดตามไม่ถูกต้อง',404)
                if action=='session' and self.command=='GET':
                    ticket = D.one(db,'SELECT t.number,t.status FROM tickets t JOIN ticket_conversations tc ON tc.ticket_id=t.id WHERE tc.conversation_id=?',(conv['id'],))
                    return self.send(200,{'conversation':{'id':conv['id'],'subject':conv['subject'],'status':conv['status']},'messages':message_list(db,conv['id'],True),'ticket':ticket,'ai':AI.conversation_state(db,conv['id'])})
                if action=='handoff' and self.command=='POST':
                    db.execute('BEGIN IMMEDIATE')
                    AI.handoff(db,conv['id'])
                    db.commit()
                    return self.send(200,{'ok':True})
                if action=='messages' and self.command=='POST':
                    db.execute('BEGIN IMMEDIATE')
                    contact = D.one(db,'SELECT name FROM contacts WHERE id=?',(conv['contact_id'],))
                    mid = store_message(db,org['id'],conv['id'],None,contact['name'],'customer',body)
                    AI.on_customer_message(db,org['id'],conv['id'],body.get('body',''))
                    db.commit()
                    return self.send(201,{'id':mid})
                if action=='attachments' and file_id and self.command=='GET':
                    file = D.one(db,"SELECT a.* FROM attachments a JOIN messages m ON m.id=a.message_id WHERE a.id=? AND m.conversation_id=? AND m.kind!='note'",(file_id,conv['id']))
                    require(file,'ไม่พบไฟล์',404)
                    return self.send_attachment(org['id'],file)
                raise APIError(404,'ไม่พบรายการ')


def main():
    parser = argparse.ArgumentParser(description='Bookdose Customer Service')
    parser.add_argument('--host',default='127.0.0.1')
    parser.add_argument('--port',type=int,default=8787)
    parser.add_argument('--secure-cookies',action='store_true',help='Use only behind an HTTPS reverse proxy')
    parser.add_argument('--backup',metavar='ZIP',help='Create a full backup and exit; stop writes first for a consistent platform snapshot')
    parser.add_argument('--restore',metavar='ZIP',help='Restore a full backup to an EMPTY data directory and exit')
    args = parser.parse_args()
    os.umask(0o077)
    if args.restore:
        require(not D.DATA.exists() or not any(D.DATA.iterdir()),'โฟลเดอร์ข้อมูลต้องว่างก่อนกู้คืน')
        with zipfile.ZipFile(args.restore) as archive:
            manifest = json.loads(archive.read('manifest.json'))
            require(manifest.get('app')=='Bookdose Customer Service' and manifest.get('scope')=='platform' and manifest.get('version')==1,'ต้องใช้ไฟล์สำรองทั้งแพลตฟอร์มรุ่น 1')
            entries = [entry for entry in archive.infolist() if entry.filename!='manifest.json']
            for entry in entries:
                require(re.fullmatch(r'control\.sqlite3|tenants/[a-f0-9]{32}\.sqlite3|files/[a-f0-9]{32}/[a-f0-9]{32}',entry.filename),'โครงสร้างไฟล์สำรองไม่ถูกต้อง')
            require(sum(e.file_size for e in entries)<=10*1024**3,'ไฟล์สำรองใหญ่เกิน 10 GB')
            require(any(e.filename=='control.sqlite3' for e in entries),'ไม่พบฐานข้อมูลแพลตฟอร์ม')
            for entry in entries:
                archive.extract(entry,D.DATA)
        with D.control() as db:
            db.execute('DELETE FROM sessions')
        print(f'Restored to {D.DATA}. All staff sessions have been signed out.')
        return
    D.init()
    if args.backup:
        target = Path(args.backup).resolve()
        target.parent.mkdir(parents=True,exist_ok=True)
        with target.open('xb') as out:
            out.write(make_backup())
        print(f'Backup saved: {target}')
        return
    server = ThreadingHTTPServer((args.host,args.port),Handler)
    server.daemon_threads = True
    server.secure_cookies = args.secure_cookies
    worker = AI.Worker()
    worker.start()
    channels = CS.Worker(store_message)
    channels.start()
    print(f'\n  Bookdose Customer Service\n  Open http://localhost:{args.port}\n  Data: {D.DATA}\n  Press Ctrl+C to stop.\n',flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nBookdose stopped. Your data is saved.')
    finally:
        worker.stop.set()
        channels.stop.set()
        server.server_close()


if __name__=='__main__':
    main()
