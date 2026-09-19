"""Several staff accounts on one browser, like Google's account switcher (auth/service.py): signing in while signed in
adds the account beside the one in use (password, and the second step when the account has one), switching needs
nothing more, each account signs out on its own, and every account there has the link in its own history and sees
who shares the browser in its device list."""
import unittest

import test_app as base
import test_staff_security as staff
from backend.middleware import rate_limit
from backend.modules.customer_security import totp

PASSWORD = 'Test-password-123!'


class AccountSwitcherTests(unittest.TestCase):
    # The integration suite's helpers (setUp, ok, create_member, ...), without running its tests again.
    locals().update({name:value for name,value in vars(base.IntegrationTests).items() if not name.startswith(('test','__'))})
    enable_totp = staff.StaffSecurityTests.enable_totp
    rewind = staff.StaffSecurityTests.rewind

    def member(self, email):
        return self.ok(self.admin,'/api/members',{'name':email.split('@')[0],'email':email,'password':PASSWORD,'role':'agent','team_id':self.team})['id']

    def accounts(self, client):
        return self.ok(client,'/api/accounts')['accounts']

    def activity(self, client):
        return [(item['action'],item['detail']) for item in self.ok(client,'/api/account/security/activity')['items']]

    def test_add_switch_and_sign_out_one_account(self):
        browser,_ = self.create_member(email='a@example.com')
        self.member('b@example.com')
        # Adding B while A is signed in: B is in use, A stays signed in on this browser.
        self.assertEqual(browser.login('b@example.com',PASSWORD)['user']['email'],'b@example.com')
        found = self.accounts(browser)
        self.assertEqual([(a['email'],a['active']) for a in found],[('b@example.com',True),('a@example.com',False)])
        # Switching needs no password; the account switched to has it in its history.
        self.ok(browser,'/api/accounts/switch',{'id':found[1]['id']})
        self.assertEqual(browser.boot()['user']['email'],'a@example.com')
        history = self.activity(browser)
        self.assertIn(('account_switched','จากบัญชี b@example.com'),history)
        self.assertIn(('account_linked','b@example.com เข้าสู่ระบบในเบราว์เซอร์เดียวกัน'),history)
        # The device list says who shares the browser.
        device = next(s for s in self.ok(browser,'/api/account/security/sessions')['sessions'] if s['current'])
        self.assertEqual([s['email'] for s in device['shared_with']],['b@example.com'])
        # Signing the same account in again does not make a second copy of it.
        browser.login('b@example.com',PASSWORD)
        self.assertEqual(len(self.accounts(browser)),2)
        # One account signs out on its own ...
        other = next(a for a in self.accounts(browser) if not a['active'])
        self.assertEqual([a['email'] for a in self.ok(browser,f"/api/accounts/{other['id']}/sign-out",{})['accounts']],['b@example.com'])
        # ... and signing out the one in use hands the browser to the other (or signs it out when none is left).
        browser.login('a@example.com',PASSWORD)
        self.assertTrue(self.ok(browser,'/api/logout',{})['switched'])
        self.assertEqual(browser.boot()['user']['email'],'b@example.com')
        self.assertFalse(self.ok(browser,'/api/logout',{})['switched'])
        self.assertIsNone(browser.boot()['user'])
        # Somebody else's session is never switched to.
        self.assertEqual(self.admin.call('/api/accounts/switch',{'id':other['id']})[0],404)
        self.assertEqual(self.admin.call('/api/accounts/switch',{'id':'x'})[0],400)

    def test_second_step_and_the_limit(self):
        browser,_ = self.create_member(email='a@example.com')
        guarded,_ = self.create_member(email='guarded@example.com')
        secret,_ = self.enable_totp(guarded)
        # A password alone does not add an account that asks for a second step.
        rate_limit.RATES.clear()
        status,answer = browser.call('/api/login',{'email':'guarded@example.com','password':PASSWORD})
        self.assertTrue(answer['two_factor'])
        self.assertEqual(len(self.accounts(browser)),1)
        self.assertEqual(browser.call('/api/login/verify',{'code':'000000'})[0],403)
        self.assertEqual(len(self.accounts(browser)),1)
        self.rewind()
        self.ok(browser,'/api/login/verify',{'code':totp.code(secret,totp.step_now())})
        self.assertEqual([a['email'] for a in self.accounts(browser)],['guarded@example.com','a@example.com'])
        browser.boot()
        # Five accounts at most on one browser.
        for n in range(3):
            self.member(f'x{n}@example.com')
            rate_limit.RATES.clear()
            browser.login(f'x{n}@example.com',PASSWORD)
        self.member('six@example.com')
        rate_limit.RATES.clear()
        self.assertEqual(browser.call('/api/login',{'email':'six@example.com','password':PASSWORD})[0],409)
        # Signing every account out of the browser.
        self.ok(browser,'/api/accounts/sign-out-all',{})
        self.assertIsNone(browser.boot()['user'])


if __name__=='__main__':
    unittest.main()
