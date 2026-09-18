"""HTTP integration tests; each test uses a disposable database, never real data."""
import base64
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import http.cookiejar
import io
import json
import os
import re
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request
import zipfile

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app
from backend.database import db as D
from backend.extensions import channel_transport as T
from backend.middleware import rate_limit
from backend.modules.platform import repository as platform_repository
from backend.utils.dates import after
from backend.utils.security import password_ok


def assert_sealed_backup(case, raw, *plain):
    """A platform backup carries credential files only sealed (never the key), and no plain value in any entry."""
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names = archive.namelist()
        case.assertFalse(any(n.startswith('keys/') for n in names))
        for name in names:
            content = archive.read(name)
            if name.startswith('secrets/'):
                case.assertTrue(content.startswith(b'bdsec1.'),name)
            for value in plain:
                case.assertNotIn(value.encode(),content,name)
        return names


class Client:
    def __init__(self,base):
        self.base=base
        self.jar=http.cookiejar.CookieJar()
        self.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf=''
        self.tenant=''
        # Support page: the conversation a customer request is about, and the customer session's CSRF token.
        self.conversation=''
        self.customer_csrf=''

    def call(self,path,body=None,method=None,headers=None):
        hs={'X-CSRF-Token':self.csrf,'X-Tenant-ID':self.tenant,'X-Conversation-ID':self.conversation,'X-Customer-CSRF':self.customer_csrf}
        if body is not None:
            hs['Content-Type']='application/json'
        hs.update(headers or {})
        request=urllib.request.Request(self.base+path,data=None if body is None else json.dumps(body).encode(),headers=hs,method=method or ('GET' if body is None else 'POST'))
        try:
            response=self.opener.open(request,timeout=20)
        except urllib.error.HTTPError as error:
            response=error
        with response:
            data=response.read()
            return response.status,json.loads(data) if 'application/json' in response.headers.get('Content-Type','') else data

    def boot(self):
        status,result=self.call('/api/bootstrap')
        assert status==200,result
        self.csrf=result['csrf'] or ''
        self.tenant=result['tenant_id'] or ''
        return result

    def login(self,email,password='Test-password-123!'):
        status,result=self.call('/api/login',{'email':email,'password':password})
        assert status==200,result
        return self.boot()

    def switch(self,tenant_id):
        status,result=self.call('/api/session/tenant',{'tenant_id':tenant_id})
        assert status==200,result
        self.boot()


class QuietHandler(app.Handler):
    def log_message(self,*args):
        pass


class AsgiTestServer:
    """The FastAPI application on uvicorn in a thread, shaped like ThreadingHTTPServer for the tests: server_port,
    secure_cookies (read by requests while it runs), shutdown() and server_close(). No background workers, no log."""
    def __init__(self):
        import uvicorn
        from backend.asgi import ServerInfo, create_app, uvicorn_config
        self.info=ServerInfo('127.0.0.1',0)
        application=create_app(self.info,workers=False,log_requests=False)
        self.uvicorn=uvicorn.Server(uvicorn_config(application,'127.0.0.1',0,log_config=None,log_level='warning',timeout_graceful_shutdown=5))
        self.thread=threading.Thread(target=self.uvicorn.run,daemon=True)
        self.thread.start()
        deadline=time.monotonic()+20
        while not self.uvicorn.started:
            if not self.thread.is_alive() or time.monotonic()>deadline:
                raise RuntimeError('uvicorn did not start')
            time.sleep(0.01)
        self.server_port=self.uvicorn.servers[0].sockets[0].getsockname()[1]
        self.info.server_address=('127.0.0.1',self.server_port)

    @property
    def secure_cookies(self):
        return self.info.secure_cookies

    @secure_cookies.setter
    def secure_cookies(self,value):
        self.info.secure_cookies=value

    def shutdown(self):
        self.uvicorn.should_exit=True
        self.thread.join(20)

    def server_close(self):
        pass


def start_server():
    """(server, thread) on a free local port: FastAPI on uvicorn, or the old http.server when BOOKDOSE_SERVER=legacy
    (the same switch as app.py)."""
    if app.settings.SERVER=='legacy':
        server=app.ThreadingHTTPServer(('127.0.0.1',0),QuietHandler)
        server.daemon_threads=True
        server.secure_cookies=False
        thread=threading.Thread(target=server.serve_forever,daemon=True)
        thread.start()
        return server,thread
    server=AsgiTestServer()
    return server,server.thread


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory(prefix='bookdose-test-')
        self.original_data=D.DATA
        D.DATA=Path(self.temporary.name)/'data'
        D.init()
        rate_limit.RATES.clear()
        self.server,self.thread=start_server()
        self.base=f'http://127.0.0.1:{self.server.server_port}'
        self.admin=Client(self.base)
        self.assertEqual(self.admin.call('/api/setup',{'name':'เจ้าของระบบ','email':'admin@example.com','password':'Test-password-123!','organization':'องค์กร A','slug':'alpha','demo':True})[0],200)
        self.boot=self.admin.boot()
        self.org=self.admin.tenant
        self.work=self.ok(self.admin,'/api/workspace')
        self.team=self.work['team_id']

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        D.DATA=self.original_data
        self.temporary.cleanup()

    def ok(self,client,path,body=None,method=None):
        status,data=client.call(path,body,method)
        self.assertIn(status,(200,201),data)
        return data

    CUSTOMER_PASSWORD='Customer-pass-123'

    def customer_mail(self):
        """The platform mailbox that sends support-page account emails (mocked: nothing leaves the machine)."""
        if not getattr(self,'mailer',None):
            self.enable_registration_mail()
        return self.mailer

    def mail_link(self,kind,index=-1):
        """The token of a verify= / reset= link in a sent email."""
        return re.search(kind+r'=([A-Za-z0-9_-]{43})',self.mailer.call_args_list[index].args[3].get_content())[1]

    def customer(self,slug='alpha',email='visitor@example.com',name='ลูกค้าทดสอบ'):
        """A customer who signed up from the organization's link, confirmed the email and is signed in (signs in
        again when the email already has an account in this test)."""
        self.customer_mail()
        rate_limit.RATES.clear()
        client=Client(self.base)
        known=self.__dict__.setdefault('customers',set())
        if email in known:
            self.ok(client,'/api/customer/login',{'email':email,'password':self.CUSTOMER_PASSWORD})
        else:
            self.assertEqual(client.call('/api/customer/register',{'name':name,'email':email,'password':self.CUSTOMER_PASSWORD,'consent':True,'org':slug})[0],202)
            self.ok(client,'/api/customer/verify',{'token':self.mail_link('verify'),'password':self.CUSTOMER_PASSWORD})
            known.add(email)
        client.customer_csrf=self.ok(client,'/api/customer/account')['csrf']
        return client

    def visitor(self,slug='alpha',email='visitor@example.com',subject='ต้องการความช่วยเหลือ',body='เปิดหนังสือไม่ได้'):
        """A signed-in customer with a new support-page conversation; (client, conversation id)."""
        client=self.customer(slug,email)
        client.conversation=self.ok(client,f'/api/public/{slug}/conversations',{'subject':subject,'body':body})['id']
        return client,client.conversation

    def registration(self,**overrides):
        return {'name':'ผู้ดูแลองค์กรใหม่','email':'new@example.com','password':'New-password-123!',
                'password_confirm':'New-password-123!','organization':'องค์กรใหม่','slug':'new-org',**overrides}

    def enable_registration_mail(self):
        cfg={'enabled':True,'smtp_host':'smtp.example.com','smtp_port':465,'username':'mailer@example.com',
             'address':'mailer@example.com','public_base_url':'https://bookdose.example.com','password':'Secret-smtp-password'}
        self.ok(self.admin,'/api/platform/registration',cfg)
        self.mailer=patch.object(T,'send_email',return_value='message-id').start()
        self.addCleanup(patch.stopall)
        return cfg

    def email_token(self,index=-1):
        mail=self.mailer.call_args_list[index].args[3]
        return re.search(r'token=([A-Za-z0-9_-]{43})',mail.get_content())[1]

    def test_register_creates_isolated_organization_without_platform_privileges(self):
        self.enable_registration_mail()
        client=Client(self.base)
        payload=self.registration(platform_admin=True,role='platform_admin',tenant_id=self.org,demo=True)
        self.assertEqual(client.call('/api/register',payload)[0],202)
        self.assertIsNone(client.boot()['user'])
        self.assertEqual(client.call('/api/login',{'email':payload['email'],'password':payload['password']})[0],401)
        self.assertEqual(client.call('/api/register/verify',{'token':self.email_token()})[0],201)
        boot=client.boot()
        self.assertFalse(boot['setup_required'])
        self.assertFalse(boot['user']['platform_admin'])
        self.assertEqual(len(boot['memberships']),1)
        self.assertEqual(boot['memberships'][0]['role'],'admin')
        self.assertNotEqual(client.tenant,self.org)
        self.assertEqual(self.ok(client,'/api/workspace')['tenant']['slug'],'new-org')
        self.assertEqual(self.ok(client,'/api/tickets')['tickets'],[])
        self.assertEqual(client.call('/api/platform/tenants')[0],403)
        self.assertEqual(client.call('/api/session/tenant',{'tenant_id':self.org})[0],403)
        ticket=self.ok(self.admin,'/api/tickets')['tickets'][0]['id']
        self.assertEqual(client.call('/api/tickets/'+ticket)[0],404)
        self.assertEqual(client.call('/api/workspace',headers={'X-Tenant-ID':self.org})[0],409)
        self.assertEqual(self.ok(Client(self.base),'/api/public/new-org')['organization']['name'],'องค์กรใหม่')
        with D.control() as db:
            user=D.one(db,'SELECT * FROM users WHERE email=?',('new@example.com',))
            self.assertNotEqual(user['password'],payload['password'])
            self.assertTrue(password_ok(payload['password'],user['password']))
            self.assertTrue(D.one(db,"SELECT id FROM audit_logs WHERE action='tenant.register' AND entity=?",(client.tenant,)))
        self.ok(client,'/api/logout',{})
        returning=Client(self.base)
        self.assertEqual(returning.login('new@example.com','New-password-123!')['tenant_id'],boot['tenant_id'])

    def test_register_rejects_duplicate_email_and_slug_without_partial_accounts(self):
        self.enable_registration_mail()
        client=Client(self.base)
        self.assertEqual(client.call('/api/register',self.registration(email='ADMIN@EXAMPLE.COM'))[0],202)
        self.mailer.assert_not_called()
        self.assertEqual(client.call('/api/register',self.registration(slug='alpha'))[0],409)
        with D.control() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM users').fetchone()[0],1)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM tenants').fetchone()[0],1)
        self.assertEqual(len(list((D.DATA/'tenants').glob('*.sqlite3'))),1)
        self.assertEqual(self.admin.login('admin@example.com')['tenant_id'],self.org)

    def test_register_validates_fields_and_confirmation(self):
        client=Client(self.base)
        for overrides in ({'slug':'../alpha'},{'email':'bad-email'},{'organization':''},
                          {'password':'short'},{'password_confirm':'different'}):
            with self.subTest(overrides=overrides):
                self.assertEqual(client.call('/api/register',self.registration(**overrides))[0],400)
        with D.control() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM users').fetchone()[0],1)

    def test_register_requires_setup_and_never_claims_first_admin(self):
        with patch.object(D,'DATA',Path(self.temporary.name)/'empty'):
            D.init()
            client=Client(self.base)
            self.assertEqual(client.call('/api/register',self.registration())[0],409)
            self.assertTrue(client.boot()['setup_required'])
            with D.control() as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM users').fetchone()[0],0)
            self.assertEqual(client.call('/api/setup',self.registration())[0],200)
            self.assertTrue(client.boot()['user']['platform_admin'])

    def test_online_setup_requires_host_secret_and_cannot_be_repeated(self):
        token='test-setup-token-with-at-least-32-characters'
        with patch.object(D,'DATA',Path(self.temporary.name)/'online'), patch.dict(os.environ,{'RENDER':'true','BOOKDOSE_SETUP_TOKEN':token}):
            D.init()
            client=Client(self.base)
            boot=client.boot()
            self.assertTrue(boot['setup_token_required'])
            self.assertNotIn(token,json.dumps(boot))
            for supplied in ('','incorrect',None,'รหัสไม่ถูกต้อง'):
                self.assertEqual(client.call('/api/setup',self.registration(setup_token=supplied))[0],403)
            with D.control() as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM users').fetchone()[0],0)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM tenants').fetchone()[0],0)
            self.assertEqual(client.call('/api/setup',self.registration(setup_token=token))[0],200)
            self.assertTrue(client.boot()['user']['platform_admin'])
            self.assertEqual(client.call('/api/setup',self.registration(setup_token=token))[0],409)

    def test_render_setup_fails_closed_without_strong_host_secret(self):
        with patch.object(D,'DATA',Path(self.temporary.name)/'online-empty'):
            D.init()
            client=Client(self.base)
            for token in ('','short'):
                with patch.dict(os.environ,{'RENDER':'true','BOOKDOSE_SETUP_TOKEN':token}):
                    self.assertTrue(client.boot()['setup_token_required'])
                    self.assertEqual(client.call('/api/setup',self.registration(setup_token=token))[0],503)
            with D.control() as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM users').fetchone()[0],0)

    def test_register_rejects_authenticated_and_cross_origin_requests(self):
        self.assertEqual(self.admin.call('/api/register',self.registration())[0],409)
        client=Client(self.base)
        self.assertEqual(client.call('/api/register',self.registration(),headers={'Origin':'https://other.example'})[0],403)
        self.assertEqual(self.admin.boot()['tenant_id'],self.org)

    def test_register_rate_limit_does_not_block_login(self):
        client=Client(self.base)
        for _ in range(5):
            self.assertEqual(client.call('/api/register',{})[0],400)
        self.assertEqual(client.call('/api/register',self.registration())[0],429)
        self.assertTrue(client.login('admin@example.com')['user']['platform_admin'])

    def test_concurrent_register_same_slug_creates_only_one_account(self):
        self.enable_registration_mail()
        for index in range(2):
            self.assertEqual(Client(self.base).call('/api/register',self.registration(email=f'new{index}@example.com'))[0],202)
        tokens=[self.email_token(0),self.email_token(1)]
        def register(index):
            return Client(self.base).call('/api/register/verify',{'token':tokens[index]})[0]
        with ThreadPoolExecutor(max_workers=2) as executor:
            statuses=list(executor.map(register,range(2)))
        self.assertEqual(sorted(statuses),[201,409])
        with D.control() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM users').fetchone()[0],2)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM tenants').fetchone()[0],2)
        self.assertEqual(len(list((D.DATA/'tenants').glob('*.sqlite3'))),2)

    def test_verification_is_expiring_single_use_and_has_no_preverification_access(self):
        self.enable_registration_mail()
        client=Client(self.base)
        self.assertEqual(client.call('/api/register',self.registration())[0],202)
        token=self.email_token()
        with D.control() as db:
            pending=D.one(db,'SELECT * FROM pending_registrations')
            self.assertNotIn(token,json.dumps(pending))
            self.assertNotIn('New-password-123!',json.dumps(pending))
            self.assertEqual(db.execute('SELECT COUNT(*) FROM users').fetchone()[0],1)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM tenants').fetchone()[0],1)
            db.execute('UPDATE pending_registrations SET expires_at=?',(after(seconds=-1),))
        self.assertEqual(client.call('/api/register/verify',{'token':token})[0],400)
        with D.control() as db:db.execute('UPDATE pending_registrations SET expires_at=?',(after(seconds=3600),))
        self.assertEqual(client.call('/api/register/verify',{'token':'X'*43})[0],400)
        self.assertEqual(client.call('/api/register/verify',{'token':token})[0],201)
        self.assertEqual(Client(self.base).call('/api/register/verify',{'token':token})[0],400)
        with D.control() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM email_verifications').fetchone()[0],1)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM pending_registrations').fetchone()[0],0)

    def test_resend_rotates_token_and_cannot_overwrite_pending_applicant(self):
        self.enable_registration_mail()
        client=Client(self.base)
        self.assertEqual(client.call('/api/register',self.registration())[0],202)
        original=self.email_token()
        self.assertEqual(client.call('/api/register/resend',{'email':'new@example.com'})[0],202)
        self.assertEqual(self.mailer.call_count,1)
        with D.control() as db:db.execute('UPDATE pending_registrations SET last_sent_at=?',(after(seconds=-61),))
        self.assertEqual(client.call('/api/register',self.registration(organization='Attacker',password='Attacker-password!',password_confirm='Attacker-password!'))[0],202)
        with D.control() as db:
            pending=D.one(db,'SELECT * FROM pending_registrations')
            self.assertEqual(pending['organization'],'องค์กรใหม่')
            self.assertTrue(password_ok('New-password-123!',pending['password']))
            db.execute('UPDATE pending_registrations SET last_sent_at=?',(after(seconds=-61),))
        self.assertEqual(client.call('/api/register/resend',{'email':'NEW@example.com'})[0],202)
        token=self.email_token()
        self.assertNotEqual(token,original)
        self.assertEqual(client.call('/api/register/verify',{'token':original})[0],400)
        self.assertEqual(client.call('/api/register/verify',{'token':token})[0],201)

    def test_verification_settings_permissions_missing_config_and_secret_redaction(self):
        visitor=Client(self.base)
        self.assertEqual(visitor.call('/api/register',self.registration())[0],503)
        self.assertEqual(visitor.call('/api/platform/registration')[0],401)
        cfg=self.enable_registration_mail()
        public=self.ok(self.admin,'/api/platform/registration')
        self.assertTrue(public['has_password'])
        self.assertNotIn('Secret-smtp-password',json.dumps(public))
        self.assertNotIn('smtp_host',json.dumps(visitor.boot()))
        self.assertEqual(platform_repository.registration_secret_path().stat().st_mode&0o777,0o600)
        for origin in ('http://evil.example','https://user:pass@example.com','https://example.com/path','https://example.com/?x=1','https://[bad'):
            self.assertEqual(self.admin.call('/api/platform/registration',{**cfg,'public_base_url':origin})[0],400)
        member=self.create_member(role='admin')
        staff=Client(self.base);staff.login('agent@example.com')
        self.assertEqual(staff.call('/api/platform/registration')[0],403)
        self.assertEqual(staff.call('/api/platform/registration',cfg)[0],403)
        self.assertIn('secrets/registration-smtp.json',assert_sealed_backup(self,app.make_backup(),'Secret-smtp-password'))

    def test_verification_mail_failure_allows_explicit_resend_and_trusted_link(self):
        self.enable_registration_mail()
        self.mailer.side_effect=T.ChannelError('unknown',uncertain=True)
        client=Client(self.base)
        status,result=client.call('/api/register',self.registration())
        self.assertEqual(status,503)
        self.assertNotIn('Secret-smtp-password',json.dumps(result))
        self.assertIsNone(client.boot()['user'])
        with D.control() as db:db.execute('UPDATE pending_registrations SET last_sent_at=?',(after(seconds=-61),))
        self.mailer.side_effect=None
        self.assertEqual(client.call('/api/register/resend',{'email':'new@example.com'})[0],202)
        mail=self.mailer.call_args.args[3]
        self.assertEqual(str(mail['To']),'new@example.com')
        self.assertIn('https://bookdose.example.com/#verify-email?token=',mail.get_content())
        self.assertNotIn('127.0.0.1',mail.get_content())
        self.assertEqual(client.call('/api/register/verify',{'token':self.email_token()})[0],201)

    def test_unknown_resend_is_generic_and_expired_pending_can_register_again(self):
        self.enable_registration_mail()
        client=Client(self.base)
        for email in ('unknown@example.com','admin@example.com'):
            self.assertEqual(client.call('/api/register/resend',{'email':email})[0],202)
        self.mailer.assert_not_called()
        self.assertEqual(client.call('/api/register',self.registration())[0],202)
        token=self.email_token()
        with D.control() as db:db.execute('UPDATE pending_registrations SET created_at=?',(after(seconds=-86401),))
        self.assertEqual(client.call('/api/register/resend',{'email':'new@example.com'})[0],202)
        self.assertEqual(self.mailer.call_count,1)
        self.assertEqual(client.call('/api/register',self.registration(slug='fresh-org'))[0],202)
        self.assertEqual(client.call('/api/register/verify',{'token':token})[0],400)
        self.assertEqual(client.call('/api/register/verify',{'token':self.email_token()})[0],201)

    def create_member(self,team=None,role='agent',email='agent@example.com'):
        user_id=self.ok(self.admin,'/api/members',{'name':'เจ้าหน้าที่ทดสอบ','email':email,'password':'Test-password-123!','role':role,'team_id':team or self.team})['id']
        client=Client(self.base)
        client.login(email)
        return client,user_id

    def test_portal_ticket_reply_note_attachment_and_reopening(self):
        visitor,conversation=self.visitor()
        self.assertNotIn('portal_token',self.ok(self.admin,f'/api/conversations/{conversation}')['conversation'])
        before=len(self.ok(self.admin,'/api/tickets')['tickets'])
        ticket=self.ok(self.admin,f'/api/conversations/{conversation}/ticket',{})['id']
        self.assertEqual(len(self.ok(self.admin,'/api/tickets')['tickets']),before+1)
        self.assertEqual(self.admin.call(f'/api/conversations/{conversation}/ticket',{})[0],409)
        file={'name':'บันทึก.txt','data':base64.b64encode('ลับสำหรับทีม'.encode()).decode()}
        self.ok(self.admin,f'/api/conversations/{conversation}/messages',{'kind':'note','body':'PRIVATE INTERNAL NOTE','attachments':[file]})
        note=self.ok(self.admin,f'/api/conversations/{conversation}')['messages'][-1]
        file_id=note['attachments'][0]['id']
        listed=lambda:next(t for t in self.ok(self.admin,'/api/tickets')['tickets'] if t['id']==ticket)
        self.assertEqual(listed()['last_public_kind'],'customer')
        public=self.ok(visitor,'/api/public/alpha/session')
        self.assertNotIn('PRIVATE INTERNAL NOTE',json.dumps(public))
        self.assertEqual(visitor.call(f'/api/public/alpha/attachments/{file_id}')[0],404)
        self.assertEqual(self.admin.call(f'/api/attachments/{file_id}')[1],'ลับสำหรับทีม'.encode())
        self.ok(self.admin,f'/api/conversations/{conversation}/messages',{'kind':'reply','body':'ช่วยเหลือเรียบร้อยแล้ว','attachments':[{'name':'guide.txt','data':base64.b64encode(b'Public guide').decode()}]})
        public=self.ok(visitor,'/api/public/alpha/session')
        self.assertEqual(public['messages'][-1]['body'],'ช่วยเหลือเรียบร้อยแล้ว')
        self.assertEqual(listed()['last_public_kind'],'reply')
        public_file=public['messages'][-1]['attachments'][0]['id']
        self.assertEqual(visitor.call(f'/api/public/alpha/attachments/{public_file}')[1],b'Public guide')
        self.assertIsNotNone(self.ok(self.admin,f'/api/tickets/{ticket}')['ticket']['first_response_at'])
        self.ok(self.admin,f'/api/tickets/{ticket}',{'status':'resolved'},'PATCH')
        self.assertEqual(self.ok(visitor,'/api/public/alpha/session')['ticket']['status'],'resolved')
        self.ok(visitor,'/api/public/alpha/messages',{'body':'ยังต้องการความช่วยเหลืออีกนิด'})
        reopened=self.ok(self.admin,f'/api/tickets/{ticket}')['ticket']
        self.assertEqual(reopened['status'],'open')
        self.assertIsNone(reopened['resolved_at'])

    def test_tenant_isolation_ids_export_and_backup(self):
        original=self.ok(self.admin,'/api/tickets')['tickets'][0]
        visitor,conv=self.visitor()
        self.ok(self.admin,f'/api/conversations/{conv}/messages',{'kind':'note','body':'TENANT A ONLY','attachments':[{'name':'a.txt','data':base64.b64encode(b'A secret').decode()}]})
        attachment=self.ok(self.admin,f'/api/conversations/{conv}')['messages'][-1]['attachments'][0]['id']
        second=self.ok(self.admin,'/api/platform/tenants',{'name':'องค์กร B','slug':'beta','email':'admin@example.com'})['id']
        self.admin.switch(second)
        self.assertEqual(self.ok(self.admin,'/api/tickets')['tickets'],[])
        self.assertEqual(self.admin.call('/api/tickets/'+original['id'])[0],404)
        self.assertEqual(self.admin.call('/api/tickets/'+original['id'],{'status':'closed'},'PATCH')[0],404)
        self.assertEqual(self.admin.call('/api/conversations/'+conv)[0],404)
        self.assertEqual(self.admin.call('/api/attachments/'+attachment)[0],404)
        self.assertEqual(self.admin.call('/api/tickets',{'subject':'Cross tenant','contact_id':original['contact_id'],'team_id':self.work['team_id']})[0],404)
        self.assertNotIn(original['subject'].encode(),self.admin.call('/api/export/tickets.csv')[1])
        backup=self.admin.call('/api/backup')[1]
        with zipfile.ZipFile(io.BytesIO(backup)) as archive:
            self.assertIn(f'tenants/{second}.sqlite3',archive.namelist())
            self.assertNotIn(f'tenants/{self.org}.sqlite3',archive.namelist())
            self.assertFalse(any(name.startswith('files/') for name in archive.namelist()))
        # One customer account works with every organization, but another organization holds none of its conversations.
        self.assertEqual(visitor.call('/api/public/beta/session')[0],404)
        self.admin.switch(self.org)
        self.assertEqual(self.ok(self.admin,'/api/tickets/'+original['id'])['ticket']['subject'],original['subject'])

    def test_platform_role_does_not_grant_tenant_data(self):
        other=self.ok(self.admin,'/api/platform/tenants',{'name':'Private Org','slug':'private','email':'private@example.com','admin_name':'ผู้ดูแลส่วนตัว','password':'Test-password-123!'})['id']
        self.assertEqual(self.admin.call('/api/session/tenant',{'tenant_id':other})[0],403)
        self.assertEqual(self.admin.call('/api/tickets',headers={'X-Tenant-ID':other})[0],409)
        tenant_admin=Client(self.base);tenant_admin.login('private@example.com')
        self.assertEqual(tenant_admin.call('/api/platform/tenants')[0],403)
        self.assertEqual(self.ok(tenant_admin,'/api/tickets')['tickets'],[])

    def test_platform_support_access_needs_the_organizations_approval_and_ends_by_itself(self):
        from backend.modules.support_access import service as support
        other=self.ok(self.admin,'/api/platform/tenants',{'name':'Private Org','slug':'private','email':'private@example.com','admin_name':'ผู้ดูแลส่วนตัว','password':'Test-password-123!'})['id']
        path=f'/api/platform/tenants/{other}/support-access'
        me=self.boot['user']['id']
        self.assertEqual(self.admin.call(path,{})[0],400)
        self.assertEqual(self.admin.call(path,{'reason':'ab'})[0],400)
        self.assertEqual(self.admin.call(path,{'reason':'ตรวจสอบคำร้อง #123','hours':5})[0],400)
        tenant_admin=Client(self.base);tenant_admin.login('private@example.com')
        self.assertEqual(tenant_admin.call(f'/api/platform/tenants/{self.org}/support-access',{'reason':'ตรวจสอบปัญหา'})[0],403)
        # Asking gives nothing yet.
        first=self.ok(self.admin,path,{'reason':'ตรวจสอบคำร้อง #123','hours':4})['id']
        self.assertEqual(self.admin.call(path,{'reason':'ตรวจสอบคำร้อง #123'})[0],409)
        self.assertEqual(self.ok(self.admin,'/api/platform/tenants')['support'][other]['status'],'pending')
        self.assertEqual(self.admin.call('/api/session/tenant',{'tenant_id':other})[0],403)
        self.assertNotIn(other,[m['id'] for m in self.ok(self.admin,'/api/bootstrap')['memberships']])
        # The organization's admins see it with its reason; nobody else there may decide.
        waiting=self.ok(tenant_admin,'/api/support-access')['requests']
        self.assertEqual([(r['id'],r['status'],r['reason'],r['hours'],r['requester']['email']) for r in waiting],
                         [(first,'pending','ตรวจสอบคำร้อง #123',4,'admin@example.com')])
        tenant_team=self.ok(tenant_admin,'/api/workspace')['team_id']
        self.ok(tenant_admin,'/api/members',{'name':'เจ้าหน้าที่','email':'private-agent@example.com','password':'Test-password-123!','role':'manager','team_id':tenant_team})
        private_manager=Client(self.base);private_manager.login('private-agent@example.com')
        self.assertEqual(private_manager.call(f'/api/support-access/{first}/approve',{})[0],403)
        self.assertEqual(self.admin.call(f'/api/support-access/{first}/approve',{})[0],404)    # not the admin's organization
        # Denied: still nothing.
        self.ok(tenant_admin,f'/api/support-access/{first}/deny',{'note':'ยังไม่จำเป็น'})
        self.assertEqual(tenant_admin.call(f'/api/support-access/{first}/approve',{})[0],409)
        self.assertEqual(self.admin.call('/api/session/tenant',{'tenant_id':other})[0],403)
        # Asked again and approved for less than asked: a manager until then, never longer than asked.
        second=self.ok(self.admin,path,{'reason':'ตรวจสอบคำร้อง #124','hours':24})['id']
        self.assertEqual(tenant_admin.call(f'/api/support-access/{second}/approve',{'hours':72})[0],400)
        approved=self.ok(tenant_admin,f'/api/support-access/{second}/approve',{'hours':8})['requests'][0]
        self.assertEqual(approved['status'],'approved')
        self.admin.switch(other)
        self.assertEqual(self.ok(self.admin,'/api/workspace')['role'],'manager')
        self.assertEqual(self.admin.call('/api/tickets')[0],200)
        self.assertTrue(any(e['action']=='tenant.support_access' and 'ตรวจสอบคำร้อง #124' in e['detail'] for e in self.ok(tenant_admin,'/api/audit')['events']))
        member=next(m for m in self.ok(tenant_admin,'/api/workspace')['members'] if m['id']==me)
        self.assertTrue(member['active'] and member['expires_at'])
        # The time runs out: the access stops that minute, before any tidying up.
        with D.control() as cd:
            cd.execute("UPDATE memberships SET expires_at='2000-01-01T00:00:00+00:00' WHERE tenant_id=? AND user_id=?",(other,me))
            cd.execute("UPDATE support_requests SET expires_at='2000-01-01T00:00:00+00:00' WHERE id=?",(second,))
        self.assertEqual(self.admin.call('/api/tickets')[0],403)
        support.sweep()
        self.assertEqual(self.ok(tenant_admin,'/api/support-access')['requests'][0]['status'],'expired')
        with D.control() as cd:
            self.assertEqual(cd.execute('SELECT active FROM memberships WHERE tenant_id=? AND user_id=?',(other,me)).fetchone()[0],0)
        # An access in force can be stopped early by the organization, and by the platform admin.
        self.admin.switch(self.org)
        third=self.ok(self.admin,path,{'reason':'ตรวจสอบคำร้อง #125','hours':1})['id']
        self.ok(tenant_admin,f'/api/support-access/{third}/approve',{})
        self.admin.switch(other)
        self.ok(tenant_admin,f'/api/support-access/{third}/end',{})
        # Refused at once; the session is back in the platform admin's own organization (a page still showing the
        # other one is told to refresh).
        self.assertEqual(self.admin.call('/api/tickets')[0],409)
        self.assertEqual(self.ok(self.admin,'/api/bootstrap')['tenant_id'],self.org)
        self.admin.tenant=other
        self.assertEqual(self.admin.call('/api/session/tenant',{'tenant_id':other})[0],403)
        self.admin.switch(self.org)
        fourth=self.ok(self.admin,path,{'reason':'ตรวจสอบคำร้อง #126','hours':1})['id']
        self.ok(tenant_admin,f'/api/support-access/{fourth}/approve',{})
        self.ok(self.admin,f'/api/platform/support-access/{fourth}',None,'DELETE')
        self.assertEqual(self.admin.call('/api/session/tenant',{'tenant_id':other})[0],403)
        # Switching the member off on the members page ends the request too.
        fifth=self.ok(self.admin,path,{'reason':'ตรวจสอบคำร้อง #127','hours':1})['id']
        self.ok(tenant_admin,f'/api/support-access/{fifth}/approve',{})
        self.ok(tenant_admin,'/api/members/'+me,{'team_id':tenant_team,'role':'manager','active':False},'PATCH')
        self.assertEqual(self.ok(tenant_admin,'/api/support-access')['requests'][0]['status'],'ended')
        # A waiting request the platform admin withdraws, and one nobody decides, lapse.
        sixth=self.ok(self.admin,path,{'reason':'ตรวจสอบคำร้อง #128'})['id']
        self.ok(self.admin,f'/api/platform/support-access/{sixth}',None,'DELETE')
        seventh=self.ok(self.admin,path,{'reason':'ตรวจสอบคำร้อง #129'})['id']
        with D.control() as cd:
            cd.execute("UPDATE support_requests SET created_at='2000-01-01T00:00:00+00:00' WHERE id=?",(seventh,))
        statuses={r['id']:r['status'] for r in self.ok(tenant_admin,'/api/support-access')['requests']}
        self.assertEqual((statuses[sixth],statuses[seventh]),('cancelled','expired'))
        self.assertEqual(tenant_admin.call(f'/api/support-access/{seventh}/approve',{})[0],409)
        # A member with a permanent membership never goes through support access, and it never touches one.
        self.assertEqual(tenant_admin.call(f'/api/platform/tenants/{self.org}/support-access',{'reason':'ตรวจสอบปัญหา'})[0],403)
        events=[e['action'] for e in self.ok(self.admin,'/api/platform/tenants')['audit']]
        self.assertTrue({'tenant.support_requested','tenant.support_access','tenant.support_denied','tenant.support_ended',
                         'tenant.support_cancelled','tenant.support_expired'}<=set(events))
        third_org=self.ok(self.admin,'/api/platform/tenants',{'name':'Third Org','slug':'third','email':'third@example.com','admin_name':'ผู้ดูแล 3','password':'Test-password-123!'})['id']
        self.ok(self.admin,'/api/platform/tenants/'+third_org,{'status':'suspended','confirmation':'CONFIRM'},'PATCH')
        self.assertEqual(self.admin.call(f'/api/platform/tenants/{third_org}/support-access',{'reason':'ตรวจสอบปัญหา'})[0],409)
        self.assertEqual(self.admin.call(f'/api/platform/tenants/{self.org}/support-access',{'reason':'ตรวจสอบปัญหา'})[0],409)

    def test_team_boundaries_and_live_revocation(self):
        other_team=self.ok(self.admin,'/api/teams',{'name':'ทีมเทคนิค'})['id']
        agent,user_id=self.create_member(other_team)
        ticket=self.ok(self.admin,'/api/tickets')['tickets'][0]
        self.assertEqual(self.ok(agent,'/api/tickets')['tickets'],[])
        self.assertEqual(self.ok(agent,'/api/contacts')['contacts'],[])
        self.assertEqual(self.ok(agent,'/api/conversations')['conversations'],[])
        self.assertEqual(agent.call('/api/tickets/'+ticket['id'])[0],404)
        self.assertEqual(agent.call('/api/settings',{},'PATCH')[0],403)
        self.assertEqual(agent.call('/api/backup')[0],403)
        self.assertEqual(agent.call('/api/audit')[0],403)
        self.assertNotIn(ticket['subject'].encode(),agent.call('/api/export/tickets.csv')[1])
        self.ok(self.admin,'/api/tickets/'+ticket['id'],{'team_id':other_team,'assignee_id':user_id},'PATCH')
        self.assertEqual(len(self.ok(agent,'/api/tickets')['tickets']),1)
        self.assertEqual(agent.call('/api/tickets/'+ticket['id'],{'team_id':self.team,'assignee_id':None},'PATCH')[0],403)
        self.ok(self.admin,'/api/members/'+user_id,{'team_id':other_team,'role':'agent','active':False},'PATCH')
        self.assertEqual(agent.call('/api/tickets')[0],403)
        self.assertIsNone(self.ok(self.admin,'/api/tickets/'+ticket['id'])['ticket']['assignee_id'])

    def second_organization(self):
        """Organization B, with the platform admin as its admin and working in it now."""
        beta=self.ok(self.admin,'/api/platform/tenants',{'name':'องค์กร B','slug':'beta','email':'admin@example.com'})['id']
        self.admin.switch(beta)
        return beta,self.ok(self.admin,'/api/workspace')['team_id']

    def test_suspension_blocks_staff_and_public_then_recovers(self):
        beta,team=self.second_organization()
        visitor,_=self.visitor('beta')
        agent,_=self.create_member(team=team)
        self.ok(self.admin,'/api/platform/tenants/'+beta,{'status':'suspended','confirmation':'CONFIRM'},'PATCH')
        self.assertEqual(agent.call('/api/tickets')[0],403)
        self.assertEqual(self.admin.call('/api/tickets')[0],403)
        self.assertEqual(visitor.call('/api/public/beta/session')[0],404)
        self.ok(self.admin,'/api/platform/tenants/'+beta,{'status':'active'},'PATCH')
        self.assertEqual(agent.call('/api/tickets')[0],200)
        self.assertEqual(visitor.call('/api/public/beta/session')[0],200)

    def test_the_platforms_own_organization_is_never_suspended(self):
        # Every customer signs up and signs in through it: suspended, the next organization would quietly take its place.
        status,answer=self.admin.call('/api/platform/tenants/'+self.org,{'status':'suspended','confirmation':'องค์กร A'},'PATCH')
        self.assertEqual(status,409)
        self.assertIn('องค์กรหลัก',answer['error'])
        self.assertEqual(self.ok(self.admin,'/api/workspace')['tenant']['id'],self.org)
        self.assertEqual(Client(self.base).boot()['home']['slug'],'alpha')

    def test_csrf_origin_session_and_stale_tab(self):
        self.assertEqual(Client(self.base).call('/api/tickets')[0],401)
        self.assertEqual(self.admin.call('/api/teams',{'name':'Bad'},headers={'X-CSRF-Token':''})[0],403)
        self.assertEqual(self.admin.call('/api/teams',{'name':'Bad'},headers={'Origin':'https://evil.example'})[0],403)
        self.assertEqual(self.admin.call('/api/tickets',headers={'X-Tenant-ID':'0'*32})[0],409)
        self.assertEqual(self.admin.call('/api/setup',{})[0],409)
        self.assertEqual(self.admin.call('/api/teams',{'name':'Good'})[0],201)

    def test_customers_only_reach_their_own_conversations(self):
        first,c1=self.visitor(email='first@example.com')
        second,c2=self.visitor(email='second@example.com')
        self.assertNotEqual(self.ok(self.admin,'/api/conversations/'+c1)['contact']['id'],self.ok(self.admin,'/api/conversations/'+c2)['contact']['id'])
        self.ok(first,'/api/public/alpha/messages',{'body':'CUSTOMER ONE ONLY'})
        second.conversation=c1
        for path,body in (('/api/public/alpha/session',None),('/api/public/alpha/messages',{'body':'x'}),('/api/public/alpha/csat',{'rating':5})):
            self.assertEqual(second.call(path,body)[0],404,path)
        second.conversation=c2
        self.assertNotIn('CUSTOMER ONE ONLY',json.dumps(self.ok(second,'/api/public/alpha/session')))
        self.assertEqual([c['id'] for c in self.ok(second,'/api/customer/overview')['conversations']],[c2])
        # Signed out nothing is answered, and a change needs the session's CSRF token.
        anonymous=Client(self.base);anonymous.conversation=c1
        self.assertEqual(anonymous.call('/api/public/alpha/session')[0],401)
        self.assertEqual(anonymous.call('/api/public/alpha/conversations',{'subject':'x','body':'y'})[0],401)
        self.assertEqual(first.call('/api/public/alpha/messages',{'body':'x'},headers={'X-Customer-CSRF':''})[0],403)
        # A second customer writing with the same email as an existing account only makes the owner get an email.
        again=Client(self.base)
        self.assertEqual(again.call('/api/customer/register',{'name':'คนอื่น','email':'first@example.com','password':'Another-pass-123','consent':True})[0],202)
        self.assertNotIn('verify=',self.mailer.call_args.args[3].get_content())

    def test_duplicate_contacts_merge_on_staff_request(self):
        first,c1=self.visitor(email='first@example.com')
        second,c2=self.visitor(email='second@example.com')
        keep=self.ok(self.admin,'/api/conversations/'+c1)['contact']['id']
        drop=self.ok(self.admin,'/api/conversations/'+c2)['contact']['id']
        self.ok(self.admin,'/api/contacts/'+drop,{'first_name':'ลูกค้าทดสอบ','email':'same@example.com','phone':'081-234-5678','notes':'duplicate note'},'PATCH')
        ticket=self.ok(self.admin,'/api/tickets',{'subject':'Duplicate case','contact_id':drop})['id']
        agent,_=self.create_member()
        self.assertEqual(agent.call(f'/api/contacts/{keep}/merge',{'contact_ids':[drop]})[0],403)
        self.assertEqual(self.admin.call(f'/api/contacts/{keep}/merge',{'contact_ids':[keep]})[0],400)
        self.assertEqual(self.admin.call(f'/api/contacts/{keep}/merge',{'contact_ids':['0'*32]})[0],404)
        self.ok(self.admin,f'/api/contacts/{keep}/merge',{'contact_ids':[drop]})
        contacts={c['id']:c for c in self.ok(self.admin,'/api/contacts')['contacts']}
        self.assertNotIn(drop,contacts)
        self.assertEqual((contacts[keep]['phone'],contacts[keep]['notes']),('081-234-5678','duplicate note'))
        self.assertEqual(self.ok(self.admin,'/api/tickets/'+ticket)['contact']['id'],keep)
        self.assertEqual(self.ok(self.admin,'/api/conversations/'+c2)['contact']['id'],keep)
        self.assertEqual(self.ok(self.admin,'/api/audit')['events'][0]['action'],'contact.merged')
        # Each conversation still shows only its own messages.
        self.ok(first,'/api/public/alpha/messages',{'body':'FIRST VISITOR ONLY'})
        self.assertNotIn('FIRST VISITOR ONLY',json.dumps(self.ok(second,'/api/public/alpha/session')))

    def test_deleting_is_restricted_audited_and_refuses_to_orphan(self):
        """Cases, customers and articles can be removed, but only by the right role, never leaving history behind."""
        agent,_ = self.create_member(email='del-agent@example.com')
        manager,_ = self.create_member(role='manager',email='del-manager@example.com')
        contact = self.ok(self.admin,'/api/contacts',{'first_name':'ลูกค้าลบได้','email':'delete@example.com'})['id']
        keeper = self.ok(self.admin,'/api/contacts',{'first_name':'ลูกค้ามีเคส','email':'keep@example.com'})['id']
        ticket = self.ok(self.admin,'/api/tickets',{'subject':'เคสสำหรับลบ','contact_id':keeper})
        article = self.ok(self.admin,'/api/articles',{'title':'บทความสำหรับลบ','category':'ทั่วไป','body':'เนื้อหา'})['id']
        # Articles: managers may, agents may not.
        self.assertEqual(agent.call('/api/articles/'+article,None,'DELETE')[0],403)
        self.ok(manager,'/api/articles/'+article,None,'DELETE')
        self.assertNotIn(article,[a['id'] for a in self.ok(self.admin,'/api/articles')['articles']])
        # A customer with a case is never silently orphaned.
        status,body = self.admin.call('/api/contacts/'+keeper,None,'DELETE')
        self.assertEqual(status,400)
        self.assertIn('เคส',body['error'])
        self.assertEqual(agent.call('/api/contacts/'+contact,None,'DELETE')[0],403)
        self.ok(manager,'/api/contacts/'+contact,None,'DELETE')
        self.assertNotIn(contact,[c['id'] for c in self.ok(self.admin,'/api/contacts')['contacts']])
        # Cases: admins only, and the conversation stays in the inbox.
        _,conversation = self.visitor()
        self.ok(self.admin,f'/api/conversations/{conversation}/ticket',{})
        linked = self.ok(self.admin,'/api/conversations/'+conversation)['ticket']['id']
        self.assertEqual(manager.call('/api/tickets/'+linked,None,'DELETE')[0],403)
        self.ok(self.admin,'/api/tickets/'+linked,None,'DELETE')
        self.assertEqual(self.admin.call('/api/tickets/'+linked)[0],404)
        self.assertIsNone(self.ok(self.admin,'/api/conversations/'+conversation)['ticket'])
        # Every deletion is in the activity log, with what was removed.
        actions = [e['action'] for e in self.ok(self.admin,'/api/audit')['events']]
        for action in ('article.deleted','contact.deleted','ticket.deleted'):
            self.assertIn(action,actions)
        deleted = next(e for e in self.ok(self.admin,'/api/audit')['events'] if e['action']=='ticket.deleted')
        self.assertIn('BD-',deleted['detail'])

    def test_deleted_items_wait_in_the_trash_and_can_be_restored(self):
        """Nothing is thrown away by one click: a delete goes to the recycle bin, comes back whole, or is cleared."""
        agent,_ = self.create_member(email='trash-agent@example.com')
        contact = self.ok(self.admin,'/api/contacts',{'first_name':'ลูกค้ากู้คืน','email':'restore@example.com'})['id']
        article = self.ok(self.admin,'/api/articles',{'title':'บทความกู้คืน','category':'คู่มือ','body':'เนื้อหาเดิม'})['id']
        _,conversation = self.visitor()
        self.ok(self.admin,f'/api/conversations/{conversation}/ticket',{})
        ticket = self.ok(self.admin,'/api/conversations/'+conversation)['ticket']['id']
        self.assertEqual(agent.call('/api/trash')[0],403)
        for path in ('/api/articles/'+article,'/api/contacts/'+contact,'/api/tickets/'+ticket):
            self.ok(self.admin,path,None,'DELETE')
        trash = self.ok(self.admin,'/api/trash')
        self.assertEqual(trash['keep_days'],30)
        self.assertEqual({item['kind'] for item in trash['items']},{'article','contact','ticket'})
        self.assertTrue(all(item['days_left']==30 for item in trash['items']))
        # Restoring puts the rows back exactly as they were, including the case's conversation link.
        for kind in ('contact','article','ticket'):
            item = next(i for i in self.ok(self.admin,'/api/trash')['items'] if i['kind']==kind)
            self.ok(self.admin,f"/api/trash/{item['id']}/restore",{})
        self.assertIn(contact,[c['id'] for c in self.ok(self.admin,'/api/contacts')['contacts']])
        restored = next(a for a in self.ok(self.admin,'/api/articles')['articles'] if a['id']==article)
        self.assertEqual(restored['body'],'เนื้อหาเดิม')
        self.assertEqual(self.ok(self.admin,'/api/tickets/'+ticket)['ticket']['id'],ticket)
        self.assertEqual(self.ok(self.admin,'/api/conversations/'+conversation)['ticket']['id'],ticket)
        self.assertEqual(self.ok(self.admin,'/api/trash')['items'],[])
        # Clearing one for good removes it from the bin, and both steps are in the activity log.
        self.ok(self.admin,'/api/articles/'+article,None,'DELETE')
        item = self.ok(self.admin,'/api/trash')['items'][0]
        self.assertEqual(agent.call('/api/trash/'+item['id'],None,'DELETE')[0],403)
        self.ok(self.admin,'/api/trash/'+item['id'],None,'DELETE')
        self.assertEqual(self.ok(self.admin,'/api/trash')['items'],[])
        self.assertEqual(self.admin.call(f"/api/trash/{item['id']}/restore",{})[0],404)
        actions = [e['action'] for e in self.ok(self.admin,'/api/audit')['events']]
        for action in ('article.restored','ticket.restored','contact.restored','article.purged'):
            self.assertIn(action,actions)

    def test_knowledge_visibility_and_agent_permissions(self):
        public=Client(self.base)
        # Only the organization's own articles here; the platform's global ones are tested in test_platform_console.
        with D.control() as cd:
            cd.execute('DELETE FROM global_articles')
        self.assertEqual(self.ok(public,'/api/public/alpha')['articles'],[])
        article=self.ok(self.admin,'/api/articles',{'title':'คู่มือ','category':'ทดสอบ','body':'Internal instructions','visibility':'internal'})['id']
        self.assertEqual(self.ok(public,'/api/public/alpha')['articles'],[])
        self.ok(self.admin,'/api/articles/'+article,{'title':'คู่มือ','category':'ทดสอบ','body':'Published instructions','visibility':'public'},'PATCH')
        self.assertEqual(self.ok(public,'/api/public/alpha')['articles'][0]['body'],'Published instructions')
        agent,_=self.create_member()
        self.assertEqual(agent.call('/api/articles',{'title':'Unauthorized'})[0],403)

    def test_password_change_invalidates_other_sessions(self):
        other=Client(self.base);other.login('admin@example.com')
        self.ok(self.admin,'/api/account/password',{'current_password':'Test-password-123!','password':' New-password-456! '})
        self.admin.boot()
        self.assertEqual(other.call('/api/tickets')[0],401)
        self.assertEqual(self.admin.call('/api/tickets')[0],200)
        fresh=Client(self.base)
        self.assertEqual(fresh.call('/api/login',{'email':'admin@example.com','password':'Test-password-123!'})[0],401)
        fresh.login('admin@example.com',' New-password-456! ')

    def test_inline_media_upload_types_and_private_access(self):
        visitor,conversation=self.visitor()
        samples={
            'clip.mp4':('video/mp4',b'\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom'),
            'clip.webm':('video/webm',b'\x1a\x45\xdf\xa3\x87\x42\x82\x84webm'),
            'image.gif':('image/gif',b'GIF89a'+b'\x00'*16),
            'image.webp':('image/webp',b'RIFF\x10\x00\x00\x00WEBPVP8 '+b'\x00'*16),
        }
        for name,(mime,content) in samples.items():
            upload={'name':name,'data':base64.b64encode(content).decode()}
            self.ok(visitor,'/api/public/alpha/messages',{'attachments':[upload]})
            media=self.ok(self.admin,'/api/conversations/'+conversation)['messages'][-1]['attachments'][0]
            self.assertEqual(media['mime'],mime)
            self.assertEqual(self.admin.call('/api/attachments/'+media['id'])[1],content)
            self.assertEqual(visitor.call('/api/public/alpha/attachments/'+media['id'])[1],content)
            self.assertEqual(Client(self.base).call('/api/attachments/'+media['id'])[0],401)
            self.assertEqual(visitor.call('/api/public/alpha/messages',{'attachments':[{'name':name,'data':base64.b64encode(b'not media').decode()}]})[0],400)
        self.ok(self.admin,'/api/conversations/'+conversation+'/messages',{
            'kind':'note','attachments':[{'name':'private.mp4','data':base64.b64encode(samples['clip.mp4'][1]).decode()}]})
        private=self.ok(self.admin,'/api/conversations/'+conversation)['messages'][-1]['attachments'][0]
        self.assertEqual(visitor.call('/api/public/alpha/attachments/'+private['id'])[0],404)
        self.assertNotIn(private['id'],json.dumps(self.ok(visitor,'/api/public/alpha/session')))

    def test_validation_attachments_and_manual_channel(self):
        visitor,conversation=self.visitor()
        self.assertEqual(self.admin.call('/api/conversations/'+conversation+'/messages',{'body':'x','attachments':[{'name':'bad.html','data':base64.b64encode(b'<script>bad</script>').decode()}]})[0],400)
        self.assertEqual(self.admin.call('/api/conversations/'+conversation+'/messages',{'body':'x','attachments':[{'name':'fake.png','data':base64.b64encode(b'not png').decode()}]})[0],400)
        self.assertEqual(len(self.ok(visitor,'/api/public/alpha/session')['messages']),1)
        # The support page is open to anyone, so the same rules are enforced for a visitor's uploads.
        png=base64.b64encode(b'\x89PNG\r\n\x1a\n'+b'0'*32).decode()
        for bad in ([{'name':'setup.exe','data':base64.b64encode(b'MZ\x90\x00program').decode()}],
                    [{'name':'invoice.pdf.exe','data':base64.b64encode(b'MZ\x90\x00program').decode()}],
                    [{'name':'photo.png','data':base64.b64encode(b'MZ\x90\x00program').decode()}],
                    [{'name':'../../escape.txt','data':base64.b64encode(b'hello').decode()}],
                    [{'name':'empty.txt','data':''}],
                    [{'name':f'{n}.png','data':png} for n in range(4)]):
            self.assertEqual(visitor.call('/api/public/alpha/messages',{'body':'x','attachments':bad})[0],400)
        self.ok(visitor,'/api/public/alpha/messages',{'body':'ภาพหน้าจอค่ะ','attachments':[{'name':'screen.png','data':png}]})
        contact=self.ok(self.admin,'/api/contacts')['contacts'][0]
        ticket=self.ok(self.admin,'/api/tickets',{'subject':'Manual work','contact_id':contact['id'],'body':'staff record'})['id']
        data=self.ok(self.admin,'/api/tickets/'+ticket)
        conv=data['conversations'][0]['id']
        self.assertEqual(self.admin.call('/api/conversations/'+conv+'/messages',{'kind':'reply','body':'cannot deliver'})[0],400)
        self.ok(self.admin,'/api/conversations/'+conv+'/messages',{'kind':'note','body':'internal is fine'})
        self.assertEqual(self.admin.call('/api/tickets/'+ticket,{'status':'hacked'},'PATCH')[0],400)
        self.assertEqual(self.admin.call('/api/settings',{'response_hours':'nan','resolution_hours':'24','welcome':'a','canned_reply':'b'},'PATCH')[0],400)

    def test_csv_formula_escaping_and_concurrent_ticket_numbers(self):
        contact=self.ok(self.admin,'/api/contacts',{'name':'Formula customer'})['id']
        self.ok(self.admin,'/api/tickets',{'subject':'=HYPERLINK("evil")','contact_id':contact})
        csv_data=self.admin.call('/api/export/tickets.csv')[1].decode('utf-8-sig')
        self.assertIn("'=HYPERLINK",csv_data)
        def create(index):
            client=Client(self.base)
            client.opener=self.admin.opener
            client.csrf=self.admin.csrf;client.tenant=self.admin.tenant
            return client.call('/api/tickets',{'subject':f'Concurrent {index}','contact_id':contact})
        with ThreadPoolExecutor(max_workers=6) as executor:
            results=list(executor.map(create,range(6)))
        self.assertTrue(all(r[0]==201 for r in results),results)
        numbers=[t['number'] for t in self.ok(self.admin,'/api/tickets')['tickets']]
        self.assertEqual(len(numbers),len(set(numbers)))

    def test_full_backup_restore_retains_data_and_clears_sessions(self):
        self.enable_registration_mail()
        self.assertEqual(Client(self.base).call('/api/register',self.registration())[0],202)
        visitor,conv=self.visitor()
        self.ok(visitor,'/api/public/alpha/messages',{'body':'restore this','attachments':[{'name':'restore.txt','data':base64.b64encode(b'round trip').decode()}]})
        archive=Path(self.temporary.name)/'backup.zip'
        archive.write_bytes(app.make_backup())
        restore_dir=Path(self.temporary.name)/'restored'
        env={k:v for k,v in os.environ.items() if not k.startswith('BOOKDOSE_SECRET_KEY')}
        env['BOOKDOSE_DATA']=str(restore_dir)
        # The key is kept apart from the backups; it goes back in place before restoring.
        (restore_dir/'keys').mkdir(parents=True)
        (restore_dir/'keys'/'secret.key').write_bytes((D.DATA/'keys'/'secret.key').read_bytes())
        result=subprocess.run([sys.executable,app.__file__,'--restore',str(archive)],env=env,capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('credential files restored',result.stdout)
        original=D.DATA
        try:
            D.DATA=restore_dir
            self.assertEqual(platform_repository.read_registration_secret().get('password'),'Secret-smtp-password')
        finally:
            D.DATA=original
        with closing(sqlite3.connect(restore_dir/'control.sqlite3')) as cd:
            self.assertEqual(cd.execute('SELECT COUNT(*) FROM sessions').fetchone()[0],0)
            self.assertEqual(cd.execute('SELECT COUNT(*) FROM pending_registrations').fetchone()[0],0)
            self.assertEqual(cd.execute('SELECT COUNT(*) FROM tenants').fetchone()[0],1)
        with closing(sqlite3.connect(restore_dir/'tenants'/f'{self.org}.sqlite3')) as td:
            self.assertEqual(td.execute('SELECT COUNT(*) FROM tickets').fetchone()[0],5)
            key=td.execute('SELECT storage_key FROM attachments').fetchone()[0]
        self.assertEqual((restore_dir/'files'/self.org/key).read_bytes(),b'round trip')
        again=subprocess.run([sys.executable,app.__file__,'--restore',str(archive)],env=env,capture_output=True)
        self.assertNotEqual(again.returncode,0)

    def test_only_the_api_is_served(self):
        # The pages are the Next.js app's (frontend/); this server answers /api/* and nothing else.
        for path in ('/','/login','/templates.json','/register','/oauth/email/callback','/frontend/core.js'):
            status,body=Client(self.base).call(path)
            self.assertEqual(status,404,path)
            self.assertIn('error',body)

    def test_review_contact_names_and_public_validation(self):
        contact=self.ok(self.admin,'/api/contacts',{'first_name':'สมชาย','last_name':"O’Connor-Smith",'email':'person@example.com','phone':'+66 (81) 234-5678'})['id']
        c=next(c for c in self.ok(self.admin,'/api/contacts')['contacts'] if c['id']==contact)
        self.assertEqual(c['name'],'สมชาย O’Connor-Smith')
        self.assertEqual(c['first_name'],'สมชาย')
        self.assertEqual(c['last_name'],'O’Connor-Smith')
        for data in ({'name':'<script>alert(1)</script>'},{'name':'Valid','email':'a@<script>.com'},{'name':'Valid','phone':'javascript:alert(1)'}):
            self.assertEqual(self.admin.call('/api/contacts',data)[0],400)
        self.customer_mail()
        data={'name':'<img src=x onerror=alert(1)>','email':'person@example.com','password':self.CUSTOMER_PASSWORD,'consent':True}
        self.assertEqual(Client(self.base).call('/api/customer/register',data)[0],400)
        customer,_=self.visitor(email='person@example.com',body='<script>window.bad=true</script>')
        # Plain text messages are retained; rendering escapes the HTML on both staff and portal views.
        self.assertEqual(self.ok(customer,'/api/public/alpha/session')['messages'][0]['body'],'<script>window.bad=true</script>')

    def test_review_profile_is_self_only_and_rejects_unsafe_images(self):
        self.assertEqual(Client(self.base).call('/api/account/profile',{'name':'Test'})[0],401)
        self.assertEqual(self.admin.call('/api/account/profile',{'name':'Test'},headers={'X-CSRF-Token':''})[0],403)
        self.assertEqual(self.admin.call('/api/account/profile',{'name':'Test','avatar':'data:image/svg+xml,<svg onload=alert(1)>'})[0],400)
        self.assertEqual(self.admin.call('/api/account/profile',{'name':'Test','avatar':'data:image/png;base64,aGVsbG8='})[0],400)
        png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII='
        self.ok(self.admin,'/api/account/profile',{'name':'ชื่อใหม่','avatar':png,'user_id':'someone-else'})
        boot=self.admin.boot()
        self.assertEqual(boot['user']['name'],'ชื่อใหม่')
        self.assertEqual(boot['avatar'],png)
        member=self.create_member()
        staff=Client(self.base);staff.login('agent@example.com')
        self.assertEqual(staff.boot()['avatar'],'')
        self.ok(self.admin,'/api/account/profile',{'name':'ชื่อใหม่','avatar':''})
        self.assertEqual(self.admin.boot()['avatar'],'')

    def test_review_suspension_requires_typed_confirmation(self):
        beta,_=self.second_organization()
        self.assertEqual(self.admin.call('/api/platform/tenants/'+beta,{'status':'suspended'},'PATCH')[0],400)
        self.assertEqual(self.admin.call('/api/platform/tenants/'+beta,{'status':'suspended','confirmation':'wrong'},'PATCH')[0],400)
        self.ok(self.admin,'/api/platform/tenants/'+beta,{'status':'suspended','confirmation':'องค์กร B'},'PATCH')
        self.assertEqual(self.admin.call('/api/workspace')[0],403)
        self.ok(self.admin,'/api/platform/tenants/'+beta,{'status':'active'},'PATCH')
        self.assertEqual(self.admin.call('/api/workspace')[0],200)

    def test_review_note_does_not_clear_waiting_customer_and_audit_resolves_actor(self):
        visitor,conversation=self.visitor()
        self.ok(self.admin,'/api/conversations/'+conversation+'/messages',{'kind':'note','body':'ตรวจสอบภายใน'})
        row=next(c for c in self.ok(self.admin,'/api/conversations')['conversations'] if c['id']==conversation)
        self.assertEqual(row['last_kind'],'note')
        self.assertEqual(row['last_public_kind'],'customer')
        self.ok(self.admin,'/api/conversations/'+conversation+'/messages',{'kind':'reply','body':'ตอบแล้ว'})
        row=next(c for c in self.ok(self.admin,'/api/conversations')['conversations'] if c['id']==conversation)
        self.assertEqual(row['last_public_kind'],'reply')
        events=self.ok(self.admin,'/api/platform/tenants')['audit']
        login=next(e for e in events if e['action']=='auth.login')
        self.assertIn('admin@example.com',login['actor_display'])


if __name__=='__main__':
    unittest.main(verbosity=2)
