"""The shared sign-in page's POST /api/sign-in: one request checks the staff and the customer account of the typed email,
with its own lock ('signin:<email>'). Customers signing in no longer count as failed staff sign-ins; wrong passwords count
once; unknown emails lock the same way; a staff account wins when both passwords match; the customer's second step and
the cookies are those of the existing endpoints, which keep working unchanged. Email is mocked; disposable databases."""
import time
import unittest
from unittest.mock import patch

import test_app as base
import test_security_round as security_round
from test_app import Client, D, rate_limit
from backend.modules.auth import service as auth_service
from backend.modules.customer_security import totp
from backend.utils.security import password_hash, password_ok

PASSWORD = security_round.PASSWORD
CUSTOMER_PASSWORD = security_round.CUSTOMER_PASSWORD
SEC = security_round.SEC
LOCK_TEXT = security_round.LOCK_TEXT
WRONG = 'Wrong-password-000'
Round = security_round.SecurityRoundTests


def cookies_set(headers):
    """{cookie name: the whole Set-Cookie value} of an answer."""
    return {value.split('=',1)[0]:value for value in (headers.get_all('Set-Cookie') or [])}


class UnifiedSignInTests(unittest.TestCase):
    ok = base.IntegrationTests.ok
    customer = base.IntegrationTests.customer
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    create_member = base.IntegrationTests.create_member
    CUSTOMER_PASSWORD = CUSTOMER_PASSWORD
    setUp = Round.setUp
    tearDown = Round.tearDown
    raw = Round.raw
    lock_row = Round.lock_row
    update_lock = Round.update_lock
    events_of = Round.events_of
    total = Round.total
    wait_for = Round.wait_for
    lock_mails = Round.lock_mails

    def sign_in(self, email, password, client=None):
        rate_limit.RATES.clear()
        client = client or Client(self.base)
        status,data,headers = self.raw(client,'/api/sign-in',{'email':email,'password':password})
        return client,status,data,headers

    def fail_sign_ins(self, email, times, password=WRONG, path='/api/sign-in'):
        answers = []
        for _ in range(times):
            rate_limit.RATES.clear()
            answers.append(Client(self.base).call(path,{'email':email,'password':password}))
        rate_limit.RATES.clear()
        return answers

    def lock_count(self):
        with D.control() as cd:
            return cd.execute('SELECT COUNT(*) FROM login_failures').fetchone()[0]

    def customer_activity(self, email, action):
        with D.control() as cd:
            return cd.execute('SELECT COUNT(*) FROM customer_activity a JOIN customer_accounts c ON c.id=a.account_id '
                              'WHERE c.email=? AND a.action=?',(email,action)).fetchone()[0]

    def turn_on_two_factor(self, client):
        secret = self.ok(client,'/api/customer/security/totp/setup',{'password':CUSTOMER_PASSWORD})['secret']
        self.ok(client,'/api/customer/security/totp/confirm',{'code':totp.code(secret,totp.step_now())})
        with D.control() as cd:
            cd.execute('UPDATE customer_totp SET last_step=0')
        return secret

    # The bug: customers counted as failed staff sign-ins
    def test_customer_signing_in_ten_times_records_no_failure(self):
        self.customer(email='visitor@example.com')
        logins = self.customer_activity('visitor@example.com','login')
        for _ in range(10):
            client,status,data,headers = self.sign_in('visitor@example.com',CUSTOMER_PASSWORD)
            self.assertEqual((status,data),(200,{'ok':True,'signed_in':True,'kind':'customer'}))
        self.assertEqual(self.lock_count(),0)
        for kind in ('login_failed','login_locked','twofa_failed'):
            self.assertEqual(self.total(kind),0,kind)
        self.assertEqual(self.ok(self.owner,f'{SEC}/locks')['locks'],[])
        # Case and spaces of the email do not matter, as on the other endpoints.
        _,status,data,_ = self.sign_in(' VISITOR@example.com ',CUSTOMER_PASSWORD)
        self.assertEqual((status,data['kind']),(200,'customer'))
        self.assertEqual(self.lock_count(),0)
        # Every one of them is a real customer session.
        self.assertTrue(self.ok(client,'/api/customer/account')['signed_in'])
        self.assertIsNone(client.boot()['user'])
        self.assertEqual(self.customer_activity('visitor@example.com','login'),logins+11)
        self.assertEqual(self.customer_activity('visitor@example.com','login_failed'),0)

    def test_staff_sign_in_ten_times_records_no_failure(self):
        self.create_member(email='agent@example.com')
        for _ in range(10):
            client,status,data,_ = self.sign_in('agent@example.com',PASSWORD)
            self.assertEqual((status,data),(200,{'ok':True,'kind':'staff'}))
        self.assertEqual(self.lock_count(),0)
        self.assertEqual(self.total('login_failed'),0)
        self.assertEqual(client.boot()['user']['email'],'agent@example.com')

    # Counting
    def test_wrong_password_counts_once_per_attempt(self):
        self.customer(email='visitor@example.com')
        self.create_member(email='agent@example.com')
        for email,actor in (('visitor@example.com','customer'),('agent@example.com','staff'),('ghost@example.com','anonymous')):
            with self.subTest(email=email):
                answers = self.fail_sign_ins(email,4)
                self.assertEqual([s for s,_ in answers],[401]*4)
                self.assertEqual(answers[0][1],{'error':'อีเมลหรือรหัสผ่านไม่ถูกต้อง หรือยังไม่ได้ยืนยันอีเมล'})
                self.assertEqual(self.lock_row('signin:'+email)['failures'],4)
                self.assertIsNone(self.lock_row('staff:'+email))
                self.assertIsNone(self.lock_row('customer:'+email))
                failed = [e for e in self.events_of('login_failed') if e['subject']==email]
                self.assertEqual(sum(e['count'] for e in failed),4)
                self.assertEqual({e['actor'] for e in failed},{actor})
        # Only the customer who exists gets the wrong passwords in their own history.
        self.assertEqual(self.customer_activity('visitor@example.com','login_failed'),4)
        # The fifth locks, the right password is then refused too, and nothing more is counted.
        self.assertEqual(self.fail_sign_ins('visitor@example.com',1)[0][0],401)
        row = self.lock_row('signin:visitor@example.com')
        self.assertEqual((row['level'],row['failures']),(1,0))
        _,status,data,headers = self.sign_in('visitor@example.com',CUSTOMER_PASSWORD)
        self.assertEqual(status,429)
        self.assertEqual(set(data),{'error','retry_after'})
        self.assertTrue(data['error'].startswith(LOCK_TEXT) and 290<=data['retry_after']<=300,data)
        self.assertEqual(headers['Retry-After'],str(data['retry_after']))
        self.assertEqual(self.lock_row('signin:visitor@example.com')['locked_until'],row['locked_until'])
        self.assertEqual(self.total('login_locked'),1)
        # A success clears the count (not the level) and is recorded after the lock.
        self.update_lock('signin:visitor@example.com',locked_until=security_round.ago(seconds=1))
        self.fail_sign_ins('visitor@example.com',2)
        _,status,_,_ = self.sign_in('visitor@example.com',CUSTOMER_PASSWORD)
        self.assertEqual(status,200)
        row = self.lock_row('signin:visitor@example.com')
        self.assertEqual((row['failures'],row['locked_until'],row['level']),(0,None,1))
        self.assertEqual(self.total('login_after_lock',actor='customer'),1)

    def test_unknown_email_locks_identically(self):
        self.customer(email='visitor@example.com')
        self.create_member(email='agent@example.com')
        answers = {email:self.fail_sign_ins(email,6) for email in ('visitor@example.com','agent@example.com','ghost@example.com')}
        for email,found in answers.items():
            self.assertEqual([s for s,_ in found],[401]*5+[429],email)
            self.assertEqual(found[:5],answers['ghost@example.com'][:5])
            self.assertEqual(set(found[5][1]),{'error','retry_after'})
            self.assertEqual(found[5][1]['error'],answers['ghost@example.com'][5][1]['error'])
            self.assertLessEqual(abs(found[5][1]['retry_after']-answers['ghost@example.com'][5][1]['retry_after']),5)
        locks = self.ok(self.owner,f'{SEC}/locks')['locks']
        self.assertEqual({(l['actor'],l['subject']) for l in locks},{('signin',e) for e in answers})
        # The owners of the real accounts are told once; the unknown email is not.
        self.assertTrue(self.wait_for(lambda:len(self.lock_mails())==2))
        time.sleep(0.3)
        self.assertEqual(sorted(m.args[2] for m in self.lock_mails()),['agent@example.com','visitor@example.com'])
        # A Superadmin can unlock the sign-in page's key.
        self.assertEqual(self.ok(self.owner,f'{SEC}/locks/unlock',{'key':'signin:agent@example.com'}),{'ok':True})
        self.assertEqual(self.sign_in('agent@example.com',PASSWORD)[1],200)

    def test_both_password_hashes_always_run(self):
        self.customer(email='visitor@example.com')
        self.create_member(email='agent@example.com')
        with patch.object(auth_service,'password_ok',wraps=password_ok) as checked:
            for email,password in (('visitor@example.com',CUSTOMER_PASSWORD),('visitor@example.com',WRONG),
                                   ('agent@example.com',PASSWORD),('agent@example.com',WRONG),('ghost@example.com',WRONG)):
                checked.reset_mock()
                self.sign_in(email,password)
                self.assertEqual(checked.call_count,2,email)
                self.assertTrue(all(c.args[1].startswith('pbkdf2_sha256$600000$') for c in checked.call_args_list))

    # Which account, and its cookie
    def test_staff_wins_when_both_passwords_match(self):
        self.create_member(email='both@example.com')
        self.customer(email='both@example.com')
        # Each password opens its own account.
        client,status,data,headers = self.sign_in('both@example.com',PASSWORD)
        self.assertEqual((status,data),(200,{'ok':True,'kind':'staff'}))
        set_cookies = cookies_set(headers)
        self.assertEqual(set(set_cookies),{'bookdose_session'})
        self.assertIn('Path=/;',set_cookies['bookdose_session'])
        self.assertIn('HttpOnly',set_cookies['bookdose_session'])
        self.assertEqual(client.boot()['user']['email'],'both@example.com')
        self.assertFalse(self.ok(client,'/api/customer/account')['signed_in'])
        client,status,data,headers = self.sign_in('both@example.com',CUSTOMER_PASSWORD)
        self.assertEqual((status,data),(200,{'ok':True,'signed_in':True,'kind':'customer'}))
        set_cookies = cookies_set(headers)
        self.assertEqual(set(set_cookies),{'bookdose_account'})
        self.assertIn('Path=/api;',set_cookies['bookdose_account'])
        self.assertIsNone(client.boot()['user'])
        self.assertTrue(self.ok(client,'/api/customer/account')['signed_in'])
        # The same password on both: the staff account, as the page did before.
        with D.control() as cd:
            cd.execute('UPDATE customer_accounts SET password=? WHERE email=?',(password_hash(PASSWORD),'both@example.com'))
        client,status,data,_ = self.sign_in('both@example.com',PASSWORD)
        self.assertEqual((status,data['kind']),(200,'staff'))
        self.assertFalse(self.ok(client,'/api/customer/account')['signed_in'])
        # Neither: one failure, recorded as the staff account's, and the lock mail covers both accounts in one email.
        self.fail_sign_ins('both@example.com',5)
        self.assertEqual(self.total('login_failed',actor='staff'),5)
        self.assertEqual(self.total('login_failed',actor='customer'),0)
        self.assertTrue(self.wait_for(lambda:len(self.lock_mails())==1))
        time.sleep(0.3)
        mails = self.lock_mails()
        self.assertEqual(len(mails),1)
        text = mails[0].args[3].get_content()
        self.assertIn('บัญชีลูกค้า',text)
        self.assertIn('บัญชีทีมงาน',text)

    def test_customer_with_two_factor(self):
        client = self.customer(email='visitor@example.com')
        secret = self.turn_on_two_factor(client)
        # Two wrong passwords first: they count on the sign-in page's key only.
        self.fail_sign_ins('visitor@example.com',2)
        waiting,status,data,headers = self.sign_in('visitor@example.com',CUSTOMER_PASSWORD)
        self.assertEqual((status,data),(200,{'ok':True,'two_factor':True,'methods':['totp','recovery'],'kind':'customer'}))
        set_cookies = cookies_set(headers)
        self.assertEqual(set(set_cookies),{'bookdose_2fa'})
        self.assertIn('Path=/api;',set_cookies['bookdose_2fa'])
        self.assertFalse(self.ok(waiting,'/api/customer/account')['signed_in'])
        # Wrong codes count as on POST /api/customer/login: on the customer's key, as twofa_failed.
        wrong = '000000' if totp.code(secret,totp.step_now())!='000000' else '111111'
        for _ in range(4):
            rate_limit.RATES.clear()
            self.assertEqual(waiting.call('/api/customer/login/verify',{'code':wrong})[0],403)
        self.assertEqual(self.lock_row('customer:visitor@example.com')['failures'],4)
        self.assertEqual(self.lock_row('signin:visitor@example.com')['failures'],2)
        self.assertEqual(self.total('twofa_failed'),4)
        # The right code signs in and clears both counts.
        status,data,headers = self.raw(waiting,'/api/customer/login/verify',{'code':totp.code(secret,totp.step_now())})
        self.assertEqual((status,data),(200,{'ok':True,'signed_in':True}))
        self.assertIn('bookdose_account',cookies_set(headers))
        self.assertTrue(self.ok(waiting,'/api/customer/account')['signed_in'])
        self.assertEqual(self.lock_row('customer:visitor@example.com')['failures'],0)
        self.assertEqual(self.lock_row('signin:visitor@example.com')['failures'],0)
        # Five wrong codes lock the customer's key, which refuses the sign-in page too.
        with D.control() as cd:
            cd.execute('UPDATE customer_totp SET last_step=0')
        second,_,data,_ = self.sign_in('visitor@example.com',CUSTOMER_PASSWORD)
        self.assertTrue(data['two_factor'])
        for _ in range(5):
            rate_limit.RATES.clear()
            second.call('/api/customer/login/verify',{'code':wrong})
        self.assertTrue(self.lock_row('customer:visitor@example.com')['locked_until'])
        _,status,data,_ = self.sign_in('visitor@example.com',CUSTOMER_PASSWORD)
        self.assertEqual((status,set(data)),(429,{'error','retry_after'}))
        # A password reset from the emailed link ends every lock of that email.
        self.assertTrue(self.wait_for(lambda:len(self.lock_mails())==1))
        self.assertEqual(Client(self.base).call('/api/customer/forgot',{'email':'visitor@example.com'})[0],202)
        self.assertEqual(Client(self.base).call('/api/customer/reset',{'token':self.mail_link('reset'),'password':'New-customer-pass-1'})[0],200)
        self.assertIsNone(self.lock_row('customer:visitor@example.com')['locked_until'])
        _,status,data,_ = self.sign_in('visitor@example.com','New-customer-pass-1')
        self.assertEqual((status,data.get('two_factor')),(200,True))

    # The endpoints that were there before
    def test_old_endpoints_unchanged(self):
        self.customer(email='visitor@example.com')
        self.create_member(email='agent@example.com')
        rate_limit.RATES.clear()
        status,data,headers = self.raw(Client(self.base),'/api/login',{'email':'agent@example.com','password':PASSWORD})
        self.assertEqual((status,data,set(cookies_set(headers))),(200,{'ok':True},{'bookdose_session'}))
        status,data,headers = self.raw(Client(self.base),'/api/customer/login',{'email':'visitor@example.com','password':CUSTOMER_PASSWORD})
        self.assertEqual((status,data,set(cookies_set(headers))),(200,{'ok':True,'signed_in':True},{'bookdose_account'}))
        # Their failures stay on their own keys.
        self.assertEqual([s for s,_ in self.fail_sign_ins('agent@example.com',2,path='/api/login')],[401]*2)
        self.assertEqual(self.fail_sign_ins('visitor@example.com',1,path='/api/customer/login')[0],
                         (401,{'error':'อีเมลหรือรหัสผ่านไม่ถูกต้อง หรือยังไม่ได้ยืนยันอีเมล'}))
        self.assertEqual(self.lock_row('staff:agent@example.com')['failures'],2)
        self.assertEqual(self.lock_row('customer:visitor@example.com')['failures'],1)
        self.assertIsNone(self.lock_row('signin:agent@example.com'))
        self.assertIsNone(self.lock_row('signin:visitor@example.com'))
        # A lock on any key of an email refuses the others, so switching endpoints buys no more guesses.
        self.fail_sign_ins('agent@example.com',3,path='/api/login')
        _,status,data,_ = self.sign_in('agent@example.com',PASSWORD)
        self.assertEqual((status,set(data)),(429,{'error','retry_after'}))
        self.fail_sign_ins('ghost@example.com',5)
        rate_limit.RATES.clear()
        self.assertEqual(Client(self.base).call('/api/login',{'email':'ghost@example.com','password':WRONG})[0],429)
        self.assertEqual(Client(self.base).call('/api/customer/login',{'email':'ghost@example.com','password':WRONG})[0],429)
        self.assertIsNone(self.lock_row('staff:ghost@example.com'))
        # Unlocking one key of the email unlocks it everywhere.
        self.assertEqual(self.ok(self.owner,f'{SEC}/locks/unlock',{'key':'staff:agent@example.com'}),{'ok':True})
        self.assertEqual(self.sign_in('agent@example.com',PASSWORD)[1],200)


# Borrowed helpers only: the security round's own tests must not run again from this module.
del Round


if __name__=='__main__':
    unittest.main()
