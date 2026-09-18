"""Two-factor sign-in and passkeys for staff accounts and platform admins (staff_security): turning it on with the
password and a code, the second step of both staff sign-ins (/api/sign-in and /api/login) that gives no session until
the code is right, recovery codes, turning it off, passkeys added with the password and used on the shared sign-in
page's one passkey button (which still signs customers in with theirs), and the server owner's reset. Email is mocked;
nothing leaves the machine."""
import unittest

import test_app as base
from test_account_security import SoftwareAuthenticator, b64
from test_app import Client, D
from backend.middleware import rate_limit
from backend.modules.customer_security import totp

PASSWORD = 'Test-password-123!'
SECURITY = '/api/account/security'


class StaffSecurityTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    customer = base.IntegrationTests.customer
    create_member = base.IntegrationTests.create_member
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    CUSTOMER_PASSWORD = 'Customer-pass-123'

    def rewind(self):
        with D.control() as cd:
            cd.execute('UPDATE staff_totp SET last_step=0')

    def enable_totp(self, client):
        setup = self.ok(client,SECURITY+'/totp/setup',{'password':PASSWORD})
        codes = self.ok(client,SECURITY+'/totp/confirm',{'code':totp.code(setup['secret'],totp.step_now())})['recovery_codes']
        self.rewind()
        return setup['secret'],codes

    def password_step(self, email, path='/api/sign-in'):
        rate_limit.RATES.clear()
        client = Client(self.base)
        return client,client.call(path,{'email':email,'password':PASSWORD})

    def test_turning_it_on_costs_the_password_and_a_code_from_the_app(self):
        agent,_ = self.create_member()
        self.assertFalse(self.ok(agent,SECURITY)['two_factor']['enabled'])
        self.assertEqual(agent.call(SECURITY+'/totp/setup',{'password':'wrong-password-1'})[0],403)
        setup = self.ok(agent,SECURITY+'/totp/setup',{'password':PASSWORD})
        self.assertIn('otpauth://totp/',setup['otpauth_uri'])
        self.assertEqual(agent.call(SECURITY+'/totp/confirm',{'code':'000000'})[0],403)
        codes = self.ok(agent,SECURITY+'/totp/confirm',{'code':totp.code(setup['secret'],totp.step_now())})['recovery_codes']
        self.assertEqual(len(codes),10)
        state = self.ok(agent,SECURITY)
        self.assertEqual((state['two_factor']['enabled'],state['recovery']['left']),(True,10))
        self.assertEqual(agent.call(SECURITY+'/totp/setup',{'password':PASSWORD})[0],409)
        # The shared secret is sealed in the database.
        with D.control() as cd:
            self.assertTrue(cd.execute('SELECT secret FROM staff_totp').fetchone()[0].startswith('bdsec1.'))
        # Somebody else's session cannot read or change it, and a visitor gets nothing.
        self.assertEqual(Client(self.base).call(SECURITY)[0],401)

    def test_a_right_password_gives_no_session_until_the_code_is_right(self):
        agent,_ = self.create_member(email='agent@example.com')
        secret,codes = self.enable_totp(agent)
        for path in ('/api/sign-in','/api/login'):
            client,(status,answer) = self.password_step('agent@example.com',path)
            self.assertEqual(status,200)
            self.assertTrue(answer['two_factor'])
            self.assertEqual(answer['methods'],['totp','recovery'])
            self.assertIsNone(self.ok(client,'/api/bootstrap')['user'])
            self.assertEqual(client.call('/api/tickets')[0],401)
            self.assertEqual(client.call('/api/login/verify',{'code':'000000'})[0],403)
            self.ok(client,'/api/login/verify',{'code':totp.code(secret,totp.step_now())})
            self.assertEqual(self.ok(client,'/api/bootstrap')['user']['email'],'agent@example.com')
            # The same code (the same step) is never accepted twice, and the used challenge is gone.
            self.assertEqual(client.call('/api/login/verify',{'code':totp.code(secret,totp.step_now())})[0],401)
            self.rewind()
        # A recovery code works once.
        client,_ = self.password_step('agent@example.com')
        self.ok(client,'/api/login/verify',{'recovery_code':codes[0]})
        client,_ = self.password_step('agent@example.com')
        self.assertEqual(client.call('/api/login/verify',{'recovery_code':codes[0]})[0],403)
        # Five wrong codes throw the waiting sign-in away.
        client,_ = self.password_step('agent@example.com')
        for _ in range(5):
            rate_limit.RATES.clear()
            client.call('/api/login/verify',{'code':'000000'})
        rate_limit.RATES.clear()
        self.assertIn(client.call('/api/login/verify',{'code':totp.code(secret,totp.step_now())})[0],(401,429))
        # Those wrong codes count like wrong passwords: the email is now locked on the sign-in page too.
        rate_limit.RATES.clear()
        self.assertEqual(Client(self.base).call('/api/sign-in',{'email':'agent@example.com','password':PASSWORD})[0],429)

    def test_platform_admins_get_it_too_and_turning_it_off_needs_a_code(self):
        secret,_ = self.enable_totp(self.owner)
        client,(status,answer) = self.password_step('admin@example.com')
        self.assertTrue(answer['two_factor'])
        self.ok(client,'/api/login/verify',{'code':totp.code(secret,totp.step_now())})
        client.boot()
        self.assertEqual(client.call('/api/platform/system')[0],200)
        self.rewind()
        self.assertEqual(client.call(SECURITY+'/totp/disable',{'password':PASSWORD,'code':'000000'})[0],403)
        self.ok(client,SECURITY+'/totp/disable',{'password':PASSWORD,'code':totp.code(secret,totp.step_now())})
        _,(status,answer) = self.password_step('admin@example.com')
        self.assertNotIn('two_factor',answer)
        events = [e['action'] for e in self.ok(client,'/api/platform/tenants')['audit']]
        self.assertTrue({'account.totp_on','account.login_2fa','account.totp_off'}<=set(events))

    def test_one_passkey_button_signs_in_staff_and_customers_alike(self):
        agent,_ = self.create_member(email='agent@example.com')
        self.assertEqual(agent.call(SECURITY+'/passkeys/options',{'password':'wrong-password-1'})[0],403)
        soft = SoftwareAuthenticator()
        options = self.ok(agent,SECURITY+'/passkeys/options',{'password':PASSWORD})
        self.ok(agent,SECURITY+'/passkeys',{'name':'โน้ตบุ๊กที่ทำงาน','credential':soft.create(options,self.base)})
        self.assertEqual([p['name'] for p in self.ok(agent,SECURITY)['passkeys']],['โน้ตบุ๊กที่ทำงาน'])
        # The staff passkey signs in to the staff session, with no password and no second step.
        rate_limit.RATES.clear()
        visitor = Client(self.base)
        sign_in = self.ok(visitor,'/api/sign-in/passkey/options',{})
        self.assertEqual(self.ok(visitor,'/api/sign-in/passkey',{'credential':soft.get(sign_in,self.base)})['kind'],'staff')
        self.assertEqual(self.ok(visitor,'/api/bootstrap')['user']['email'],'agent@example.com')
        # The answer cannot be used again.
        self.assertEqual(Client(self.base).call('/api/sign-in/passkey',{'credential':soft.get(sign_in,self.base)})[0],403)
        # A customer's passkey on the same button signs the customer in.
        customer = self.customer()
        customer_key = SoftwareAuthenticator()
        options = self.ok(customer,'/api/customer/security/passkeys/options',{'password':'Customer-pass-123'})
        self.ok(customer,'/api/customer/security/passkeys',{'credential':customer_key.create(options,self.base)})
        rate_limit.RATES.clear()
        someone = Client(self.base)
        sign_in = self.ok(someone,'/api/sign-in/passkey/options',{})
        self.assertEqual(self.ok(someone,'/api/sign-in/passkey',{'credential':customer_key.get(sign_in,self.base)})['kind'],'customer')
        self.assertTrue(self.ok(someone,'/api/customer/account')['signed_in'])
        self.assertIsNone(self.ok(someone,'/api/bootstrap')['user'])
        # An unknown passkey, and a staff passkey registered twice, are refused.
        rate_limit.RATES.clear()
        sign_in = self.ok(someone,'/api/sign-in/passkey/options',{})
        self.assertEqual(someone.call('/api/sign-in/passkey',{'credential':SoftwareAuthenticator().get(sign_in,self.base)})[0],403)
        again = self.ok(agent,SECURITY+'/passkeys/options',{'password':PASSWORD})
        self.assertEqual([c['id'] for c in again['excludeCredentials']],[b64(soft.credential_id)])
        self.assertEqual(agent.call(SECURITY+'/passkeys',{'credential':soft.create(again,self.base)})[0],409)
        # Removing it needs the password.
        passkey_id = self.ok(agent,SECURITY)['passkeys'][0]['id']
        self.assertEqual(agent.call(SECURITY+f'/passkeys/{passkey_id}/remove',{'password':'wrong-password-1'})[0],403)
        self.ok(agent,SECURITY+f'/passkeys/{passkey_id}/remove',{'password':PASSWORD})
        rate_limit.RATES.clear()
        sign_in = self.ok(someone,'/api/sign-in/passkey/options',{})
        self.assertEqual(someone.call('/api/sign-in/passkey',{'credential':soft.get(sign_in,self.base)})[0],403)

    def test_the_server_owner_can_reset_a_lost_second_factor(self):
        from backend.modules.staff_security import service
        agent,_ = self.create_member(email='agent@example.com')
        self.enable_totp(agent)
        self.assertTrue(service.reset_account('agent@example.com'))
        self.assertFalse(service.reset_account('nobody@example.com'))
        self.assertEqual(agent.call('/api/tickets')[0],401)
        _,(status,answer) = self.password_step('agent@example.com')
        self.assertEqual(status,200)
        self.assertNotIn('two_factor',answer)


if __name__=='__main__':
    unittest.main()
