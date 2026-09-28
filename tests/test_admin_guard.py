"""The platform admin's guards (security/admin_guard.py, sign_in_alerts.py): the console only with two-step sign-in or a
passkey where the server asks for it (BOOKDOSE_PLATFORM_2FA, else production), the password again before every
dangerous act (and a session signed out after five wrong ones), and the email
about a sign-in from a new device or network with its "ไม่ใช่ฉัน" link. Email is mocked; nothing leaves the machine."""
import os
import re
import unittest
from unittest.mock import patch

import test_app as base
from test_app import Client, D, rate_limit
from backend.modules.security import admin_guard, sign_in_alerts
from backend.utils.dates import after

PASSWORD = 'Test-password-123!'
# Every act that asks for the password again, with a body that would pass the form checks or fail after the guard.
DANGEROUS = [('POST','/api/platform/registration',{}),('POST','/api/platform/sms',{}),('POST','/api/platform/turnstile',{}),
             ('PATCH','/api/platform/tenants/{org}',{'status':'suspended'}),('POST','/api/platform/tenants/{org}/admins',{'email':'x@example.com'}),
             ('POST','/api/platform/admins',{'email':'x@example.com'}),('DELETE','/api/platform/admins/'+'0'*32,None),
             ('POST','/api/platform/restore',{}),('GET','/api/platform/backups/bookdose-manual-20260101-000000.zip',None),
             ('POST','/api/platform/pdpa/export',{}),('POST','/api/platform/pdpa/erase',{}),
             ('POST','/api/platform/security/settings',{})]


class AdminGuardTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    create_member = base.IntegrationTests.create_member
    enable_registration_mail = base.IntegrationTests.enable_registration_mail

    def age(self, client, minutes=10):
        """The session was signed in `minutes` ago and has not proven its password since (still in use)."""
        with D.control() as cd:
            cd.execute('UPDATE sessions SET created_at=?,confirmed_at=NULL WHERE user_id=(SELECT id FROM users WHERE email=?)',
                       (after(minutes=-minutes),client))

    def sign_in(self, email, ip, agent='Mozilla/5.0 (Windows NT 10.0) Chrome/120.0'):
        client = Client(self.base)
        rate_limit.RATES.clear()
        status,data = client.call('/api/login',{'email':email,'password':PASSWORD},
                                  headers={'X-Forwarded-Host':f'127.0.0.1:{self.server.server_port}','X-Bookdose-Client-IP':ip,'User-Agent':agent})
        self.assertEqual(status,200,data)
        client.boot()
        return client

    def test_the_switch_follows_the_environment_else_production(self):
        cases = [({'BOOKDOSE_PLATFORM_2FA':'on'},False,True),({'BOOKDOSE_PLATFORM_2FA':'off'},True,False),
                 ({'BOOKDOSE_PLATFORM_2FA':''},False,False),({'BOOKDOSE_PLATFORM_2FA':''},True,True),
                 ({'BOOKDOSE_PLATFORM_2FA':'','RENDER':'true'},False,True)]
        for environment,secure,expected in cases:
            with patch.dict(os.environ,environment),patch.object(admin_guard.settings,'SECURE_COOKIES',False):
                server = type('Server',(),{'secure_cookies':secure})()
                self.assertEqual(admin_guard.two_factor_enforced(server),expected,(environment,secure))
        # Off (this computer): a platform admin without two-step sign-in uses the console.
        self.ok(self.owner,'/api/platform/admins',{'email':'ops@example.com','admin_name':'ทีมเซิร์ฟเวอร์','password':PASSWORD})
        ops = Client(self.base)
        self.assertFalse(ops.login('ops@example.com')['user']['console_locked'])
        self.assertEqual(ops.call('/api/platform/system')[0],200)

    def test_the_console_needs_two_step_sign_in(self):
        environment = patch.dict(os.environ,{'BOOKDOSE_PLATFORM_2FA':'on'})
        environment.start()
        self.addCleanup(environment.stop)
        base.protect_account('admin@example.com')
        self.ok(self.owner,'/api/platform/admins',{'email':'ops@example.com','admin_name':'ทีมเซิร์ฟเวอร์','password':PASSWORD})
        ops = Client(self.base)
        boot = ops.login('ops@example.com')
        self.assertTrue(boot['user']['console_locked'])
        for path in ('/api/platform/system','/api/platform/tenants','/api/platform/security/overview','/api/platform/pdpa'):
            status,data = ops.call(path)
            self.assertEqual((status,data.get('reason'),data['error']),(403,admin_guard.TWO_FACTOR_REASON,admin_guard.TWO_FACTOR_REQUIRED),path)
        # Their own account settings still open, to add the second step.
        self.assertEqual(ops.call('/api/account/security')[0],200)
        self.assertEqual(ops.call('/api/account/security/sessions')[0],200)
        base.protect_account('ops@example.com')
        self.assertFalse(ops.boot()['user']['console_locked'])
        self.assertEqual(ops.call('/api/platform/system')[0],200)
        # An organization's members are held by their organization's own rule, not this one.
        self.assertFalse(self.boot['user']['console_locked'])
        self.assertEqual(self.admin.call('/api/tickets')[0],200)

    def test_dangerous_acts_ask_for_the_password_again(self):
        # Signing in counts: right after, the act goes through (here refused by its own form check, not the guard).
        self.assertNotEqual(self.owner.call('/api/platform/security/settings',{'sessions':'x'}).__getitem__(1).get('reason'),'reauth_required')
        self.age('admin@example.com')
        for method,path,body in DANGEROUS:
            status,data = self.owner.call(path.format(org=self.org),body,method)
            self.assertEqual((status,data.get('reason')),(403,admin_guard.CONFIRM_REASON),path)
        # Looking is not dangerous.
        for path in ('/api/platform/system','/api/platform/tenants','/api/platform/backups','/api/platform/security/settings'):
            self.assertEqual(self.owner.call(path)[0],200,path)
        status,data = self.owner.call('/api/account/confirm-password',{'password':'wrong-password-1'})
        self.assertEqual((status,data['error']),(403,admin_guard.WRONG))
        answer = self.ok(self.owner,'/api/account/confirm-password',{'password':PASSWORD})
        self.assertGreater(answer['confirmed_until'],after(minutes=4))
        self.ok(self.owner,'/api/platform/admins',{'email':'ops@example.com','admin_name':'ทีมเซิร์ฟเวอร์','password':PASSWORD})
        # The account's history says so; the wrong one is a security event too.
        history = [i['action'] for i in self.ok(self.owner,'/api/account/security/activity')['items']]
        self.assertIn('reauth',history)
        self.assertIn('reauth_failed',history)
        kinds = [e['kind'] for e in self.ok(self.owner,'/api/platform/security/events?limit=50')['events']]
        self.assertIn('reauth_failed',kinds)
        # Minutes later it asks again.
        self.age('admin@example.com')
        self.assertEqual(self.owner.call('/api/platform/admins',{'email':'more@example.com'})[1]['reason'],'reauth_required')

    def test_five_wrong_passwords_sign_the_session_out(self):
        self.age('admin@example.com')
        for attempt in range(admin_guard.MAX_WRONG-1):
            self.assertEqual(self.owner.call('/api/account/confirm-password',{'password':f'wrong-password-{attempt}'})[0],403)
        status,data = self.owner.call('/api/account/confirm-password',{'password':'wrong-password-last'})
        self.assertEqual((status,data['error']),(401,admin_guard.SIGNED_OUT))
        self.assertEqual(self.owner.call('/api/platform/system')[0],401)
        # The count starts again for the next session, and a right password clears it.
        again = self.sign_in('admin@example.com','127.0.0.1')
        self.age('admin@example.com')
        self.assertEqual(again.call('/api/account/confirm-password',{'password':'wrong-password-a'})[0],403)
        self.ok(again,'/api/account/confirm-password',{'password':PASSWORD})
        with D.control() as cd:
            signed_out = cd.execute("SELECT COUNT(*) FROM staff_activity WHERE action='reauth_signed_out'").fetchone()[0]
        self.assertEqual(signed_out,1)

    def test_a_sign_in_from_a_new_place_is_emailed_with_a_not_me_link(self):
        self.enable_registration_mail()
        patch.object(sign_in_alerts,'_deliver',side_effect=sign_in_alerts.send).start()
        home = self.sign_in('admin@example.com','198.51.100.4')
        sent = len(self.mailer.call_args_list)
        # The same device and network again: nothing new.
        self.sign_in('admin@example.com','198.51.100.4')
        self.assertEqual(len(self.mailer.call_args_list),sent)
        # A new network.
        stranger = self.sign_in('admin@example.com','203.0.113.77')
        self.assertEqual(len(self.mailer.call_args_list),sent+1)
        mail = self.mailer.call_args_list[-1].args[3]
        text = mail.get_content()
        self.assertEqual((mail['To'],mail['Subject']),('admin@example.com','มีการเข้าสู่ระบบบัญชีผู้ดูแลแพลตฟอร์มของคุณจากที่ใหม่'))
        self.assertIn('เครือข่ายที่ไม่เคยใช้',text)
        self.assertIn('203.0.113.77',text)
        self.assertIn('Chrome บน Windows',text)
        token = re.search(r'/not-me#t=([A-Za-z0-9_-]{43})',text)[1]
        # A new device on a known network says so.
        self.sign_in('admin@example.com','198.51.100.4',agent='Mozilla/5.0 (Macintosh; Mac OS X) Safari/605.1')
        self.assertIn('อุปกรณ์ที่ไม่เคยใช้',self.mailer.call_args_list[-1].args[3].get_content())
        # The link, opened signed out: what it is about, then the session ends.
        page = Client(self.base)
        about = self.ok(page,'/api/sign-in-alerts/check',{'token':token})
        self.assertEqual((about['ip'],about['device'],about['active']),('203.0.113.77','Chrome บน Windows',True))
        self.assertEqual(self.ok(page,'/api/sign-in-alerts/not-me',{'token':token}),{'ended':True})
        self.assertEqual(stranger.call('/api/platform/system')[0],401)
        self.assertEqual(home.call('/api/platform/system')[0],200)
        self.assertEqual(page.call('/api/sign-in-alerts/not-me',{'token':token})[0],410)
        self.assertEqual(page.call('/api/sign-in-alerts/check',{'token':'x'*43})[0],410)
        # The alarm: an open alert and a critical event in the console, a line in the account's history.
        alerts = self.ok(self.owner,'/api/platform/security/alerts')['alerts']
        self.assertIn('sign_in_disowned',[a['rule'] for a in alerts])
        event = next(e for e in self.ok(self.owner,'/api/platform/security/events?limit=50')['events'] if e['kind']=='sign_in_disowned')
        self.assertEqual((event['severity'],event['ip']),('critical','203.0.113.77'))
        self.assertIn('sign_in_disowned',[i['action'] for i in self.ok(home,'/api/account/security/activity')['items']])
        # That place is forgotten: signing in from there again is told again.
        before = len(self.mailer.call_args_list)
        self.sign_in('admin@example.com','203.0.113.77')
        self.assertEqual(len(self.mailer.call_args_list),before+1)

    def test_who_is_never_told(self):
        self.enable_registration_mail()
        patch.object(sign_in_alerts,'_deliver',side_effect=sign_in_alerts.send).start()
        sent = len(self.mailer.call_args_list)
        # A platform admin's very first sign-in has nothing to compare with.
        self.ok(self.owner,'/api/platform/admins',{'email':'ops@example.com','admin_name':'ทีมเซิร์ฟเวอร์','password':PASSWORD})
        self.sign_in('ops@example.com','203.0.113.5')
        # An organization's member is not a platform admin.
        self.sign_in('orgadmin@example.com','203.0.113.6')
        self.sign_in('orgadmin@example.com','203.0.113.8')
        self.assertEqual(len(self.mailer.call_args_list),sent)
        with D.control() as cd:
            places = cd.execute('SELECT COUNT(*) FROM staff_sign_in_places WHERE user_id=(SELECT id FROM users WHERE email=?)',
                                ('orgadmin@example.com',)).fetchone()[0]
        self.assertEqual(places,0)


if __name__ == '__main__':
    unittest.main()
