"""Honeypots and honeytokens (docs/HONEYPOT-DESIGN.md): decoy API and page paths answered like any unknown path, the web
app's trap reports, hidden form fields, honeytokens of every kind (decoy account, API key, password, shared-file link)
with their events, alerts, emails and automatic blocks, and real users left alone. Email is mocked and every test uses a
disposable database; nothing leaves the machine."""
import hashlib
import json
import os
import re
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

import test_app as base
import test_security_round as security_round
from test_app import Client, D, rate_limit
from backend.modules.customers.service import WRONG_LOGIN
from backend.modules.guest.schema import SPAM
from backend.modules.security import model, traps

PASSWORD = security_round.PASSWORD
CUSTOMER_PASSWORD = security_round.CUSTOMER_PASSWORD
SEC = security_round.SEC
TRAP_MAIL = 'แจ้งเตือนวิกฤต: มีการใช้กับดักความปลอดภัย'


def sha256(value):
    return hashlib.sha256(value.encode()).hexdigest()


class HoneypotTests(unittest.TestCase):
    ok = base.IntegrationTests.ok
    customer = base.IntegrationTests.customer
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    create_member = base.IntegrationTests.create_member
    registration = base.IntegrationTests.registration
    CUSTOMER_PASSWORD = CUSTOMER_PASSWORD
    tearDown = security_round.SecurityRoundTests.tearDown
    lock_row = security_round.SecurityRoundTests.lock_row
    events_of = security_round.SecurityRoundTests.events_of
    total = security_round.SecurityRoundTests.total

    def setUp(self):
        security_round.SecurityRoundTests.setUp(self)
        traps.invalidate()
        traps._admins.clear()

    # Helpers
    def proxied(self, ip, **extra):
        """Headers of a request the local web app forwards for the browser at ip."""
        return {'X-Forwarded-Host':f'127.0.0.1:{self.server.server_port}','X-Bookdose-Client-IP':ip,**extra}

    def exchange(self, path, body=None, method=None, headers=None, client=None):
        """(status, headers without Date, body bytes) exactly as sent."""
        client = client or Client(self.base)
        hs = {'X-CSRF-Token':client.csrf,'X-Tenant-ID':client.tenant}
        if body is not None:
            hs['Content-Type'] = 'application/json'
        hs.update(headers or {})
        request = urllib.request.Request(self.base+path,data=None if body is None else json.dumps(body).encode(),headers=hs,
                                         method=method or ('GET' if body is None else 'POST'))
        rate_limit.RATES.clear()
        try:
            response = client.opener.open(request,timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            fields = sorted((k.lower(),v) for k,v in response.headers.items() if k.lower()!='date')
            return response.status,fields,response.read()

    def flush(self):
        self.assertTrue(traps.flush())

    def trap_events(self):
        with D.control() as cd:
            return D.rows(cd,f"SELECT * FROM security_events WHERE kind IN ({','.join('?'*len(model.TRAP_EVENT_KINDS))}) ORDER BY id",
                          model.TRAP_EVENT_KINDS)

    def block_of(self, ip):
        with D.control() as cd:
            return D.one(cd,'SELECT * FROM ip_blocks WHERE ip=?',(ip,))

    def settings(self, honeypot):
        return self.ok(self.admin,f'{SEC}/settings',{'honeypot':honeypot})

    def plant(self, kind, label='กับดักทดสอบ', note='ไฟล์ backup.txt บนไดรฟ์ทีม'):
        status,data = self.admin.call(f'{SEC}/honeytokens',{'kind':kind,'label':label,'placed_at_note':note})
        self.assertEqual(status,201,data)
        return data['token'],data['secret']

    def token_row(self, token_id):
        with D.control() as cd:
            return D.one(cd,'SELECT * FROM honeytokens WHERE id=?',(token_id,))

    def triggers(self, token_id=None):
        events = [e for e in self.events_of('honeytoken_triggered') if not e['detail'].get('test')]
        return [e for e in events if token_id is None or e['detail']['token_id']==token_id]

    def trap_mails(self):
        return [c for c in getattr(self,'mailer',None).call_args_list if c.args[3]['Subject']==TRAP_MAIL] if getattr(self,'mailer',None) else []

    def report(self, path, ip='198.51.100.77', agent='Mozilla/5.0 (scanner)', headers=None):
        """The web app's trap report."""
        return self.exchange('/api/trap',{'path':path,'method':'GET','user_agent':agent},
                             headers={**self.proxied(ip),'X-Bookdose-Trap':'1',**(headers or {})})

    # 1a. Decoy paths
    def test_decoy_api_path_answers_like_an_unknown_path_and_is_recorded(self):
        manager,_ = self.create_member(role='admin',email='manager@example.com')
        # A signed-in member touching one: recorded with who it was.
        self.assertEqual(self.exchange('/api/internal/config',client=manager),self.exchange('/api/internal/nothing',client=manager))
        pairs = (('/api/admin','/api/nothing-here'),('/api/v1/users','/api/v9/nothing'),('/api/.env','/api/.nothing'),
                 ('/api/admin/','/api/nothing-here/'),('/.env','/.nothing'),('/vendor/phpunit/src/Util/eval-stdin.php','/vendor/nothing/x.php'))
        for decoy,unknown in pairs:
            for method,body in (('GET',None),('POST',{'q':1}),('DELETE',None)):
                for client in (None,manager,self.admin):
                    self.assertEqual(self.exchange(decoy,body,method,client=client),self.exchange(unknown,body,method,client=client),(decoy,method))
        # Not JSON, a foreign Origin: still the same answers.
        self.assertEqual(self.exchange('/api/graphql',None,'POST',headers={'Content-Type':'text/plain'}),
                         self.exchange('/api/graphqx',None,'POST',headers={'Content-Type':'text/plain'}))
        self.assertEqual(self.exchange('/api/debug',{},headers={'Origin':'https://evil.example'}),
                         self.exchange('/api/debux',{},headers={'Origin':'https://evil.example'}))
        self.flush()
        hits = self.events_of('honeypot_path')
        self.assertEqual({e['subject'] for e in hits},{'/api/admin','/api/v1/users','/api/.env','/api/admin/','/.env','/api/internal/config',
                                                        '/vendor/phpunit/src/Util/eval-stdin.php','/api/graphql','/api/debug'})
        self.assertEqual({e['severity'] for e in hits},{'warning'})
        self.assertEqual(sum(e['count'] for e in hits if e['subject']=='/api/admin'),9)
        insider = next(e for e in hits if e['subject']=='/api/internal/config')
        self.assertEqual((insider['actor'],insider['detail']['user_email'],insider['tenant_id']),('staff','manager@example.com',self.org))
        self.assertEqual({e['detail']['method'] for e in hits if e['subject']=='/api/admin'},{'GET'})
        # Unknown paths are not traps; loopback is never blocked.
        self.assertEqual({e['subject'] for e in hits}&{'/api/nothing-here','/.nothing'},set())
        self.assertIsNone(self.block_of('127.0.0.1'))
        # Switched off: nothing is recorded.
        self.settings({'paths_enabled':False})
        before = len(self.trap_events())
        self.exchange('/api/admin')
        self.flush()
        self.assertEqual(len(self.trap_events()),before)

    def test_custom_api_paths_validation_and_overlaps(self):
        self.assertEqual(self.ok(self.admin,f'{SEC}/settings')['honeypot'],model.DEFAULT_SETTINGS['honeypot'])
        # The built-in decoys shadow no real route either.
        from backend.modules.security import schema
        for path in model.DECOY_API_PATHS:
            self.assertEqual(schema.route_overlap(path,'exact'),'',path)
        for path in (*model.DECOY_PAGE_PATHS,*model.DECOY_PAGE_PREFIXES):
            self.assertFalse(path.startswith('/api/'),path)
        refused = ([{'path':'/api/tickets','match':'exact'}],[{'path':'/api/members','match':'prefix'}],
                   [{'path':'/api/automation','match':'prefix'}],[{'path':'/api/customer/secret','match':'exact'}],
                   [{'path':'/api/public/alpha-admin','match':'exact'}],[{'path':'/api/trap','match':'exact'}],
                   [{'path':'/api/realtime','match':'prefix'}],[{'path':'/api/tickets/'+'a'*32,'match':'exact'}],
                   [{'path':'/api/platform/security/honeytokens','match':'exact'}],[{'path':'/api/sign-in','match':'exact'}],
                   [{'path':'/other/admin','match':'exact'}],[{'path':'api/admin2','match':'exact'}],[{'path':'/api/a b','match':'exact'}],
                   [{'path':'/api/../tickets','match':'exact'}],[{'path':'/api/debug','match':'exact'}],
                   [{'path':'/api/old','match':'regex'}],[{'path':'/api/old'},{'path':'/API/old/'}],
                   [{'path':f'/api/decoy-{n}'} for n in range(51)],'/api/old',[{'path':5}])
        for paths in refused:
            status,data = self.admin.call(f'{SEC}/settings',{'honeypot':{'custom_api_paths':paths}})
            self.assertEqual(status,400,(paths,data))
        status,data = self.admin.call(f'{SEC}/settings',{'honeypot':{'custom_api_paths':[{'path':'/api/tickets','match':'exact'}]}})
        self.assertIn('ซ้อนกับเส้นทางจริง',data['error'])
        for rule in ({'block_on_path_hits':{'hits':0}},{'block_on_path_hits':{'window_minutes':1441}},{'block_on_path_hits':{'duration':'2h'}},
                     {'block_on_path_hits':{'enabled':'yes'}},{'block_on_honeytoken':{'duration':'forever'}},{'paths_enabled':1},
                     {'forms_enabled':None},{'block_on_honeytoken':[]}):
            self.assertEqual(self.admin.call(f'{SEC}/settings',{'honeypot':rule})[0],400,rule)
        saved = self.settings({'custom_api_paths':[{'path':'/API/Secret-Backup/','match':'exact'},{'path':'/api/old-admin','match':'prefix'},
                                                   {'path':'/api/tick','match':'prefix'}],
                               'block_on_path_hits':{'hits':5,'window_minutes':30,'duration':'24h'}})['honeypot']
        self.assertEqual(saved['custom_api_paths'],[{'path':'/api/secret-backup','match':'exact'},{'path':'/api/old-admin','match':'prefix'},
                                                    {'path':'/api/tick','match':'prefix'}])
        self.assertEqual(saved['block_on_path_hits'],{'enabled':True,'hits':5,'window_minutes':30,'duration':'24h'})
        self.assertEqual(self.ok(self.admin,f'{SEC}/settings')['honeypot'],saved)
        changed = self.events_of('security_settings_changed')[0]
        self.assertEqual(changed['detail']['honeypot']['block_on_path_hits']['hits'],5)
        for path in ('/api/secret-backup','/api/old-admin','/api/old-admin/users/export','/api/tick/1'):
            self.assertEqual(self.exchange(path),self.exchange('/api/nothing-here'))
        self.assertEqual(Client(self.base).call('/api/tickets')[0],401)
        self.exchange('/api/secret-backup/more')
        self.exchange('/api/old-administrator')
        self.flush()
        self.assertEqual({e['subject'] for e in self.events_of('honeypot_path')},{'/api/secret-backup','/api/old-admin','/api/old-admin/users/export','/api/tick/1'})
        # Real routes still work for their users.
        self.assertEqual(self.admin.call('/api/tickets')[0],200)

    def test_trap_report_only_from_the_web_app(self):
        body = {'path':'/.env','method':'GET','user_agent':'curl/8'}
        unknown = self.exchange('/api/trap-report',body)
        self.assertEqual(unknown[0],401)
        for headers in ({},{'X-Bookdose-Trap':'1'},self.proxied('198.51.100.7'),{**self.proxied('198.51.100.7'),'X-Bookdose-Trap':'yes'},
                        {'X-Bookdose-Trap':'1','X-Bookdose-Client-IP':'198.51.100.7'}):
            self.assertEqual(self.exchange('/api/trap',body,headers=headers),self.exchange('/api/trap-report',body,headers=headers),headers)
        self.assertEqual(self.exchange('/api/trap',None,'GET',headers={**self.proxied('198.51.100.7'),'X-Bookdose-Trap':'1'}),
                         self.exchange('/api/trap-report',None,'GET',headers={**self.proxied('198.51.100.7'),'X-Bookdose-Trap':'1'}))
        with patch.dict(os.environ,{'BOOKDOSE_PROXY_SECRET':'s3cret-value'}):
            wrong = {**self.proxied('198.51.100.7'),'X-Bookdose-Trap':'1','X-Bookdose-Proxy':'wrong'}
            self.assertEqual(self.exchange('/api/trap',body,headers=wrong),self.exchange('/api/trap-report',body,headers=wrong))
            self.flush()
            self.assertEqual(self.trap_events(),[])
            status,_,content = self.report('/wp-login.php',headers={'X-Bookdose-Proxy':'s3cret-value'})
            self.assertEqual((status,content),(204,b''))
        status,_,content = self.report('/.env')
        self.assertEqual((status,content),(204,b''))
        self.report('/files/Zm9vYmFyYmF6cXV4')
        self.flush()
        hits = self.events_of('honeypot_path')
        self.assertEqual({(e['subject'],e['ip'],e['user_agent']) for e in hits},
                         {('/wp-login.php','198.51.100.77','Mozilla/5.0 (scanner)'),('/.env','198.51.100.77','Mozilla/5.0 (scanner)'),
                          ('/files/Zm9vYm…','198.51.100.77','Mozilla/5.0 (scanner)')})
        # Three hits from one address: blocked for an hour (the default rule).
        block = self.block_of('198.51.100.77')
        self.assertEqual(block['created_by'],model.TRAP_BLOCKER)
        self.assertEqual(self.exchange('/api/bootstrap',headers=self.proxied('198.51.100.77'))[0],403)
        self.assertEqual(self.admin.call(f'{SEC}/settings',{'honeypot':{'custom_api_paths':[{'path':'/api/trap'}]}})[0],400)

    def test_path_hits_block_after_n_hits_but_never_loopback_or_a_platform_admin(self):
        attacker = '198.51.100.20'
        for path in ('/api/admin','/api/debug'):
            self.assertEqual(self.exchange(path,headers=self.proxied(attacker))[0],401)
        self.flush()
        self.assertIsNone(self.block_of(attacker))
        self.assertEqual(self.exchange('/api/swagger.json',headers=self.proxied(attacker))[0],401)
        self.flush()
        block = self.block_of(attacker)
        self.assertEqual((block['created_by'],bool(block['expires_at'])),(model.TRAP_BLOCKER,True))
        self.assertIn('3 ครั้งใน 10 นาที',block['reason'])
        self.assertTrue(security_round.after(minutes=59)<block['expires_at']<=security_round.after(hours=1))
        self.assertEqual(Client(self.base).call('/api/bootstrap',headers=self.proxied(attacker)),(403,{'error':model.BLOCKED_MESSAGE}))
        blocked = self.events_of('trap_ip_block')
        self.assertEqual([(e['ip'],e['detail']['trigger'],e['detail']['hits']) for e in blocked],[(attacker,'honeypot_path',3)])
        self.assertIn(attacker,[b['ip'] for b in self.ok(self.admin,f'{SEC}/ip-blocks')['blocks']])
        # Loopback, however many hits.
        for _ in range(5):
            self.exchange('/api/admin')
        # The address of a signed-in platform admin (seen on one of their requests).
        admin_ip = '198.51.100.30'
        self.assertEqual(self.admin.call('/api/session',headers=self.proxied(admin_ip))[0],200)
        for _ in range(5):
            self.exchange('/api/admin',headers=self.proxied(admin_ip))
        # A request that itself carries a platform admin's session.
        for _ in range(5):
            self.exchange('/api/debug',headers=self.proxied('198.51.100.31'),client=self.admin)
        # The rule switched off.
        self.settings({'block_on_path_hits':{'enabled':False}})
        for _ in range(5):
            self.exchange('/api/admin',headers=self.proxied('198.51.100.40'))
        self.flush()
        for ip in ('127.0.0.1',admin_ip,'198.51.100.31','198.51.100.40'):
            self.assertIsNone(self.block_of(ip),ip)
        self.assertEqual(self.total('honeypot_path',ip=admin_ip),5)
        # Once the admin has signed out, their address is no longer spared.
        self.settings({'block_on_path_hits':{'enabled':True,'hits':1}})
        self.ok(self.admin,'/api/logout',{})
        self.exchange('/api/admin',headers=self.proxied(admin_ip))
        self.flush()
        self.assertTrue(self.block_of(admin_ip))

    # 1b. Hidden form fields
    def test_hidden_fields_refuse_with_the_normal_answer_and_never_lock(self):
        self.customer_mail()
        self.create_member(email='agent@example.com')
        self.create_member(email='staff@example.com')
        self.customer(email='visitor@example.com')
        self.customer(email='client@example.com')
        mails = len(self.mailer.call_args_list)
        wrong = self.exchange('/api/sign-in',{'email':'agent@example.com','password':'Wrong-password-000'})
        self.assertEqual(wrong[0],401)
        for field in ('website','company_website'):
            for _ in range(6):
                trapped = self.exchange('/api/sign-in',{'email':'agent@example.com','password':PASSWORD,field:'https://spam.example'})
                self.assertEqual(trapped,wrong)
        self.assertEqual(json.loads(wrong[2]),{'error':WRONG_LOGIN})
        # The trapped attempts never counted: the right password still signs in after twelve of them.
        self.assertEqual(self.lock_row('signin:agent@example.com')['failures'],1)
        self.assertEqual(self.exchange('/api/sign-in',{'email':'agent@example.com','password':PASSWORD})[0],200)
        # (Each form with its own email here: events of one address and email in the same minute share a row.)
        self.assertEqual(self.exchange('/api/login',{'email':'staff@example.com','password':PASSWORD,'website':'x'}),
                         self.exchange('/api/login',{'email':'staff@example.com','password':'Wrong-password-000'}))
        self.assertEqual(self.exchange('/api/customer/login',{'email':'client@example.com','password':CUSTOMER_PASSWORD,'website':'x'}),
                         self.exchange('/api/customer/login',{'email':'client@example.com','password':'Wrong-password-000'}))
        # A form that fails its own checks answers as before.
        self.assertEqual(self.exchange('/api/sign-in',{'email':'not-an-email','password':PASSWORD,'website':'x'}),
                         self.exchange('/api/sign-in',{'email':'not-an-email','password':PASSWORD}))
        # While the email is locked, the trapped attempt gets the lock's answer too.
        for _ in range(5):
            self.exchange('/api/sign-in',{'email':'locked@example.com','password':'Wrong-password-000'})
        status,_,content = self.exchange('/api/sign-in',{'email':'locked@example.com','password':'Wrong-password-000','website':'x'})
        self.assertEqual((status,json.loads(content)['error'].startswith(security_round.LOCK_TEXT)),(429,True))
        # Staff registration: the usual "link sent", nothing stored or sent.
        form = self.registration(website='https://spam.example')
        status,_,content = self.exchange('/api/register',form)
        self.assertEqual((status,json.loads(content)),(202,{'ok':True,'verification_required':True}))
        with D.control() as cd:
            self.assertIsNone(D.one(cd,'SELECT 1 FROM pending_registrations'))
        self.assertEqual(self.exchange('/api/register',self.registration(email='bad',website='x'))[0],400)
        # Customer registration and forgotten password.
        status,_,content = self.exchange('/api/customer/register',{'name':'บอท','email':'bot@example.com','password':CUSTOMER_PASSWORD,
                                                                   'consent':True,'website':'x'})
        self.assertEqual((status,json.loads(content)),(202,{'ok':True,'verification_required':True}))
        self.assertEqual(self.exchange('/api/customer/forgot',{'email':'visitor@example.com','company_website':'x'}),
                         self.exchange('/api/customer/forgot',{'email':'nobody@example.com'}))
        self.assertEqual(len(self.mailer.call_args_list),mails)
        self.assertEqual({e['subject'] for e in self.events_of('password_reset_requested')},{'nobody@example.com'})
        with D.control() as cd:
            self.assertIsNone(D.one(cd,"SELECT 1 FROM customer_signups WHERE email='bot@example.com'"))
        # Guest chat: the usual spam message, no chat.
        guest = self.exchange('/api/public/alpha/guest/conversations',{'body':'สวัสดี','started_ms':0,'website':'x'})
        self.assertEqual((guest[0],json.loads(guest[2])),(400,{'error':SPAM}))
        self.assertEqual(self.exchange('/api/public/alpha/guest/conversations',{'body':'สวัสดี','started_ms':0,'company_website':'x'})[0],400)
        forms = self.events_of('honeypot_form')
        self.assertEqual({e['detail']['form'] for e in forms},{'sign_in','staff_sign_in','customer_sign_in','staff_register','customer_register',
                                                               'customer_forgot','guest_chat'})
        self.assertEqual(sum(e['count'] for e in forms if e['detail']['form']=='sign_in'),13)
        guest_event = next(e for e in forms if e['detail']['form']=='guest_chat')
        self.assertEqual((guest_event['actor'],guest_event['tenant_id']),('guest',self.org))
        self.assertEqual({e['severity'] for e in forms},{'warning'})
        # Switched off: the field is ignored (guest chat keeps its own spam check).
        self.settings({'forms_enabled':False})
        self.assertEqual(self.exchange('/api/sign-in',{'email':'agent@example.com','password':PASSWORD,'website':'x'})[0],200)

    # 2. Honeytokens
    def test_honeytoken_create_returns_the_secret_once_and_stores_only_its_hash(self):
        self.assertEqual(self.ok(self.admin,f'{SEC}/honeytokens'),{'tokens':[]})
        for body in ({'kind':'nope','label':'x'},{'kind':'api_key'},{'kind':'api_key','label':''},{'kind':'api_key','label':'x'*101},
                     {'kind':'api_key','label':'x','placed_at_note':'y'*301}):
            self.assertEqual(self.admin.call(f'{SEC}/honeytokens',body)[0],400,body)
        created = {kind:self.plant(kind,label=f'กับดัก {kind}') for kind in model.HONEYTOKEN_KINDS}
        token,key = created['api_key']
        self.assertRegex(key,r'^bdk_live_[A-Za-z0-9]{40}$')
        self.assertEqual((token['kind'],token['label'],token['placed_at_note'],token['enabled'],token['trigger_count'],token['created_by']),
                         ('api_key','กับดัก api_key','ไฟล์ backup.txt บนไดรฟ์ทีม',True,0,'admin@example.com'))
        self.assertEqual(token['preview'],key[:12]+'…')
        password = created['password'][1]
        self.assertTrue(len(password)>=16 and re.search(r'[A-Z]',password) and re.search(r'[0-9]',password),password)
        link = created['link'][1]
        self.assertRegex(link,rf'^http://127\.0\.0\.1:{self.server.server_port}/files/[A-Za-z0-9_-]{{32}}$')
        email = created['decoy_account'][1]
        self.assertRegex(email,r'^[a-z.-]+@example\.com$')
        self.assertEqual(created['decoy_account'][0]['decoy_email'],email)
        with D.control() as cd:
            rows = D.rows(cd,'SELECT * FROM honeytokens')
            stored = json.dumps(rows)
            everything = json.dumps(D.rows(cd,'SELECT * FROM security_events')+D.rows(cd,'SELECT * FROM audit_logs'),ensure_ascii=False)
        for secret in (key,password,link.rsplit('/',1)[1]):
            self.assertNotIn(secret,stored)
            self.assertNotIn(secret,everything)
        hashes = {r['kind']:r['secret_hash'] for r in rows}
        self.assertEqual(hashes,{'api_key':sha256(key),'password':sha256(password),'link':sha256(link.rsplit('/',1)[1]),'decoy_account':sha256(email)})
        listed = self.ok(self.admin,f'{SEC}/honeytokens')['tokens']
        self.assertEqual(len(listed),4)
        self.assertEqual(set(listed[0]),{'id','kind','label','placed_at_note','decoy_email','preview','enabled','created_at','created_by',
                                         'trigger_count','last_triggered_at','last_ip'})
        listing = json.dumps(listed)
        for secret in (key,password,link):
            self.assertNotIn(secret,listing)
        # With the platform's public address set, links and decoy emails use it.
        self.enable_registration_mail()
        self.assertTrue(self.plant('link')[1].startswith('https://bookdose.example.com/files/'))
        self.assertTrue(self.plant('decoy_account')[1].endswith('@bookdose.example.com'))
        # Change and delete.
        changed = self.ok(self.admin,f"{SEC}/honeytokens/{token['id']}",{'label':'คีย์ในไฟล์ .env เก่า','enabled':False},'PATCH')['token']
        self.assertEqual((changed['label'],changed['enabled'],changed['placed_at_note']),('คีย์ในไฟล์ .env เก่า',False,token['placed_at_note']))
        for body in ({},{'enabled':'no'},{'label':''}):
            self.assertEqual(self.admin.call(f"{SEC}/honeytokens/{token['id']}",body,'PATCH')[0],400,body)
        self.assertEqual(self.admin.call(f"{SEC}/honeytokens/{'0'*32}",{'label':'x'},'PATCH')[0],404)
        self.assertEqual(self.ok(self.admin,f"{SEC}/honeytokens/{token['id']}",None,'DELETE'),{'ok':True})
        self.assertEqual(self.admin.call(f"{SEC}/honeytokens/{token['id']}",None,'DELETE')[0],404)
        self.assertEqual(len(self.ok(self.admin,f'{SEC}/honeytokens')['tokens']),5)
        changed = [e for e in self.events_of('security_settings_changed') if 'honeytoken' in e['detail']]
        self.assertTrue(changed and all(e['severity']=='critical' and e['subject']=='admin@example.com' for e in changed))
        self.assertEqual(sum(e['count'] for e in changed),8)
        with D.control() as cd:
            self.assertEqual(cd.execute("SELECT COUNT(*) FROM audit_logs WHERE action LIKE 'security.honeytoken_%'").fetchone()[0],8)

    def test_decoy_account_triggers_on_sign_in_reset_and_invite(self):
        self.enable_registration_mail()
        token,email = self.plant('decoy_account',label='บัญชีสำรอง IT')
        self.create_member(email='agent@example.com')
        # Sign-in (any endpoint, any password): the answer an unknown email gets. Each from its own address, as the
        # address is blocked right after its answer.
        for index,path in enumerate(('/api/sign-in','/api/login','/api/customer/login','/api/sign-in')):
            self.assertEqual(self.exchange(path,{'email':email.upper() if index else email,'password':'Whatever-123'},headers=self.proxied(f'203.0.113.{54+index}')),
                             self.exchange(path,{'email':'nobody@bookdose.example.com','password':'Whatever-123'},headers=self.proxied('203.0.113.49')),path)
            self.flush()
        found = self.triggers(token['id'])
        self.assertEqual({(e['count'],e['severity'],e['ip'],e['subject'],e['actor']) for e in found},
                         {(1,'critical',f'203.0.113.{54+i}',email,'anonymous') for i in range(4)})
        self.assertEqual(found[0]['detail'],{'token_id':token['id'],'kind':'decoy_account','label':'บัญชีสำรอง IT','where':'sign_in'})
        row = self.token_row(token['id'])
        self.assertEqual((row['trigger_count'],row['last_ip']),(4,'203.0.113.57'))
        # One open alert per token and address, updated while it goes on.
        with patch.object(traps,'exempt',return_value=True):
            self.exchange('/api/sign-in',{'email':email,'password':'x'},headers=self.proxied('203.0.113.49'))
            self.exchange('/api/login',{'email':email,'password':'x'},headers=self.proxied('203.0.113.49'))
            self.flush()
        alerts = [a for a in self.ok(self.admin,f'{SEC}/alerts?open=1')['alerts'] if a['rule']=='honeytoken']
        self.assertEqual(sorted((a['ip'],a['severity'],a['count'],a['detail']['token_id']) for a in alerts),
                         sorted([('203.0.113.49','critical',2,token['id'])]+[(f'203.0.113.{54+i}','critical',1,token['id']) for i in range(4)]))
        self.assertIsNone(self.block_of('203.0.113.49'))
        # One email per token per hour; the address blocked for 24 hours.
        self.assertEqual(alerts[0]['label'],model.ALERT_LABELS['honeytoken'])
        self.assertEqual([c.args[2] for c in self.trap_mails()],['admin@example.com'])
        self.assertIn('บัญชีสำรอง IT',self.trap_mails()[0].args[3].get_content())
        block = self.block_of('203.0.113.54')
        self.assertEqual((block['reason'],block['created_by']),('กับดัก: บัญชีสำรอง IT',model.TRAP_BLOCKER))
        self.assertTrue(security_round.after(hours=23)<block['expires_at']<=security_round.after(hours=24))
        self.assertEqual(self.exchange('/api/bootstrap',headers=self.proxied('203.0.113.54'))[0],403)
        # Password reset.
        self.assertEqual(self.exchange('/api/customer/forgot',{'email':email},headers=self.proxied('203.0.113.51')),
                         self.exchange('/api/customer/forgot',{'email':'nobody@bookdose.example.com'},headers=self.proxied('203.0.113.52')))
        # A staff member inviting it (an insider): recorded with who and where, not signed out.
        manager,_ = self.create_member(role='admin',email='manager@example.com')
        status,_ = manager.call('/api/members',{'name':'สำรอง','email':email,'password':PASSWORD,'role':'agent','team_id':self.team},
                                headers=self.proxied('203.0.113.53'))
        self.assertEqual(status,200)
        self.flush()
        where = {e['detail']['where']:e for e in self.triggers(token['id'])}
        self.assertEqual(set(where),{'sign_in','password_reset','invite'})
        invite = where['invite']
        self.assertEqual((invite['actor'],invite['subject'],invite['tenant_id'],invite['detail']['user_email']),
                         ('staff','manager@example.com',self.org,'manager@example.com'))
        self.assertEqual(manager.call('/api/tickets')[0],200)
        self.assertEqual(len(self.trap_mails()),1)
        self.assertEqual(self.token_row(token['id'])['trigger_count'],8)
        cards = self.ok(self.admin,f'{SEC}/overview')['cards']
        self.assertEqual(cards['honeytoken_triggers'],8)

    def test_api_key_triggers_in_header_cookie_query_and_json_body(self):
        token,key = self.plant('api_key',label='คีย์ในไฟล์ .env')
        other = 'bdk_live_'+'A'*40
        places = (('authorization',lambda k:('/api/tickets',None,{'Authorization':f'Bearer {k}'})),
                  ('x_api_key',lambda k:('/api/v1/users/me',None,{'X-API-Key':k})),
                  ('cookie',lambda k:('/api/bootstrap',None,{'Cookie':f'api_key={k}'})),
                  ('query',lambda k:(f'/api/customer/faq?api_key={k[:10]}%{ord(k[10]):02X}{k[11:]}',None,{})),
                  ('json_body',lambda k:('/api/sign-in',{'email':'a@example.com','password':'x','note':f'key: {k}'},{})))
        for index,(where,request) in enumerate(places):
            ip = f'203.0.113.{60+index}'
            path,body,headers = request(key)
            real = self.exchange(path,body,headers={**self.proxied(ip),**headers})
            path,body,headers = request(other)
            self.assertEqual(real,self.exchange(path,body,headers={**self.proxied('203.0.113.99'),**headers}),where)
        self.flush()
        found = self.triggers(token['id'])
        self.assertEqual({(e['detail']['where'],e['ip']) for e in found},{(w,f'203.0.113.{60+i}') for i,(w,_) in enumerate(places)})
        for index in range(len(places)):
            self.assertTrue(self.block_of(f'203.0.113.{60+index}'))
        self.assertIsNone(self.block_of('203.0.113.99'))
        # A body over 1 MB is not searched.
        self.exchange('/api/sign-in',{'email':'a@example.com','password':'x','note':'x'*(1024*1024)+key},headers=self.proxied('203.0.113.70'))
        self.flush()
        self.assertIsNone(self.block_of('203.0.113.70'))
        self.assertEqual(self.token_row(token['id'])['trigger_count'],5)
        # From loopback: recorded, never blocked. With a platform admin's session: never blocked either.
        self.exchange('/api/tickets',headers={'Authorization':f'Bearer {key}'})
        self.exchange('/api/tickets',headers={**self.proxied('203.0.113.71'),'X-API-Key':key},client=self.admin)
        self.flush()
        self.assertIsNone(self.block_of('127.0.0.1'))
        self.assertIsNone(self.block_of('203.0.113.71'))
        insider = next(e for e in self.triggers(token['id']) if e['ip']=='203.0.113.71')
        self.assertEqual((insider['actor'],insider['detail']['user_email']),('platform','admin@example.com'))
        # The block setting switched off.
        self.settings({'block_on_honeytoken':{'enabled':False}})
        self.exchange('/api/tickets',headers={**self.proxied('203.0.113.72'),'X-API-Key':key})
        self.flush()
        self.assertIsNone(self.block_of('203.0.113.72'))
        self.assertEqual(self.token_row(token['id'])['trigger_count'],8)

    def test_password_and_link_trigger(self):
        token,password = self.plant('password',label='รหัสผ่านแอดมินสำรอง')
        self.create_member(email='agent@example.com')
        for index,path in enumerate(('/api/sign-in','/api/login','/api/customer/login')):
            for offset,email in enumerate(('agent@example.com','ghost@example.com')):
                ip = f'203.0.113.{80+2*index+offset}'
                self.assertEqual(self.exchange(path,{'email':email,'password':password},headers=self.proxied(ip)),
                                 self.exchange(path,{'email':email,'password':password[:-1]+'?'},headers=self.proxied('203.0.113.99')),(path,email))
        # Only as a password on a sign-in endpoint.
        self.exchange('/api/customer/register',{'name':'ทดสอบ','email':'new@example.com','password':password,'consent':True},headers=self.proxied('203.0.113.90'))
        self.flush()
        found = self.triggers(token['id'])
        self.assertEqual(sum(e['count'] for e in found),6)
        self.assertEqual({e['detail']['where'] for e in found},{'sign_in'})
        self.assertEqual({e['ip'] for e in found},{f'203.0.113.{n}' for n in range(80,86)})
        self.assertIsNone(self.block_of('203.0.113.99'))
        link_token,link = self.plant('link',label='รหัสผ่านระบบสำรอง.pdf')
        status,_,content = self.report('/files/'+link.rsplit('/',1)[1],ip='203.0.113.95')
        self.assertEqual((status,content),(204,b''))
        self.report('/files/'+link.rsplit('/',1)[1]+'/',ip='203.0.113.96')
        self.flush()
        found = self.triggers(link_token['id'])
        self.assertEqual({(e['detail']['where'],e['ip']) for e in found},{('link','203.0.113.95'),('link','203.0.113.96')})
        self.assertTrue(self.block_of('203.0.113.95'))
        self.assertEqual(self.events_of('honeypot_path'),[])

    def test_disabled_token_and_the_test_button(self):
        self.enable_registration_mail()
        token,key = self.plant('api_key')
        self.ok(self.admin,f"{SEC}/honeytokens/{token['id']}",{'enabled':False},'PATCH')
        self.exchange('/api/tickets',headers={**self.proxied('203.0.113.40'),'X-API-Key':key})
        self.flush()
        self.assertEqual(self.triggers(),[])
        self.assertIsNone(self.block_of('203.0.113.40'))
        self.assertEqual(self.ok(self.admin,f"{SEC}/honeytokens/{token['id']}/test",{}),{'ok':True})
        self.assertEqual(self.admin.call(f"{SEC}/honeytokens/{'0'*32}/test",{})[0],404)
        tests = self.events_of('honeytoken_triggered')
        self.assertEqual([(e['severity'],e['detail']['test'],e['detail']['token_id'],e['actor']) for e in tests],[('info',True,token['id'],'platform')])
        self.assertEqual(self.token_row(token['id'])['trigger_count'],0)
        self.assertEqual([a for a in self.ok(self.admin,f'{SEC}/alerts?open=1')['alerts'] if a['rule']=='honeytoken'],[])
        self.assertEqual(self.ok(self.admin,f'{SEC}/ip-blocks')['blocks'],[])
        self.assertEqual(self.trap_mails(),[])
        self.assertEqual(self.ok(self.admin,f'{SEC}/overview')['cards']['honeytoken_triggers'],0)
        # Enabled again, it triggers.
        self.ok(self.admin,f"{SEC}/honeytokens/{token['id']}",{'enabled':True},'PATCH')
        self.exchange('/api/tickets',headers={**self.proxied('203.0.113.41'),'X-API-Key':key})
        self.flush()
        self.assertEqual(len(self.triggers()),1)
        self.assertEqual(self.ok(self.admin,f'{SEC}/overview')['cards']['honeytoken_triggers'],1)
        # The filters know the new kinds.
        for kind in model.TRAP_EVENT_KINDS:
            self.assertEqual(self.admin.call(f'{SEC}/events?kind={kind}')[0],200)

    def test_trap_endpoints_are_platform_only(self):
        manager,_ = self.create_member(role='admin',email='manager@example.com')
        token,_ = self.plant('api_key')
        calls = (('GET','/honeytokens',None),('POST','/honeytokens',{'kind':'api_key','label':'x'}),
                 ('PATCH',f"/honeytokens/{token['id']}",{'enabled':False}),('DELETE',f"/honeytokens/{token['id']}",None),
                 ('POST',f"/honeytokens/{token['id']}/test",{}),('POST','/settings',{'honeypot':{'paths_enabled':False}}))
        for method,path,body in calls:
            self.assertEqual(manager.call(SEC+path,body,method)[0],403,path)
            self.assertEqual(Client(self.base).call(SEC+path,body,method)[0],401,path)
        self.assertEqual(len(self.ok(self.admin,f'{SEC}/honeytokens')['tokens']),1)
        self.assertTrue(self.ok(self.admin,f'{SEC}/settings')['honeypot']['paths_enabled'])

    def test_real_users_are_not_trapped(self):
        self.customer_mail()
        for kind in model.HONEYTOKEN_KINDS:
            self.plant(kind)
        self.settings({'custom_api_paths':[{'path':'/api/old-admin','match':'prefix'}]})
        agent,_ = self.create_member(email='agent@example.com')
        self.assertEqual(self.exchange('/api/sign-in',{'email':'agent@example.com','password':PASSWORD},headers=self.proxied('198.51.100.1'))[0],200)
        for path in ('/api/tickets','/api/conversations','/api/bootstrap','/api/session','/api/workspace'):
            self.assertEqual(agent.call(path,headers=self.proxied('198.51.100.1'))[0],200,path)
        visitor,conversation = base.IntegrationTests.visitor(self)
        self.ok(visitor,'/api/public/alpha/messages',{'body':'ขอบคุณครับ bdk_live_ ไม่ใช่คีย์'})
        self.assertEqual(visitor.call('/api/customer/overview')[0],200)
        rate_limit.RATES.clear()
        self.assertEqual(Client(self.base).call('/api/sign-in',{'email':'visitor@example.com','password':CUSTOMER_PASSWORD},
                                                headers=self.proxied('198.51.100.2'))[0],200)
        self.assertEqual(Client(self.base).call('/api/register',self.registration(),headers=self.proxied('198.51.100.3'))[0],202)
        self.assertEqual(Client(self.base).call('/api/customer/forgot',{'email':'visitor@example.com'},headers=self.proxied('198.51.100.3'))[0],202)
        guest = Client(self.base)
        self.assertEqual(guest.call('/api/public/alpha/guest/conversations',{'body':'สวัสดี','started_ms':0,'website':''},
                                    headers=self.proxied('198.51.100.4'))[0],201)
        self.flush()
        self.assertEqual(self.trap_events(),[])
        self.assertEqual(self.ok(self.admin,f'{SEC}/ip-blocks')['blocks'],[])
        cards = self.ok(self.admin,f'{SEC}/overview')['cards']
        self.assertEqual((cards['honeypot_hits'],cards['honeytoken_triggers']),(0,0))

    def test_settings_survive_an_upgrade_and_bad_saved_values(self):
        from backend.modules.platform import repository as platform
        with D.control() as cd:
            cd.execute('DROP TABLE honeytokens')
            platform.save_setting(cd,'security',json.dumps({'honeypot':{'paths_enabled':'no','forms_enabled':False,
                                  'custom_api_paths':[{'path':'/api/x','match':'exact'},{'path':1}],
                                  'block_on_path_hits':{'hits':'3','duration':'2h','window_minutes':20}}}))
        D.init()
        traps.invalidate()
        honeypot = self.ok(self.admin,f'{SEC}/settings')['honeypot']
        self.assertEqual(honeypot,{**model.DEFAULT_SETTINGS['honeypot'],'forms_enabled':False,'custom_api_paths':[{'path':'/api/x','match':'exact'}],
                                   'block_on_path_hits':{'enabled':True,'hits':3,'window_minutes':20,'duration':'1h'}})
        self.assertEqual(self.ok(self.admin,f'{SEC}/honeytokens'),{'tokens':[]})


if __name__=='__main__':
    unittest.main()
