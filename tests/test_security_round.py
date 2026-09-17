"""Security round (docs/SECURITY-DESIGN.md): progressive lockout after wrong sign-in secrets, idle and absolute session
limits, security events with flood control, alerts, the IP block list and the Superadmin security API. Email is
mocked and every test uses a disposable database; nothing leaves the machine."""
import datetime as dt
import json
import time
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

import test_app as base
import test_channels as channel_tests
from test_app import app, Client, D, rate_limit
from backend.modules.customer_security import totp
from backend.modules.security import alerts, blocks, events, lockout, model
from backend.utils.dates import after, iso, utc_now

LEGACY = app.settings.SERVER=='legacy'
if not LEGACY:
    from websockets.exceptions import ConnectionClosed
    from websockets.sync.client import connect
    from backend.realtime import socket as S

PASSWORD = 'Test-password-123!'
CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD
SEC = '/api/platform/security'
LOCK_TEXT = 'ลงชื่อเข้าใช้ผิดหลายครั้ง กรุณาลองใหม่ในอีก'
EXPIRED_TEXT = 'หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบอีกครั้ง'


def ago(**delta):
    return after(**{k:-v for k,v in delta.items()})


class SecurityRoundTests(unittest.TestCase):
    ok = base.IntegrationTests.ok
    customer = base.IntegrationTests.customer
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    create_member = base.IntegrationTests.create_member
    configure = channel_tests.ChannelTests.configure
    CUSTOMER_PASSWORD = CUSTOMER_PASSWORD

    def setUp(self):
        base.IntegrationTests.setUp(self)
        self.addCleanup(patch.stopall)
        blocks.invalidate()
        events._minute.update(key=None,rows=0)

    def tearDown(self):
        base.IntegrationTests.tearDown(self)

    # Helpers
    def raw(self, client, path, body=None, method=None, headers=None):
        """(status, JSON, response headers) as the browser gets them."""
        hs = {'X-CSRF-Token':client.csrf,'X-Tenant-ID':client.tenant,'X-Customer-CSRF':client.customer_csrf}
        if body is not None:
            hs['Content-Type'] = 'application/json'
        hs.update(headers or {})
        request = urllib.request.Request(self.base+path,data=None if body is None else json.dumps(body).encode(),headers=hs,
                                         method=method or ('GET' if body is None else 'POST'))
        try:
            response = client.opener.open(request,timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status,json.loads(response.read()),response.headers

    def staff_login(self, email, password=PASSWORD, client=None):
        client = client or Client(self.base)
        return client,client.call('/api/login',{'email':email,'password':password})

    def fail_logins(self, email, times, path='/api/login', password='Wrong-password-000'):
        rate_limit.RATES.clear()
        answers = [Client(self.base).call(path,{'email':email,'password':password}) for _ in range(times)]
        rate_limit.RATES.clear()
        return answers

    def lock_row(self, key):
        with D.control() as cd:
            return D.one(cd,'SELECT * FROM login_failures WHERE key=?',(key,))

    def update_lock(self, key, **values):
        with D.control() as cd:
            cd.execute('UPDATE login_failures SET '+','.join(f'{k}=?' for k in values)+' WHERE key=?',(*values.values(),key))

    def staff_session(self, email, **values):
        with D.control() as cd:
            if values:
                cd.execute('UPDATE sessions SET '+','.join(f'{k}=?' for k in values)+' WHERE user_id=(SELECT id FROM users WHERE email=?)',
                           (*values.values(),email))
            return D.rows(cd,'SELECT s.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.email=?',(email,))

    def customer_session(self, email, **values):
        with D.control() as cd:
            if values:
                cd.execute('UPDATE customer_sessions SET '+','.join(f'{k}=?' for k in values)+
                           ' WHERE account_id=(SELECT id FROM customer_accounts WHERE email=?)',(*values.values(),email))
            return D.rows(cd,'SELECT s.* FROM customer_sessions s JOIN customer_accounts a ON a.id=s.account_id WHERE a.email=?',(email,))

    def events_of(self, kind, **filters):
        query = '&'.join(f'{k}={v}' for k,v in {'kind':kind,'limit':200,**filters}.items())
        return self.ok(self.admin,f'{SEC}/events?{query}')['events']

    def total(self, kind, **filters):
        return sum(e['count'] for e in self.events_of(kind,**filters))

    def wait_for(self, condition, timeout=5):
        deadline = time.monotonic()+timeout
        while not condition():
            if time.monotonic()>deadline:
                return False
            time.sleep(0.05)
        return True

    def lock_mails(self):
        return [c for c in self.mailer.call_args_list if c.args[3]['Subject']=='มีการพยายามเข้าสู่ระบบบัญชีของคุณ']

    # 1. Progressive lockout
    def test_lockout_progression_levels_and_decay(self):
        self.create_member(email='agent@example.com')
        key = 'staff:agent@example.com'
        answers = self.fail_logins('agent@example.com',5)
        self.assertEqual([s for s,_ in answers],[401]*5)
        row = self.lock_row(key)
        self.assertEqual((row['level'],row['failures']),(1,0))
        status,data,headers = self.raw(Client(self.base),'/api/login',{'email':'agent@example.com','password':PASSWORD})
        self.assertEqual(status,429)
        self.assertTrue(data['error'].startswith(LOCK_TEXT) and data['error'].endswith('5 นาที'),data)
        self.assertTrue(290<=data['retry_after']<=300,data)
        self.assertEqual(headers['Retry-After'],str(data['retry_after']))
        # The lock ends by itself; the next five failures lock for 15 minutes (level 2), then 1 hour, then 24 hours.
        for level,seconds in ((2,900),(3,3600),(4,86400),(5,86400)):
            self.update_lock(key,locked_until=ago(seconds=1))
            self.fail_logins('agent@example.com',5)
            row = self.lock_row(key)
            self.assertEqual(row['level'],level)
            left = lockout.remaining_seconds(row)
            self.assertTrue(seconds-10<=left<=seconds,(level,left))
        # One level less for every 24 hours without a new lock: level 5 two days ago decays to 3, so the next lock is 4.
        self.update_lock(key,locked_until=ago(hours=47),locked_at=ago(hours=48,seconds=5))
        self.assertEqual(lockout.effective_level(self.lock_row(key)),3)
        self.fail_logins('agent@example.com',5)
        self.assertEqual(self.lock_row(key)['level'],4)
        # Five failures spread over more than 15 minutes never lock.
        self.create_member(email='slow@example.com')
        for _ in range(3):
            self.fail_logins('slow@example.com',2)
            self.update_lock('staff:slow@example.com',window_start=ago(minutes=16))
        self.assertIsNone(self.lock_row('staff:slow@example.com')['locked_until'])
        self.assertEqual(self.staff_login('slow@example.com')[1][0],200)
        self.assertEqual([lockout.lock_seconds(n) for n in (1,2,3,4,9)],[300,900,3600,86400,86400])

    def test_locked_answer_is_identical_for_unknown_email(self):
        self.create_member(email='agent@example.com')
        known = self.fail_logins('agent@example.com',6)
        unknown = self.fail_logins('nobody@example.com',6)
        self.assertEqual([s for s,_ in known],[401]*5+[429])
        self.assertEqual(known[:5],unknown[:5])
        self.assertEqual(unknown[5][0],429)
        self.assertEqual(set(known[5][1]),{'error','retry_after'})
        self.assertEqual(set(unknown[5][1]),{'error','retry_after'})
        self.assertEqual(known[5][1]['error'],unknown[5][1]['error'])
        self.assertLessEqual(abs(known[5][1]['retry_after']-unknown[5][1]['retry_after']),5)
        # Customers: the same.
        self.customer_mail()
        self.customer(email='visitor@example.com')
        known = self.fail_logins('visitor@example.com',6,'/api/customer/login')
        unknown = self.fail_logins('ghost@example.com',6,'/api/customer/login')
        self.assertEqual([s for s,_ in known],[401]*5+[429])
        self.assertEqual([s for s,_ in unknown],[401]*5+[429])
        self.assertEqual(known[0],unknown[0])
        self.assertEqual(known[5][1]['error'],unknown[5][1]['error'])
        # The owner of a real account is emailed about the lock once; an unknown email gets nothing.
        self.assertTrue(self.wait_for(lambda:len(self.lock_mails())==1))
        mail = self.lock_mails()[0]
        self.assertEqual(mail.args[2],'visitor@example.com')
        text = mail.args[3].get_content()
        self.assertIn('127.0.0.xxx',text)
        self.assertNotIn('Wrong-password',text)
        self.update_lock('customer:visitor@example.com',locked_until=ago(seconds=1))
        self.fail_logins('visitor@example.com',5,'/api/customer/login')
        time.sleep(0.5)
        self.assertEqual(len(self.lock_mails()),1)
        # An account whose email was never proven is not told: the address may be someone else's.
        self.customer(email='unproven@example.com')
        with D.control() as cd:
            cd.execute("UPDATE customer_accounts SET email_verified=0 WHERE email='unproven@example.com'")
        self.fail_logins('unproven@example.com',6,'/api/customer/login')
        time.sleep(0.8)
        self.assertEqual([m.args[2] for m in self.lock_mails()],['visitor@example.com'])

    def test_attempts_during_a_lock_do_not_extend_it(self):
        self.create_member(email='agent@example.com')
        key = 'staff:agent@example.com'
        self.fail_logins('agent@example.com',5)
        before = self.lock_row(key)
        for password in (PASSWORD,'Wrong-password-000',PASSWORD):
            rate_limit.RATES.clear()
            self.assertEqual(self.staff_login('agent@example.com',password)[1][0],429)
        after_row = self.lock_row(key)
        self.assertEqual((after_row['locked_until'],after_row['failures'],after_row['level']),
                         (before['locked_until'],before['failures'],before['level']))

    def test_success_clears_failures_but_not_level(self):
        self.create_member(email='agent@example.com')
        key = 'staff:agent@example.com'
        self.fail_logins('agent@example.com',5)
        self.update_lock(key,locked_until=ago(seconds=1))
        self.fail_logins('agent@example.com',4)
        self.assertEqual(self.lock_row(key)['failures'],4)
        rate_limit.RATES.clear()
        self.assertEqual(self.staff_login('agent@example.com')[1][0],200)
        row = self.lock_row(key)
        self.assertEqual((row['failures'],row['window_start'],row['locked_until'],row['level']),(0,None,None,1))
        self.assertEqual(self.total('login_after_lock'),1)
        # A fifth failure is needed again from zero.
        self.fail_logins('agent@example.com',4)
        rate_limit.RATES.clear()
        self.assertEqual(self.staff_login('agent@example.com')[1][0],200)

    def test_password_reset_clears_the_lock(self):
        self.customer_mail()
        self.customer(email='visitor@example.com')
        self.fail_logins('visitor@example.com',5,'/api/customer/login')
        rate_limit.RATES.clear()
        self.assertEqual(Client(self.base).call('/api/customer/login',{'email':'visitor@example.com','password':CUSTOMER_PASSWORD})[0],429)
        visitor = Client(self.base)
        self.assertEqual(visitor.call('/api/customer/forgot',{'email':'visitor@example.com'})[0],202)
        self.assertEqual(visitor.call('/api/customer/forgot',{'email':'nobody@example.com'})[0],202)
        self.ok(visitor,'/api/customer/reset',{'token':self.mail_link('reset'),'password':'New-customer-pass-1'})
        self.assertIsNone(self.lock_row('customer:visitor@example.com')['locked_until'])
        rate_limit.RATES.clear()
        self.ok(Client(self.base),'/api/customer/login',{'email':'visitor@example.com','password':'New-customer-pass-1'})
        self.assertEqual({e['subject'] for e in self.events_of('password_reset_requested')},{'visitor@example.com','nobody@example.com'})
        completed = self.events_of('password_reset_completed')
        self.assertEqual([(e['subject'],e['detail']['unlocked']) for e in completed],[('visitor@example.com',True)])

    def test_superadmin_unlock(self):
        agent,_ = self.create_member(email='agent@example.com')
        self.fail_logins('agent@example.com',5)
        self.fail_logins('nobody@example.com',5)
        locks = self.ok(self.admin,f'{SEC}/locks')['locks']
        self.assertEqual({l['key'] for l in locks},{'staff:agent@example.com','staff:nobody@example.com'})
        entry = next(l for l in locks if l['subject']=='agent@example.com')
        self.assertEqual((entry['actor'],entry['level'],entry['failures'],entry['last_ip']),('staff',1,0,'127.0.0.1'))
        self.assertEqual(self.ok(self.admin,f'{SEC}/locks/unlock',{'key':'staff:agent@example.com'}),{'ok':True})
        self.assertEqual(self.admin.call(f'{SEC}/locks/unlock',{'key':'staff:agent@example.com'})[0],404)
        self.assertEqual(self.admin.call(f'{SEC}/locks/unlock',{'key':'nonsense'})[0],400)
        rate_limit.RATES.clear()
        self.assertEqual(self.staff_login('agent@example.com')[1][0],200)
        self.assertEqual([l['subject'] for l in self.ok(self.admin,f'{SEC}/locks')['locks']],['nobody@example.com'])
        unlocked = self.events_of('admin_unlock')
        self.assertEqual((unlocked[0]['subject'],unlocked[0]['detail']['account'],unlocked[0]['actor']),
                         ('admin@example.com','agent@example.com','platform'))
        with D.control() as cd:
            self.assertTrue(D.one(cd,"SELECT 1 FROM audit_logs WHERE action='security.unlock' AND detail='staff:agent@example.com'"))

    def test_customer_two_factor_failures_count(self):
        client = self.customer(email='visitor@example.com')
        secret = self.ok(client,'/api/customer/security/totp/setup',{'password':CUSTOMER_PASSWORD})['secret']
        self.ok(client,'/api/customer/security/totp/confirm',{'code':totp.code(secret,totp.step_now())})
        with D.control() as cd:
            cd.execute('UPDATE customer_totp SET last_step=0')
        rate_limit.RATES.clear()
        waiting = Client(self.base)
        self.assertTrue(self.ok(waiting,'/api/customer/login',{'email':'visitor@example.com','password':CUSTOMER_PASSWORD})['two_factor'])
        wrong = '000000' if totp.code(secret,totp.step_now())!='000000' else '111111'
        for _ in range(4):
            self.assertEqual(waiting.call('/api/customer/login/verify',{'code':wrong})[0],403)
        self.assertEqual(self.lock_row('customer:visitor@example.com')['failures'],4)
        # The right code still works before the fifth failure, and clears the count.
        self.assertEqual(waiting.call('/api/customer/login/verify',{'code':totp.code(secret,totp.step_now())})[0],200)
        self.assertEqual(self.lock_row('customer:visitor@example.com')['failures'],0)
        with D.control() as cd:
            cd.execute('UPDATE customer_totp SET last_step=0')
        # Password failures and code failures add up.
        self.fail_logins('visitor@example.com',2,'/api/customer/login')
        second = Client(self.base)
        self.ok(second,'/api/customer/login',{'email':'visitor@example.com','password':CUSTOMER_PASSWORD})
        for _ in range(3):
            self.assertEqual(second.call('/api/customer/login/verify',{'recovery_code':'AAAAA-BBBBB'})[0],403)
        self.assertTrue(self.lock_row('customer:visitor@example.com')['locked_until'])
        rate_limit.RATES.clear()
        self.assertEqual(Client(self.base).call('/api/customer/login',{'email':'visitor@example.com','password':CUSTOMER_PASSWORD})[0],429)
        failed = self.events_of('twofa_failed')
        self.assertEqual(sum(e['count'] for e in failed),7)
        self.assertEqual({e['severity'] for e in failed},{'warning'})
        self.assertEqual(self.total('login_locked',actor='customer'),1)

    # 2. Session limits
    def test_idle_expiry_ignores_polling_but_not_activity(self):
        manager,_ = self.create_member(role='admin',email='manager@example.com')
        email = 'manager@example.com'
        self.staff_session(email,last_active_at=ago(minutes=50))
        before = self.staff_session(email)[0]['last_active_at']
        for path in ('/api/tickets','/api/bootstrap','/api/session','/api/conversations'):
            self.assertEqual(manager.call(path)[0],200,path)
        self.assertEqual(self.staff_session(email)[0]['last_active_at'],before)
        state = self.ok(manager,'/api/session')
        self.assertEqual(state['user']['email'],email)
        self.assertEqual(state['idle_expires_at'],iso(dt.datetime.fromisoformat(before)+dt.timedelta(minutes=60)))
        # The page's activity signal starts the idle time again and says when the session runs out.
        answer = self.ok(manager,'/api/session/activity',{})
        self.assertEqual(set(answer),{'idle_expires_at','absolute_expires_at'})
        self.assertGreater(self.staff_session(email)[0]['last_active_at'],before)
        self.assertGreater(answer['idle_expires_at'],after(minutes=59))
        # So does any other change (even one refused by its route).
        self.staff_session(email,last_active_at=ago(minutes=50))
        self.assertEqual(manager.call('/api/teams',{'name':'ทีมใหม่'})[0],201)
        self.assertGreater(self.staff_session(email)[0]['last_active_at'],ago(minutes=1))
        # Without either, the session ends: 401 with the reason, the row is gone and it is recorded.
        self.staff_session(email,last_active_at=ago(minutes=61))
        status,data,_ = self.raw(manager,'/api/tickets')
        self.assertEqual((status,data),(401,{'error':EXPIRED_TEXT,'reason':'idle'}))
        self.assertEqual(self.staff_session(email),[])
        self.assertEqual(manager.call('/api/tickets')[0],401)
        self.assertEqual([(e['subject'],e['detail']['reason']) for e in self.events_of('session_expired')],[(email,'idle')])
        # Customers: the same with their own endpoints (7 days idle).
        customer = self.customer(email='visitor@example.com')
        self.customer_session('visitor@example.com',last_active_at=ago(days=6))
        before = self.customer_session('visitor@example.com')[0]['last_active_at']
        for path in ('/api/customer/overview','/api/customer/account','/api/customer/organizations'):
            self.assertEqual(customer.call(path)[0],200,path)
        self.assertEqual(self.customer_session('visitor@example.com')[0]['last_active_at'],before)
        account = self.ok(customer,'/api/customer/account')
        self.assertTrue(after(hours=23)<account['idle_expires_at']<after(days=1,minutes=1),account)
        self.assertIn('absolute_expires_at',account)
        answer = self.ok(customer,'/api/customer/activity',{})
        self.assertEqual(set(answer),{'idle_expires_at','absolute_expires_at'})
        self.assertGreater(self.customer_session('visitor@example.com')[0]['last_active_at'],before)
        self.customer_session('visitor@example.com',last_active_at=ago(days=6))
        self.ok(customer,'/api/customer/profile',{'name':'ลูกค้าทดสอบ','phone':''})
        self.assertGreater(self.customer_session('visitor@example.com')[0]['last_active_at'],ago(minutes=1))
        self.customer_session('visitor@example.com',last_active_at=ago(days=7,minutes=1))
        status,data,_ = self.raw(customer,'/api/customer/account')
        self.assertEqual((status,data),(401,{'error':EXPIRED_TEXT,'reason':'idle'}))
        self.assertEqual(customer.call('/api/customer/account'),(200,{'signed_in':False}))

    @unittest.skipIf(LEGACY,'WebSocket runs only on FastAPI')
    def test_realtime_does_not_keep_a_session_alive_and_closes_4401(self):
        manager,_ = self.create_member(role='admin',email='manager@example.com')
        self.staff_session('manager@example.com',last_active_at=ago(minutes=50))
        before = self.staff_session('manager@example.com')[0]['last_active_at']
        cookie = '; '.join(f'{c.name}={c.value}' for c in manager.jar)
        with patch.object(S,'RECHECK_SECONDS',0.2):
            ws = connect(f'ws://127.0.0.1:{self.server.server_port}/api/realtime/staff',origin=self.base,
                         additional_headers={'Cookie':cookie},open_timeout=10,close_timeout=2)
            try:
                self.assertEqual(json.loads(ws.recv(timeout=5))['type'],'hello')
                ws.send(json.dumps({'type':'pong'}))
                time.sleep(0.8)
                self.assertEqual(self.staff_session('manager@example.com')[0]['last_active_at'],before)
                self.staff_session('manager@example.com',last_active_at=ago(minutes=61))
                with self.assertRaises(ConnectionClosed) as caught:
                    for _ in range(100):
                        ws.recv(timeout=10)
                self.assertEqual(caught.exception.rcvd.code,4401)
            finally:
                ws.close()
        self.assertEqual(self.staff_session('manager@example.com'),[])

    def test_absolute_expiry(self):
        manager,_ = self.create_member(role='admin',email='manager@example.com')
        self.staff_session('manager@example.com',created_at=ago(hours=12,seconds=5))
        status,data,_ = self.raw(manager,'/api/session/activity',{})
        self.assertEqual((status,data),(401,{'error':EXPIRED_TEXT,'reason':'absolute'}))
        self.assertEqual(self.staff_session('manager@example.com'),[])
        # The bootstrap of a page says why it is signed out.
        again,_ = self.staff_login('manager@example.com')
        self.staff_session('manager@example.com',created_at=ago(hours=13))
        boot = self.ok(again,'/api/bootstrap')
        self.assertEqual((boot['user'],boot['session_expired']),(None,'absolute'))
        customer = self.customer(email='visitor@example.com')
        self.customer_session('visitor@example.com',created_at=ago(days=30,seconds=5))
        status,data,_ = self.raw(customer,'/api/customer/overview')
        self.assertEqual((status,data),(401,{'error':EXPIRED_TEXT,'reason':'absolute'}))
        self.assertEqual(self.customer_session('visitor@example.com'),[])

    def test_platform_admin_sessions_have_shorter_limits(self):
        manager,_ = self.create_member(role='admin',email='manager@example.com')
        state = self.ok(self.admin,'/api/session')
        self.assertTrue(state['user']['platform_admin'])
        created = dt.datetime.fromisoformat(self.staff_session('admin@example.com')[0]['created_at'])
        self.assertLessEqual(abs((dt.datetime.fromisoformat(state['absolute_expires_at'])-created).total_seconds()-8*3600),2)
        manager_state = self.ok(manager,'/api/session')
        created = dt.datetime.fromisoformat(self.staff_session('manager@example.com')[0]['created_at'])
        self.assertLessEqual(abs((dt.datetime.fromisoformat(manager_state['absolute_expires_at'])-created).total_seconds()-12*3600),2)
        for email in ('admin@example.com','manager@example.com'):
            self.staff_session(email,last_active_at=ago(minutes=31))
        self.assertEqual(manager.call('/api/tickets')[0],200)
        self.assertEqual(self.raw(self.admin,'/api/platform/system')[1].get('reason'),'idle')
        admin,_ = self.staff_login('admin@example.com')
        self.staff_session('admin@example.com',created_at=ago(hours=8,seconds=5))
        self.staff_session('manager@example.com',created_at=ago(hours=8,seconds=5))
        self.assertEqual(manager.call('/api/tickets')[0],200)
        self.assertEqual(self.raw(admin,'/api/tickets')[1].get('reason'),'absolute')
        # Identical events in the same minute share a row.
        rate_limit.RATES.clear()
        self.admin,_ = self.staff_login('admin@example.com')
        self.admin.boot()
        self.assertEqual(self.total('session_expired',actor='platform'),2)
        self.assertEqual(self.total('session_expired',actor='staff'),0)

    def test_settings_bounds_and_effect(self):
        self.assertEqual(self.ok(self.admin,f'{SEC}/settings'),model.DEFAULT_SETTINGS)
        bad = ({'sessions':{'staff':{'idle_minutes':4}}},{'sessions':{'staff':{'absolute_hours':0}}},
               {'sessions':{'platform':{'absolute_hours':2161}}},{'sessions':{'staff':{'idle_minutes':43201}}},
               {'sessions':{'staff':{'idle_minutes':180,'absolute_hours':2}}},{'sessions':{'customer':{'idle_days':31}}},
               {'sessions':{'customer':{'idle_days':10,'absolute_days':9}}},{'sessions':{'customer':{'absolute_days':91}}},
               {'sessions':{'staff':{'idle_minutes':'60'}}},{'sessions':{'staff':{'idle_minutes':30.5}}},{'sessions':[]},
               {'alerts':{'locks_1h':0}},{'alerts':{'ip_failed_logins_10m':True}})
        for body in bad:
            self.assertEqual(self.admin.call(f'{SEC}/settings',body)[0],400,body)
        self.assertEqual(self.ok(self.admin,f'{SEC}/settings'),model.DEFAULT_SETTINGS)
        saved = self.ok(self.admin,f'{SEC}/settings',{'sessions':{'staff':{'idle_minutes':5,'absolute_hours':1},'customer':{'idle_days':30,'absolute_days':30}},
                                                      'alerts':{'locks_1h':3}})
        self.assertEqual(saved['sessions']['staff'],{'idle_minutes':5,'absolute_hours':1})
        self.assertEqual(saved['sessions']['platform'],{'idle_minutes':30,'absolute_hours':8})
        self.assertEqual(saved['alerts']['locks_1h'],3)
        self.assertEqual(self.ok(self.admin,f'{SEC}/settings'),saved)
        changed = self.events_of('security_settings_changed')
        self.assertEqual((changed[0]['severity'],changed[0]['subject']),('critical','admin@example.com'))
        self.assertEqual(changed[0]['detail']['sessions']['staff'],{'idle_minutes':5,'absolute_hours':1})
        manager,_ = self.create_member(role='admin',email='manager@example.com')
        self.staff_session('manager@example.com',last_active_at=ago(minutes=6))
        self.assertEqual(self.raw(manager,'/api/tickets')[1].get('reason'),'idle')
        # A longer lifetime never lengthens a session already running (it ends when it was made to end)...
        again,_ = self.staff_login('manager@example.com')
        self.ok(self.admin,f'{SEC}/settings',{'sessions':{'staff':{'idle_minutes':60,'absolute_hours':24}}})
        self.staff_session('manager@example.com',created_at=ago(hours=2),expires_at=ago(hours=1))
        self.assertEqual(self.raw(again,'/api/tickets')[1].get('reason'),'absolute')
        # ...and a shorter one applies to it at once.
        third,_ = self.staff_login('manager@example.com')
        third.boot()
        self.assertEqual(third.call('/api/tickets')[0],200)
        self.ok(self.admin,f'{SEC}/settings',{'sessions':{'staff':{'idle_minutes':60,'absolute_hours':2}}})
        self.staff_session('manager@example.com',created_at=ago(hours=3))
        self.assertEqual(self.raw(third,'/api/tickets')[1].get('reason'),'absolute')

    def test_existing_sessions_survive_the_upgrade(self):
        with D.control() as cd:
            cd.execute('ALTER TABLE sessions DROP COLUMN last_active_at')
            cd.execute('ALTER TABLE sessions DROP COLUMN created_at')
            cd.execute('ALTER TABLE customer_sessions DROP COLUMN last_active_at')
            for table in ('login_failures','security_events','security_alerts','ip_blocks'):
                cd.execute(f'DROP TABLE {table}')
        D.init()
        D.init()
        row = self.staff_session('admin@example.com')[0]
        self.assertGreater(row['created_at'],ago(minutes=1))
        self.assertGreater(row['last_active_at'],ago(minutes=1))
        self.assertEqual(self.admin.call('/api/tickets')[0],200)
        self.assertEqual(self.admin.call('/api/session')[0],200)

    # 3. Events, alerts, blocks and the API
    def test_events_recorded_for_each_hooked_kind(self):
        self.customer_mail()
        agent,_ = self.create_member(email='agent@example.com')
        # login_failed, login_locked, login_after_lock
        self.fail_logins('agent@example.com',5)
        self.update_lock('staff:agent@example.com',locked_until=ago(seconds=1))
        rate_limit.RATES.clear()
        agent,_ = self.staff_login('agent@example.com')
        agent.boot()
        # twofa_failed, password_reset_requested / completed
        customer = self.customer(email='visitor@example.com')
        secret = self.ok(customer,'/api/customer/security/totp/setup',{'password':CUSTOMER_PASSWORD})['secret']
        self.ok(customer,'/api/customer/security/totp/confirm',{'code':totp.code(secret,totp.step_now())})
        rate_limit.RATES.clear()
        waiting = Client(self.base)
        self.ok(waiting,'/api/customer/login',{'email':'visitor@example.com','password':CUSTOMER_PASSWORD})
        self.assertEqual(waiting.call('/api/customer/login/verify',{'recovery_code':'AAAAA-BBBBB'})[0],403)
        self.assertEqual(Client(self.base).call('/api/customer/forgot',{'email':'visitor@example.com'})[0],202)
        self.assertEqual(Client(self.base).call('/api/customer/reset',{'token':self.mail_link('reset'),'password':'New-customer-pass-1'})[0],200)
        # session_expired
        self.staff_session('agent@example.com',last_active_at=ago(hours=2))
        self.assertEqual(agent.call('/api/tickets')[0],401)
        agent,_ = self.staff_login('agent@example.com')
        agent.boot()
        # sessions_revoked
        self.ok(self.admin,f'{SEC}/revoke-sessions',{'actor':'customer','subject':'visitor@example.com'})
        # rate_limited
        rate_limit.RATES.clear()
        answers = [Client(self.base).call('/api/register',{})[0] for _ in range(6)]
        self.assertEqual(answers[-1],429)
        # csrf_rejected (staff, customer, guest) and origin_rejected
        self.assertEqual(agent.call('/api/account/profile',{'name':'x'},headers={'X-CSRF-Token':'wrong'})[0],403)
        other = self.customer(email='other@example.com')
        self.assertEqual(other.call('/api/customer/profile',{'name':'x'},headers={'X-Customer-CSRF':''})[0],403)
        guest = Client(self.base)
        self.assertEqual(guest.call('/api/public/alpha/guest/conversations',{'body':'สวัสดี','started_ms':0})[0],201)
        self.assertEqual(guest.call('/api/public/alpha/guest/messages',{'body':'x'},headers={'X-Guest-CSRF':''})[0],403)
        self.assertEqual(agent.call('/api/account/profile',{'name':'x'},headers={'Origin':'https://evil.example'})[0],403)
        # cross_tenant_denied and support_access
        self.assertEqual(agent.call('/api/session/tenant',{'tenant_id':'0'*32})[0],403)
        other_org = self.ok(self.admin,'/api/platform/tenants',{'name':'องค์กร B','slug':'beta','email':'beta@example.com',
                                                                'admin_name':'ผู้ดูแล B','password':PASSWORD})['id']
        request = self.ok(self.admin,f'/api/platform/tenants/{other_org}/support-access',{'reason':'ตรวจสอบคำร้อง #1'})['id']
        beta_admin = Client(self.base)
        beta_admin.login('beta@example.com',PASSWORD)
        self.ok(beta_admin,f'/api/support-access/{request}/approve',{})
        # webhook_signature_failed
        route = self.configure()['route_id']
        self.assertEqual(Client(self.base).call('/api/webhooks/line/'+route,{'events':[]},headers={'X-Line-Signature':'bad'})[0],403)
        # guest_link_invalid
        self.assertEqual(Client(self.base).call('/api/public/alpha/guest/resume',{'token':'A'*43})[0],410)
        # admin_ip_block, ip_blocked_request, admin_unlock
        self.ok(self.admin,f'{SEC}/ip-blocks',{'ip':'203.0.113.9','reason':'ทดสอบ','duration':'1h'})
        proxied = {'X-Forwarded-Host':f'127.0.0.1:{self.server.server_port}','X-Bookdose-Client-IP':'203.0.113.9'}
        self.assertEqual(Client(self.base).call('/api/bootstrap',headers=proxied)[0],403)
        self.fail_logins('nobody@example.com',5)
        self.ok(self.admin,f'{SEC}/locks/unlock',{'key':'staff:nobody@example.com'})
        # security_settings_changed
        self.ok(self.admin,f'{SEC}/settings',{'alerts':{'locks_1h':20}})
        found = {e['kind']:e for e in self.ok(self.admin,f'{SEC}/events?limit=200')['events']}
        # The honeypot / honeytoken kinds have their own tests (test_honeypot.py).
        round_kinds = {k:v for k,v in model.EVENT_KINDS.items() if k not in model.TRAP_EVENT_KINDS}
        self.assertEqual(set(found),set(round_kinds))
        for kind,severity in round_kinds.items():
            self.assertTrue(any(e['severity']==severity for e in self.events_of(kind)),kind)
        csrf = self.events_of('csrf_rejected')
        self.assertEqual({e['actor'] for e in csrf},{'staff','customer','guest'})
        self.assertEqual(self.events_of('cross_tenant_denied')[0]['detail']['action'],'switch_tenant')
        support = self.events_of('support_access')[0]
        self.assertEqual((support['tenant_id'],support['tenant_name'],support['actor']),(other_org,'องค์กร B','platform'))
        self.assertEqual(self.events_of('support_access',tenant=other_org)[0]['id'],support['id'])
        self.assertEqual(self.events_of('webhook_signature_failed')[0]['detail']['channel'],'line')
        self.assertEqual(self.events_of('ip_blocked_request')[0]['ip'],'203.0.113.9')
        self.assertEqual(self.events_of('rate_limited')[0]['detail'],{'area':'staff','action':'register'})
        self.assertEqual(self.events_of('sessions_revoked')[0]['subject'],'visitor@example.com')
        # Never a password, a code or a token.
        with D.control() as cd:
            stored = json.dumps(D.rows(cd,'SELECT * FROM security_events'),ensure_ascii=False)
        for secret_text in (PASSWORD,CUSTOMER_PASSWORD,'Wrong-password-000','New-customer-pass-1','AAAAA','A'*43):
            self.assertNotIn(secret_text,stored)
        # Filters, search and paging.
        page = self.ok(self.admin,f'{SEC}/events?limit=3')
        self.assertEqual(len(page['events']),3)
        rest = self.ok(self.admin,f'{SEC}/events?limit=200&before={page["next_before"]}')['events']
        self.assertTrue(all(e['id']<page['next_before'] for e in rest))
        self.assertIsNone(self.ok(self.admin,f'{SEC}/events?limit=200')['next_before'])
        self.assertTrue(all(e['severity']=='critical' for e in self.ok(self.admin,f'{SEC}/events?severity=critical')['events']))
        self.assertTrue(all(e['actor']=='customer' for e in self.ok(self.admin,f'{SEC}/events?actor=customer')['events']))
        searched = self.ok(self.admin,f'{SEC}/events?q=nobody%40example')['events']
        self.assertTrue(searched and all('nobody@example.com' in e['subject']+json.dumps(e['detail']) for e in searched))
        self.assertTrue(all(e['ip']=='203.0.113.9' for e in self.ok(self.admin,f'{SEC}/events?ip=203.0.113.9')['events']))
        for query in ('kind=nope','severity=high','actor=robot','tenant=abc','before=x','limit=0','limit=201'):
            self.assertEqual(self.admin.call(f'{SEC}/events?{query}')[0],400,query)
        # The overview adds them up.
        overview = self.ok(self.admin,f'{SEC}/overview?range=24h')
        self.assertEqual(len(overview['series']),24)
        self.assertEqual(overview['cards']['failed_logins'],self.total('login_failed')+self.total('twofa_failed'))
        self.assertEqual(sum(b['failed_logins'] for b in overview['series']),overview['cards']['failed_logins'])
        self.assertEqual(overview['cards']['rate_limited'],1)
        self.assertEqual(overview['cards']['origin_csrf_rejected'],self.total('csrf_rejected')+self.total('origin_rejected'))
        self.assertEqual(overview['cards']['cross_tenant_denied'],1)
        self.assertEqual(overview['cards']['locked_now'],0)
        self.assertEqual(set(overview['cards']),{'failed_logins','locked_now','rate_limited','origin_csrf_rejected','cross_tenant_denied','open_alerts',
                                                    'honeypot_hits','honeytoken_triggers'})
        blocked_ip = next(i for i in overview['top_ips'] if i['ip']=='203.0.113.9')
        self.assertTrue(blocked_ip['blocked'])
        self.assertIn({'subject':'nobody@example.com','actor':'staff','failures':5},overview['top_subjects'])
        week = self.ok(self.admin,f'{SEC}/overview?range=7d')
        self.assertEqual(len(week['series']),28)
        self.assertEqual(week['cards']['failed_logins'],overview['cards']['failed_logins'])
        self.assertEqual(self.admin.call(f'{SEC}/overview?range=1y')[0],400)

    def test_flood_aggregation(self):
        moment = utc_now().replace(second=10,microsecond=0)
        with patch.object(events,'utc_now',return_value=moment):
            for _ in range(3):
                events.record('login_failed',actor='staff',subject='a@example.com',ip='198.51.100.1')
            events.record('login_failed',actor='staff',subject='b@example.com',ip='198.51.100.1')
            events.record('login_failed',actor='staff',subject='a@example.com',ip='198.51.100.2')
        with patch.object(events,'utc_now',return_value=moment+dt.timedelta(minutes=1)):
            events.record('login_failed',actor='staff',subject='a@example.com',ip='198.51.100.1')
        with D.control() as cd:
            rows = D.rows(cd,"SELECT subject,ip,count FROM security_events WHERE kind='login_failed' ORDER BY id")
        self.assertEqual([(r['subject'],r['ip'],r['count']) for r in rows],
                         [('a@example.com','198.51.100.1',3),('b@example.com','198.51.100.1',1),('a@example.com','198.51.100.2',1),
                          ('a@example.com','198.51.100.1',1)])
        # At most N new rows a minute; beyond that only counts (on the latest row of the kind) or nothing.
        later = moment+dt.timedelta(minutes=5)
        with patch.object(events,'utc_now',return_value=later),patch.object(model,'EVENT_ROWS_PER_MINUTE',2):
            for index in range(5):
                events.record('rate_limited',ip=f'192.0.2.{index}')
            events.record('guest_link_invalid',ip='192.0.2.99')
        with D.control() as cd:
            rows = D.rows(cd,'SELECT kind,ip,count FROM security_events WHERE at>=? ORDER BY id',(iso(later.replace(second=0)),))
        self.assertEqual([(r['kind'],r['ip'],r['count']) for r in rows],[('rate_limited','192.0.2.0',1),('rate_limited','192.0.2.1',4)])
        # Old events are cleaned up after 90 days.
        with D.control() as cd:
            cd.execute("UPDATE security_events SET at=? WHERE ip='192.0.2.0'",(ago(days=91),))
        alerts.cleanup()
        with D.control() as cd:
            self.assertIsNone(D.one(cd,"SELECT 1 FROM security_events WHERE ip='192.0.2.0'"))

    def test_alert_opening_updating_and_acknowledging(self):
        self.enable_registration_mail()
        self.ok(self.admin,f'{SEC}/settings',{'alerts':{'ip_failed_logins_10m':3,'platform_failed_logins_10m':8}})
        for index in range(3):
            events.record('login_failed',subject=f'user{index}@example.com',ip='198.51.100.7')
        self.assertEqual(len(alerts.run_rules()),1)
        opened = self.ok(self.admin,f'{SEC}/alerts?open=1')['alerts']
        self.assertEqual([(a['rule'],a['severity'],a['ip'],a['count']) for a in opened],[('ip_failed_logins','warning','198.51.100.7',3)])
        self.assertEqual(self.ok(self.admin,f'{SEC}/overview')['cards']['open_alerts'],1)
        # Still going: the same alert is updated, not a new one.
        events.record('login_failed',subject='user9@example.com',ip='198.51.100.7')
        self.assertEqual(alerts.run_rules(),[])
        again = self.ok(self.admin,f'{SEC}/alerts?open=1')['alerts']
        self.assertEqual((len(again),again[0]['id'],again[0]['count']),(1,opened[0]['id'],4))
        self.assertGreaterEqual(again[0]['last_seen_at'],opened[0]['last_seen_at'])
        self.assertEqual(self.ok(self.admin,f'{SEC}/alerts/{opened[0]["id"]}/ack',{}),{'ok':True})
        self.assertEqual(self.admin.call(f'{SEC}/alerts/999999/ack',{})[0],404)
        self.assertEqual(self.ok(self.admin,f'{SEC}/alerts?open=1')['alerts'],[])
        acknowledged = self.ok(self.admin,f'{SEC}/alerts')['alerts'][0]
        self.assertEqual(acknowledged['acknowledged_by'],'admin@example.com')
        # Acknowledged while it continues inside the same window: no new alert.
        events.record('login_failed',subject='user10@example.com',ip='198.51.100.7')
        self.assertEqual(alerts.run_rules(),[])
        # A critical rule emails the platform admins once per rule per hour.
        for index in range(3):
            events.record('login_failed',subject=f'x{index}@example.com',ip='198.51.100.8')
        opened = alerts.run_rules()
        with D.control() as cd:
            self.assertEqual({(r['rule'],r['ip']) for r in D.rows(cd,f"SELECT rule,ip FROM security_alerts WHERE id IN ({','.join(map(str,opened))})")},
                             {('platform_failed_logins',''),('ip_failed_logins','198.51.100.8')})
        critical = [a for a in self.ok(self.admin,f'{SEC}/alerts?open=1')['alerts'] if a['rule']=='platform_failed_logins']
        self.assertEqual((len(critical),critical[0]['severity']),(1,'critical'))
        mails = [c for c in self.mailer.call_args_list if c.args[3]['Subject']=='แจ้งเตือนความปลอดภัยระดับวิกฤต']
        self.assertEqual([c.args[2] for c in mails],['admin@example.com'])
        with D.control() as cd:
            cd.execute("DELETE FROM security_alerts WHERE rule='platform_failed_logins'")
        self.assertEqual(len(alerts.run_rules()),1)
        self.assertEqual(len([c for c in self.mailer.call_args_list if c.args[3]['Subject']=='แจ้งเตือนความปลอดภัยระดับวิกฤต']),1)
        # The other rules.
        self.ok(self.admin,f'{SEC}/settings',{'alerts':{'locks_1h':2,'ip_rate_limited_10m':2,'webhook_failures_10m':2}})
        for index in range(2):
            events.record('login_locked',subject=f'l{index}@example.com')
            events.record('rate_limited',ip='198.51.100.9',detail={'n':index})
            events.record('webhook_signature_failed',ip=f'198.51.100.{20+index}')
        alerts.run_rules()
        rules = {(a['rule'],a['ip']) for a in self.ok(self.admin,f'{SEC}/alerts?open=1')['alerts']}
        self.assertTrue({('locks',''),('ip_rate_limited','198.51.100.9'),('webhook_failures','')}<=rules,rules)

    def test_ip_block_http_websocket_expiry_and_own_address(self):
        port = self.server.server_port
        proxied = lambda ip:{'X-Forwarded-Host':f'127.0.0.1:{port}','X-Bookdose-Client-IP':ip}
        self.assertEqual(self.admin.call(f'{SEC}/ip-blocks',{'ip':'127.0.0.1','reason':'','duration':'1h'})[0],400)
        self.assertEqual(self.admin.call(f'{SEC}/ip-blocks',{'ip':'198.51.100.5','duration':'1h'},headers=proxied('198.51.100.5'))[0],400)
        for bad in ({'ip':'not-an-ip','duration':'1h'},{'ip':'203.0.113.9','duration':'2h'},{'ip':'203.0.113.0/24','duration':'1h'}):
            self.assertEqual(self.admin.call(f'{SEC}/ip-blocks',bad)[0],400,bad)
        answer = self.ok(self.admin,f'{SEC}/ip-blocks',{'ip':'203.0.113.9','reason':'ยิงรหัสผ่าน','duration':'24h'})
        self.assertEqual([(b['ip'],b['reason'],b['created_by']) for b in answer['blocks']],[('203.0.113.9','ยิงรหัสผ่าน','admin@example.com')])
        self.assertTrue(after(hours=23)<answer['blocks'][0]['expires_at']<=after(hours=24))
        self.ok(self.admin,f'{SEC}/ip-blocks',{'ip':'2001:DB8::1','duration':'permanent'})
        blocked = self.ok(self.admin,f'{SEC}/ip-blocks')['blocks']
        self.assertEqual({(b['ip'],b['expires_at']) for b in blocked if b['ip']=='2001:db8::1'},{('2001:db8::1',None)})
        # Checked first on every request: signed in or not, any route, even with a wrong Host.
        for path in ('/api/bootstrap','/api/login','/api/public/alpha','/api/nothing-here'):
            status,data = Client(self.base).call(path,headers=proxied('203.0.113.9'))
            self.assertEqual((status,data),(403,{'error':'ไม่สามารถเข้าถึงระบบได้จากเครือข่ายนี้'}),path)
        self.assertEqual(self.admin.call('/api/tickets',headers=proxied('2001:db8:0::1'))[0],403)
        self.assertEqual(Client(self.base).call('/api/bootstrap',headers=proxied('203.0.113.10'))[0],200)
        # A raw X-Forwarded-For from outside the web app is never believed.
        self.assertEqual(Client(self.base).call('/api/bootstrap',headers={'X-Forwarded-For':'203.0.113.9'})[0],200)
        self.assertEqual(self.total('ip_blocked_request',ip='203.0.113.9'),4)
        if not LEGACY:
            ws = connect(f'ws://127.0.0.1:{port}/api/realtime/staff',origin=f'http://127.0.0.1:{port}',
                         additional_headers=proxied('203.0.113.9'),open_timeout=10,close_timeout=2)
            with self.assertRaises(ConnectionClosed) as caught:
                ws.recv(timeout=10)
            self.assertEqual(caught.exception.rcvd.code,4403)
            self.assertEqual(self.total('ip_blocked_request',ip='203.0.113.9'),5)
        # Ends by itself.
        with D.control() as cd:
            cd.execute("UPDATE ip_blocks SET expires_at=? WHERE ip='203.0.113.9'",(ago(seconds=1),))
        blocks.invalidate()
        self.assertEqual(Client(self.base).call('/api/bootstrap',headers=proxied('203.0.113.9'))[0],200)
        self.assertEqual([b['ip'] for b in self.ok(self.admin,f'{SEC}/ip-blocks')['blocks']],['2001:db8::1'])
        # Removed by a Superadmin ({ip} in the body, or ?ip=).
        self.ok(self.admin,f'{SEC}/ip-blocks',{'ip':'203.0.113.11','duration':'7d'})
        self.assertEqual(self.ok(self.admin,f'{SEC}/ip-blocks',{'ip':'2001:db8::1'},'DELETE')['blocks'][0]['ip'],'203.0.113.11')
        self.assertEqual(self.ok(self.admin,f'{SEC}/ip-blocks?ip=203.0.113.11',None,'DELETE')['blocks'],[])
        self.assertEqual(self.admin.call(f'{SEC}/ip-blocks',{'ip':'203.0.113.11'},'DELETE')[0],404)
        self.assertEqual(Client(self.base).call('/api/bootstrap',headers=proxied('2001:db8::1'))[0],200)
        self.assertEqual(self.total('admin_ip_block'),5)
        with D.control() as cd:
            self.assertEqual(cd.execute("SELECT COUNT(*) FROM audit_logs WHERE action LIKE 'security.ip_%'").fetchone()[0],5)

    def test_every_endpoint_is_platform_only(self):
        manager,_ = self.create_member(role='admin',email='manager@example.com')
        calls = (('GET','/overview',None),('GET','/events',None),('GET','/locks',None),('POST','/locks/unlock',{'key':'staff:a@example.com'}),
                 ('GET','/alerts?open=1',None),('POST','/alerts/1/ack',{}),('GET','/ip-blocks',None),
                 ('POST','/ip-blocks',{'ip':'203.0.113.9','duration':'1h'}),('DELETE','/ip-blocks',{'ip':'203.0.113.9'}),
                 ('POST','/revoke-sessions',{'actor':'staff','subject':'admin@example.com'}),('GET','/settings',None),
                 ('POST','/settings',{'alerts':{'locks_1h':1}}))
        for method,path,body in calls:
            self.assertEqual(manager.call(SEC+path,body,method)[0],403,path)
            self.assertEqual(Client(self.base).call(SEC+path,body,method)[0],401,path)
        self.assertEqual(self.ok(self.admin,f'{SEC}/settings'),model.DEFAULT_SETTINGS)
        self.assertEqual(self.ok(self.admin,f'{SEC}/ip-blocks')['blocks'],[])
        self.assertEqual(len(self.staff_session('admin@example.com')),1)
        self.assertEqual(self.admin.call(f'{SEC}/nothing')[0],404)

    def test_revoke_sessions(self):
        first,_ = self.create_member(email='agent@example.com')
        second,_ = self.staff_login('agent@example.com')
        second.boot()
        self.assertEqual(self.ok(self.admin,f'{SEC}/revoke-sessions',{'actor':'staff','subject':'Agent@Example.com'}),{'revoked':2})
        self.assertEqual(first.call('/api/tickets')[0],401)
        self.assertEqual(second.call('/api/tickets')[0],401)
        self.assertEqual(self.ok(self.admin,f'{SEC}/revoke-sessions',{'actor':'staff','subject':'agent@example.com'}),{'revoked':0})
        customer = self.customer(email='visitor@example.com')
        self.assertEqual(self.ok(self.admin,f'{SEC}/revoke-sessions',{'actor':'customer','subject':'visitor@example.com'}),{'revoked':1})
        self.assertEqual(customer.call('/api/customer/overview')[0],401)
        self.assertEqual(self.admin.call(f'{SEC}/revoke-sessions',{'actor':'customer','subject':'ghost@example.com'})[0],404)
        self.assertEqual(self.admin.call(f'{SEC}/revoke-sessions',{'actor':'robot','subject':'agent@example.com'})[0],400)
        self.assertEqual(self.admin.call(f'{SEC}/revoke-sessions',{'actor':'staff','subject':'not an email'})[0],400)
        self.assertEqual({e['subject']:e['count'] for e in self.events_of('sessions_revoked')},{'agent@example.com':2,'visitor@example.com':1})
        # A signed-out staff member signs in again as usual.
        rate_limit.RATES.clear()
        self.assertEqual(self.staff_login('agent@example.com')[1][0],200)


if __name__=='__main__':
    unittest.main()
