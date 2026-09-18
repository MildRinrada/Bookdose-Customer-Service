"""Customer accounts: one account for every organization. Sign-up with consent, email confirmation bound to the chosen
password, sign-in, password reset and change, the organizations a customer can contact, chats and cases in each of
them, categories, reply notices by email, survey comments, what staff actions do to accounts, and the move of the
accounts that used to live in each organization's database. Email is mocked; nothing leaves the machine."""
import json
import unittest
import urllib.error
import urllib.request

import test_app as base
from test_app import Client, D
from backend.middleware import rate_limit
from backend.modules.customers import service as customers
from backend.utils.security import password_hash

PASSWORD = 'Customer-pass-123'


class CustomerAccountTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    visitor = base.IntegrationTests.visitor
    customer = base.IntegrationTests.customer
    create_member = base.IntegrationTests.create_member
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    CUSTOMER_PASSWORD = PASSWORD

    def signup(self, client=None, **changes):
        rate_limit.RATES.clear()
        form = {'name':'สมชาย ใจดี','email':'somchai@example.com','password':PASSWORD,'consent':True,**changes}
        return (client or Client(self.base)).call('/api/customer/register',form)

    def test_without_email_signup_works_at_once_but_is_not_verified(self):
        from backend.modules.contacts import repository as contacts
        from backend.modules.conversations import repository as conversations
        self.assertFalse(self.ok(Client(self.base),'/api/public/alpha')['email_verification'])
        self.assertFalse(self.ok(self.admin,'/api/workspace')['customer_email'])
        with D.tenant(self.org) as db:
            team = db.execute('SELECT id FROM teams').fetchone()[0]
            contacts.insert(db,'c'*32,'ลูกค้าเดิม','somchai@example.com','','','','portal')
            conversations.insert(db,'d'*32,'c'*32,'เรื่องเดิม','web',team)
        client = Client(self.base)
        status,data = self.signup(client)
        self.assertEqual((status,data.get('signed_in')),(201,True))
        me = self.ok(client,'/api/customer/account')
        self.assertTrue(me['signed_in'])
        # The email was never proven, so earlier conversations with it stay private.
        self.assertEqual(self.ok(client,'/api/customer/overview')['conversations'],[])
        client.customer_csrf = me['csrf']
        self.ok(client,'/api/public/alpha/conversations',{'subject':'ขอความช่วยเหลือ','body':'ทดสอบ'})
        self.assertEqual(self.signup()[0],409)
        with D.control() as cd:
            self.assertEqual(cd.execute('SELECT email_verified FROM customer_accounts').fetchone()[0],0)
        # Once email is set up, new sign-ups confirm their email first again.
        self.customer_mail()
        self.assertTrue(self.ok(Client(self.base),'/api/public/alpha')['email_verification'])
        self.assertEqual(self.signup(email='later@example.com')[0],202)

    def test_reads_of_a_signed_in_customer_are_counted_by_account(self):
        import time
        client = Client(self.base)
        self.assertEqual(self.signup(client)[0],201)
        with D.control() as cd:
            account = cd.execute('SELECT id FROM customer_accounts').fetchone()[0]
        # Every visitor behind one web app or office network shares an address, and its reads are used up.
        rate_limit.RATES[('public-read','ip','127.0.0.1')].extend([time.monotonic()]*180)
        self.assertEqual(Client(self.base).call('/api/public/alpha')[0],429)
        # A cookie that names no session is counted by address like anyone signed out.
        self.assertEqual(Client(self.base).call('/api/public/alpha',headers={'Cookie':f'{customers.SESSION_COOKIE}=made-up'})[0],429)
        # The signed-in customer is counted apart, by account, in every part of the customer area.
        self.ok(client,'/api/customer/overview')
        self.ok(client,'/api/public/alpha')
        self.assertIn(('public-read','account',account),rate_limit.RATES)
        # And an account has its own limit.
        rate_limit.RATES[('public-read','account',account)].extend([time.monotonic()]*180)
        self.assertEqual(client.call('/api/customer/overview')[0],429)

    def test_signup_asks_only_what_is_needed_and_requires_consent(self):
        self.customer_mail()
        for changes in ({'consent':False},{'consent':'yes'},{'email':'not-an-email'},{'password':'short'},{'name':''},
                        {'phone':'call me'},{'phone':'12'},{'org':'no-such-org'}):
            self.assertIn(self.signup(**changes)[0],(400,404),changes)
        # The phone number is optional; a real one is kept.
        self.assertEqual(self.signup(phone='081-234-5678')[0],202)
        self.assertEqual(self.mailer.call_args.args[2],'somchai@example.com')
        # No account before the email is confirmed: signing in fails, and a second attempt waits a minute.
        self.assertEqual(Client(self.base).call('/api/customer/login',{'email':'somchai@example.com','password':PASSWORD})[0],401)
        self.assertEqual(self.signup()[0],429)
        client = Client(self.base)
        self.ok(client,'/api/customer/verify',{'token':self.mail_link('verify'),'password':PASSWORD})
        me = self.ok(client,'/api/customer/account')
        self.assertEqual((me['name'],me['email'],me['phone']),('สมชาย ใจดี','somchai@example.com','081-234-5678'))
        # Signed up on the main page: connected with the platform's own organization, where the team sees the contact.
        contact = next(c for c in self.ok(self.admin,'/api/contacts')['contacts'] if c['email']=='somchai@example.com')
        self.assertEqual(contact['phone'],'081-234-5678')

    def test_confirming_needs_the_password_of_that_signup(self):
        self.customer_mail()
        self.assertEqual(self.signup()[0],202)
        victim_link = self.mail_link('verify')
        # Someone else signs up with the same email and another password; the owner receives that link too.
        with D.control() as cd:
            cd.execute("UPDATE customer_signups SET created_at='2000-01-01T00:00:00+00:00'")
        self.assertEqual(self.signup(password='Attacker-pass-999')[0],202)
        attacker_link = self.mail_link('verify')
        self.assertNotEqual(victim_link,attacker_link)
        client = Client(self.base)
        self.assertEqual(client.call('/api/customer/verify',{'token':attacker_link,'password':PASSWORD})[0],403)
        self.ok(client,'/api/customer/verify',{'token':victim_link,'password':PASSWORD})
        # The other link no longer works, and the other password never opens the account.
        self.assertEqual(Client(self.base).call('/api/customer/verify',{'token':attacker_link,'password':'Attacker-pass-999'})[0],400)
        self.assertEqual(Client(self.base).call('/api/customer/login',{'email':'somchai@example.com','password':'Attacker-pass-999'})[0],401)
        self.ok(Client(self.base),'/api/customer/login',{'email':'SOMCHAI@example.com','password':PASSWORD})

    def test_resend_logout_and_password_reset(self):
        self.customer_mail()
        self.assertEqual(self.signup()[0],202)
        first = self.mail_link('verify')
        with D.control() as cd:
            cd.execute("UPDATE customer_signups SET created_at='2000-01-01T00:00:00+00:00'")
        self.assertEqual(Client(self.base).call('/api/customer/resend',{'email':'somchai@example.com'})[0],202)
        second = self.mail_link('verify')
        self.assertNotEqual(first,second)
        client = Client(self.base)
        self.ok(client,'/api/customer/verify',{'token':second,'password':PASSWORD})
        client.customer_csrf = self.ok(client,'/api/customer/account')['csrf']
        self.ok(client,'/api/customer/logout',{})
        self.assertFalse(self.ok(client,'/api/customer/account')['signed_in'])
        self.assertEqual(client.call('/api/customer/overview')[0],401)
        # Forgotten password: the answer is the same for unknown emails, and the link signs out older sessions.
        sent = self.mailer.call_count
        self.assertEqual(Client(self.base).call('/api/customer/forgot',{'email':'nobody@example.com'})[0],202)
        self.assertEqual(self.mailer.call_count,sent)
        other = Client(self.base)
        self.ok(other,'/api/customer/login',{'email':'somchai@example.com','password':PASSWORD})
        self.assertEqual(Client(self.base).call('/api/customer/forgot',{'email':'somchai@example.com'})[0],202)
        reset = self.mail_link('reset')
        fresh = Client(self.base)
        self.assertEqual(fresh.call('/api/customer/reset',{'token':reset,'password':'short'})[0],400)
        self.ok(fresh,'/api/customer/reset',{'token':reset,'password':'New-customer-pass-1'})
        self.assertFalse(self.ok(other,'/api/customer/account')['signed_in'])
        self.assertEqual(Client(self.base).call('/api/customer/reset',{'token':reset,'password':'Another-pass-1234'})[0],400)
        self.ok(Client(self.base),'/api/customer/login',{'email':'somchai@example.com','password':'New-customer-pass-1'})

    def test_one_account_contacts_many_organizations_that_stay_apart(self):
        self.assertEqual(Client(self.base).boot()['home'],{'slug':'alpha','name':'องค์กร A'})
        beta = self.ok(self.owner,'/api/platform/tenants',{'name':'องค์กร B','slug':'beta','email':'owner@example.com',
                                                           'admin_name':'ผู้ดูแล B','password':'Test-password-123!'})['id']
        # The platform's own organization stays first for everyone, however many there are.
        self.assertEqual(Client(self.base).boot()['home']['slug'],'alpha')
        customer,alpha_chat = self.visitor()
        self.assertEqual([o['slug'] for o in self.ok(customer,'/api/customer/organizations')['organizations']],['alpha'])
        self.assertTrue(self.ok(customer,'/api/customer/organizations')['organizations'][0]['home'])
        self.assertEqual(customer.call('/api/customer/organizations',{'slug':'no-such-org'})[0],404)
        joined = self.ok(customer,'/api/customer/organizations',{'slug':'beta'})['organization']
        self.assertEqual((joined['name'],joined['home'],joined['categories'][0]),('องค์กร B',False,'สอบถามบริการ'))
        self.assertEqual([o['slug'] for o in self.ok(customer,'/api/customer/organizations')['organizations']],['alpha','beta'])
        beta_chat = self.ok(customer,'/api/public/beta/conversations',{'subject':'สอบถามสินค้า','body':'มีของไหม','category':'สอบถามบริการ'})['id']
        overview = self.ok(customer,'/api/customer/overview')
        self.assertEqual({(c['id'],c['org_slug']) for c in overview['conversations']},{(alpha_chat,'alpha'),(beta_chat,'beta')})
        # Each organization's team sees only its own conversations; the customer reads each where it belongs.
        owner = Client(self.base)
        owner.login('owner@example.com')
        self.assertEqual([c['id'] for c in self.ok(owner,'/api/conversations')['conversations']],[beta_chat])
        agent,_ = self.create_member()
        self.assertNotIn(beta_chat,[c['id'] for c in self.ok(agent,'/api/conversations')['conversations']])
        customer.conversation = beta_chat
        self.assertEqual(customer.call('/api/public/alpha/session')[0],404)
        self.assertEqual(self.ok(customer,'/api/public/beta/session')['conversation']['subject'],'สอบถามสินค้า')
        # A suspended organization leaves the customer's list.
        self.ok(self.owner,'/api/platform/tenants/'+beta,{'status':'suspended','confirmation':'CONFIRM'},'PATCH')
        self.assertEqual([o['slug'] for o in self.ok(customer,'/api/customer/organizations')['organizations']],['alpha'])

    def test_an_older_installation_keeps_its_oldest_organization_first(self):
        # Installed before the platform remembered its own organization: a new organization does not take its place.
        with D.control() as cd:
            cd.execute("DELETE FROM platform_settings WHERE key='home_tenant'")
        self.ok(self.owner,'/api/platform/tenants',{'name':'องค์กร B','slug':'beta','email':'orgadmin@example.com'})
        self.assertEqual(Client(self.base).boot()['home']['slug'],'alpha')
        with D.control() as cd:
            self.assertEqual(cd.execute("SELECT value FROM platform_settings WHERE key='home_tenant'").fetchone()[0],self.org)

    def test_signing_up_from_an_organization_link_connects_it(self):
        self.ok(self.owner,'/api/platform/tenants',{'name':'องค์กร B','slug':'beta','email':'orgadmin@example.com'})
        client = Client(self.base)
        status,_ = self.signup(client,org='beta')
        self.assertEqual(status,201)
        client.customer_csrf = self.ok(client,'/api/customer/account')['csrf']
        self.assertEqual([o['slug'] for o in self.ok(client,'/api/customer/organizations')['organizations']],['alpha','beta'])

    def test_categories_send_new_chats_to_a_team(self):
        team = self.ok(self.admin,'/api/teams',{'name':'ทีมเทคนิค'})['id']
        agent,_ = self.create_member()
        categories = [{'name':'แจ้งปัญหา','team_id':team},{'name':'ทั่วไป','team_id':''}]
        self.assertEqual(agent.call('/api/settings/categories',{'categories':categories})[0],403)
        for bad in ([],[{'name':'','team_id':''}],[{'name':'ซ้ำ','team_id':''},{'name':'ซ้ำ','team_id':''}],[{'name':'x','team_id':'0'*32}]):
            self.assertEqual(self.admin.call('/api/settings/categories',{'categories':bad})[0],400,bad)
        self.ok(self.admin,'/api/settings/categories',{'categories':categories})
        self.assertEqual(self.ok(Client(self.base),'/api/public/alpha')['categories'],['แจ้งปัญหา','ทั่วไป'])
        customer = self.customer()
        self.assertEqual(customer.call('/api/public/alpha/conversations',{'subject':'x','body':'y','category':'ไม่มีหมวดนี้'})[0],400)
        conv = self.ok(customer,'/api/public/alpha/conversations',{'subject':'เข้าระบบไม่ได้','body':'แนบภาพหน้าจอ','category':'แจ้งปัญหา'})['id']
        detail = self.ok(self.admin,f'/api/conversations/{conv}')
        self.assertEqual((detail['conversation']['team_id'],detail['conversation']['category']),(team,'แจ้งปัญหา'))
        self.assertEqual(self.ok(customer,'/api/customer/overview')['conversations'][0]['category'],'แจ้งปัญหา')
        case = self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']
        self.assertEqual(self.ok(self.admin,f'/api/tickets/{case}')['ticket']['category'],'แจ้งปัญหา')

    def test_earlier_support_page_conversations_join_the_confirmed_account(self):
        from backend.modules.contacts import repository as contacts
        from backend.modules.conversations import repository as conversations
        with D.tenant(self.org) as db:
            team = db.execute('SELECT id FROM teams').fetchone()[0]
            contacts.insert(db,'c'*32,'ลูกค้าเดิม','Old@Example.com','','','','portal')
            conversations.insert(db,'d'*32,'c'*32,'เรื่องที่ส่งด้วยลิงก์เดิม','web',team)
            conversations.insert_message(db,'e'*32,'d'*32,None,'ลูกค้าเดิม','customer','ข้อความเก่า')
            contacts.insert(db,'f'*32,'รายชื่อที่ทีมสร้าง','old@example.com','','','','staff')
        customer = self.customer(email='old@example.com')
        listed = self.ok(customer,'/api/customer/overview')['conversations']
        self.assertEqual([(c['id'],c['org_slug']) for c in listed],[('d'*32,'alpha')])
        customer.conversation = 'd'*32
        self.assertEqual(self.ok(customer,'/api/public/alpha/session')['messages'][0]['body'],'ข้อความเก่า')

    def test_reply_notice_is_emailed_once_unless_read_on_the_page(self):
        visitor,conv = self.visitor()
        sent = self.mailer.call_count
        self.ok(self.admin,f'/api/conversations/{conv}/messages',{'kind':'reply','body':'ตอบครั้งที่ 1'})
        self.ok(self.admin,f'/api/conversations/{conv}/messages',{'kind':'reply','body':'ตอบครั้งที่ 2'})
        self.ok(self.admin,f'/api/conversations/{conv}/messages',{'kind':'note','body':'บันทึกภายใน'})
        self.assertEqual(customers.send_notices(self.org),0)   # waits a couple of minutes first
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM customer_notifications').fetchone()[0],1)
            db.execute("UPDATE customer_notifications SET created_at='2000-01-01T00:00:00+00:00'")
            db.execute("UPDATE customer_seen SET seen_at='1999-01-01T00:00:00+00:00'")
        self.assertEqual(customers.send_notices(self.org),1)
        mail = self.mailer.call_args.args[3].get_content()
        self.assertEqual(self.mailer.call_count,sent+1)
        self.assertIn('/#chats/alpha/'+conv,mail)
        self.assertNotIn('ตอบครั้งที่',mail)
        self.assertEqual(customers.send_notices(self.org),0)
        # A reply the customer opens on the page within the delay is not emailed.
        self.ok(self.admin,f'/api/conversations/{conv}/messages',{'kind':'reply','body':'ตอบครั้งที่ 3'})
        with D.tenant(self.org) as db:
            db.execute("UPDATE customer_notifications SET created_at='2000-01-01T00:00:00+00:00' WHERE sent_at IS NULL")
        self.ok(visitor,'/api/public/alpha/session')
        self.assertEqual(customers.send_notices(self.org),0)
        self.assertEqual(self.mailer.call_count,sent+1)

    def test_reply_notice_is_never_emailed_to_an_unproven_address(self):
        visitor,conv = self.visitor()
        sent = self.mailer.call_count
        self.ok(self.admin,f'/api/conversations/{conv}/messages',{'kind':'reply','body':'ตอบแล้ว'})
        # Queued while the email was proven; by the time it is sent the address is no longer (for example the account
        # was reached through LINE). Nothing goes to that address.
        with D.tenant(self.org) as db:
            db.execute("UPDATE customer_notifications SET created_at='2000-01-01T00:00:00+00:00'")
        with D.control() as cd:
            cd.execute("UPDATE customer_accounts SET email_verified=0 WHERE email='visitor@example.com'")
        customers.send_notices(self.org)
        self.assertEqual(self.mailer.call_count,sent)
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM customer_notifications WHERE sent_at IS NULL').fetchone()[0],0)

    def test_survey_takes_stars_and_a_comment(self):
        visitor,conv = self.visitor()
        case = self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']
        self.ok(self.admin,f'/api/tickets/{case}',{'status':'resolved'},'PATCH')
        self.assertTrue(self.ok(visitor,'/api/public/alpha/session')['survey']['pending'])
        self.assertEqual(visitor.call('/api/public/alpha/csat',{'rating':4,'comment':'x'*1001})[0],400)
        self.ok(visitor,'/api/public/alpha/csat',{'rating':4,'comment':'  ตอบเร็ว ขอบคุณค่ะ '})
        survey = self.ok(visitor,'/api/public/alpha/session')['survey']
        self.assertEqual((survey['pending'],survey['rating'],survey['comment']),(False,4,'ตอบเร็ว ขอบคุณค่ะ'))

    def test_staff_cannot_orphan_an_account_and_merge_moves_ownership(self):
        visitor,conv = self.visitor()
        contact = self.ok(self.admin,f'/api/conversations/{conv}')['contact']['id']
        other = self.ok(self.admin,'/api/contacts',{'first_name':'รายชื่อซ้ำ','email':'dup@example.com'})['id']
        # The account's own contact cannot be deleted even once it has no conversations left.
        self.ok(self.admin,f'/api/contacts/{other}/merge',{'contact_ids':[contact]})
        self.assertEqual([c['id'] for c in self.ok(visitor,'/api/customer/overview')['conversations']],[conv])
        self.assertEqual(self.admin.call(f'/api/contacts/{other}',None,'DELETE')[0],400)
        rate_limit.RATES.clear()
        self.ok(visitor,'/api/public/alpha/messages',{'body':'ยังเข้าถึงได้หลังรวมรายชื่อ'})

    def test_customers_use_the_main_page_not_a_support_link(self):
        # The main page itself is the Next.js app's (frontend/); the old support-page address is gone.
        with self.assertRaises(urllib.error.HTTPError) as gone:
            urllib.request.urlopen(self.base+'/support/alpha')
        self.assertEqual(gone.exception.code,404)
        # Links in account emails open the main page.
        self.customer_mail()
        self.assertEqual(self.signup()[0],202)
        mail = self.mailer.call_args.args[3].get_content()
        self.assertIn('https://bookdose.example.com/#verify=',mail)
        self.assertNotIn('/support/',mail)

    def test_cases_show_only_the_customers_own_without_internal_details(self):
        visitor,conv = self.visitor()
        case = self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']
        cases = self.ok(visitor,'/api/customer/overview')['cases']
        self.assertEqual([(c['id'],c['org_slug']) for c in cases],[(case,'alpha')])
        self.assertFalse({'priority','assignee_id','team_id','contact_id'} & set(cases[0]))
        with D.tenant(self.org) as db:
            db.execute('INSERT INTO followups VALUES(?,?,?,?,?,?,?,NULL)',
                       ('f'*32,case,'2099-01-01T00:00:00+00:00','โทรกลับเรื่องใบแจ้งหนี้','u','ทีมงาน','2026-01-01T00:00:00+00:00'))
        detail = self.ok(visitor,f'/api/public/alpha/cases/{case}')
        self.assertEqual([c['id'] for c in detail['conversations']],[conv])
        self.assertEqual(detail['followups'],['2099-01-01T00:00:00+00:00'])
        self.assertEqual(detail['case']['next_followup_at'],'2099-01-01T00:00:00+00:00')
        self.assertNotIn('โทรกลับ',json.dumps(detail,ensure_ascii=False))
        # The chat links to its case.
        self.assertEqual(self.ok(visitor,'/api/public/alpha/session')['ticket']['id'],case)
        # Another customer sees neither the list entry nor the case; a visitor is asked to sign in.
        other = self.customer(email='other@example.com')
        self.assertEqual(self.ok(other,'/api/customer/overview')['cases'],[])
        self.assertEqual(other.call(f'/api/public/alpha/cases/{case}')[0],404)
        self.assertEqual(Client(self.base).call('/api/customer/overview')[0],401)

    def test_overview_counts_what_waits_for_the_customer(self):
        visitor,conv = self.visitor()
        overview = self.ok(visitor,'/api/customer/overview')
        self.assertEqual((overview['alert_count'],overview['alerts']),(0,[]))
        self.ok(self.admin,f'/api/conversations/{conv}/messages',{'kind':'reply','body':'ตอบแล้วค่ะ'})
        self.ok(self.admin,f'/api/conversations/{conv}/messages',{'kind':'note','body':'บันทึกภายใน'})
        with D.tenant(self.org) as db:
            db.execute("UPDATE customer_seen SET seen_at='2000-01-01T00:00:00+00:00'")
        overview = self.ok(visitor,'/api/customer/overview')
        self.assertEqual([(a['kind'],a['conversation_id'],a['org_slug'],a['action']) for a in overview['alerts']],[('reply',conv,'alpha',True)])
        self.assertEqual((overview['alert_count'],overview['conversations'][0]['last_body']),(1,'ตอบแล้วค่ะ'))
        # Reading the chat clears it.
        self.ok(visitor,'/api/public/alpha/session')
        self.assertEqual(self.ok(visitor,'/api/customer/overview')['alert_count'],0)
        # The team asks for more details on the case: that waits for the customer as well.
        case = self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']
        self.ok(self.admin,f'/api/tickets/{case}',{'status':'pending_customer'},'PATCH')
        overview = self.ok(visitor,'/api/customer/overview')
        self.assertEqual([a['kind'] for a in overview['alerts'] if a['action']],['waiting'])
        self.assertEqual(overview['cases'][0]['status'],'pending_customer')

    def test_profile_and_password_change(self):
        visitor,conv = self.visitor()
        contact = self.ok(self.admin,f'/api/conversations/{conv}')['contact']['id']
        for bad in ({'name':'','phone':''},{'name':'สมศรี','phone':'call me'}):
            self.assertEqual(visitor.call('/api/customer/profile',bad)[0],400,bad)
        self.ok(visitor,'/api/customer/profile',{'name':'สมศรี มีสุข','phone':'081-111-2222'})
        me = self.ok(visitor,'/api/customer/account')
        self.assertEqual((me['name'],me['phone'],me['email_verified'],me['consent_version']),('สมศรี มีสุข','081-111-2222',True,'2026-09'))
        # The team's contact record gets the phone number it did not have.
        listed = next(c for c in self.ok(self.admin,'/api/contacts')['contacts'] if c['id']==contact)
        self.assertEqual(listed['phone'],'081-111-2222')
        other = Client(self.base)
        self.ok(other,'/api/customer/login',{'email':'visitor@example.com','password':PASSWORD})
        self.assertEqual(visitor.call('/api/customer/password',{'current_password':'Wrong-password-1','password':'Brand-new-pass-1'})[0],403)
        self.assertEqual(visitor.call('/api/customer/password',{'current_password':PASSWORD,'password':'short'})[0],400)
        self.ok(visitor,'/api/customer/password',{'current_password':PASSWORD,'password':'Brand-new-pass-1'})
        # This device stays signed in; the other one is signed out.
        self.assertTrue(self.ok(visitor,'/api/customer/account')['signed_in'])
        self.assertFalse(self.ok(other,'/api/customer/account')['signed_in'])
        rate_limit.RATES.clear()
        self.ok(Client(self.base),'/api/customer/login',{'email':'visitor@example.com','password':'Brand-new-pass-1'})

    def test_accounts_kept_in_an_organization_move_to_the_platform(self):
        from backend.modules.contacts import repository as contacts
        with D.tenant(self.org) as db:
            contacts.insert(db,'c'*32,'ลูกค้ารุ่นเก่า','legacy@example.com','','','','portal')
            db.executescript('''CREATE TABLE customer_accounts (id TEXT PRIMARY KEY, contact_id TEXT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
                phone TEXT NOT NULL DEFAULT '', password TEXT NOT NULL, consent_version TEXT NOT NULL, consent_at TEXT NOT NULL,
                verified_at TEXT NOT NULL, created_at TEXT NOT NULL, last_login_at TEXT);
                CREATE TABLE customer_sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, csrf TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);''')
            db.execute('INSERT INTO customer_accounts VALUES(?,?,?,?,?,?,?,?,?,?,NULL)',('a'*32,'c'*32,'ลูกค้ารุ่นเก่า','legacy@example.com','',
                       password_hash(PASSWORD),'2026-09','2026-09-01T00:00:00+00:00','2026-09-01T00:00:00+00:00','2026-09-01T00:00:00+00:00'))
            db.execute('INSERT INTO customer_contacts VALUES(?,?)',('a'*32,'c'*32))
        D.init()
        with D.tenant(self.org) as db:
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertFalse({'customer_accounts','customer_sessions'} & tables)
        client = Client(self.base)
        self.ok(client,'/api/customer/login',{'email':'legacy@example.com','password':PASSWORD})
        client.customer_csrf = self.ok(client,'/api/customer/account')['csrf']
        conv = self.ok(client,'/api/public/alpha/conversations',{'subject':'ยังใช้บัญชีเดิมได้','body':'ทดสอบ'})['id']
        self.assertEqual(self.ok(self.admin,f'/api/conversations/{conv}')['contact']['id'],'c'*32)


if __name__=='__main__':
    unittest.main()
