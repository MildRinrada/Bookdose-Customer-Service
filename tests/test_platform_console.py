"""Platform console: the system overview, the global FAQ and who reads it, the platform team, and the customer's
choice of reply emails. Email is mocked; nothing leaves the machine."""
import unittest

import test_app as base
from test_app import Client, D


class PlatformConsoleTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    create_member = base.IntegrationTests.create_member
    customer = base.IntegrationTests.customer
    visitor = base.IntegrationTests.visitor
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD

    def test_system_overview_is_for_the_platform_team_only(self):
        agent,_ = self.create_member()
        self.assertEqual(agent.call('/api/platform/system')[0],403)
        self.ok(self.admin,'/api/tickets')
        self.assertEqual(self.admin.call('/api/tickets/'+'0'*32)[0],404)
        data = self.ok(self.admin,'/api/platform/system')
        self.assertGreaterEqual(data['requests'],2)
        self.assertGreaterEqual(data['client_errors'],1)
        self.assertEqual(len(data['hours']),24)
        self.assertIn(self.org,[u['id'] for u in data['tenant_usage']])
        self.assertEqual(data['organizations']['active'],1)
        self.assertEqual({w['name'] for w in data['workers']},{'ai','channels','email','automation'})
        self.assertGreater(data['server']['disk_total'],0)
        self.assertEqual(set(data['queues']),{'outbox_waiting','outbox_failed','ai_pending','notices_pending'})

    def test_global_faq_reaches_its_audience_in_every_organization(self):
        seeded = self.ok(self.admin,'/api/platform/faq')['articles']
        self.assertEqual({a['audience'] for a in seeded},{'platform','staff','customer'})
        for article in seeded:
            self.ok(self.admin,f'/api/platform/faq/{article["id"]}',None,'DELETE')
        ids = {audience:self.ok(self.admin,'/api/platform/faq',{'title':f'บทความ {audience}','category':'ทดสอบ','body':'เนื้อหา','audience':audience})['id']
               for audience in ('platform','staff','customer')}
        self.assertEqual(self.admin.call('/api/platform/faq',{'title':'x','category':'y','body':'z','audience':'everyone'})[0],400)
        agent,_ = self.create_member()
        self.assertEqual(agent.call('/api/platform/faq')[0],403)
        self.assertEqual([a['id'] for a in self.ok(agent,'/api/guides')['articles']],[ids['staff']])
        public = [a['id'] for a in self.ok(Client(self.base),'/api/public/alpha')['articles']]
        self.assertIn(ids['customer'],public)
        self.assertNotIn(ids['staff'],public)
        self.assertNotIn(ids['platform'],public)
        # Customers of an organization created later read it too.
        self.ok(self.admin,'/api/platform/tenants',{'name':'องค์กร B','slug':'beta','email':'admin@example.com'})
        self.assertIn(ids['customer'],[a['id'] for a in self.ok(Client(self.base),'/api/public/beta')['articles']])
        self.ok(self.admin,f'/api/platform/faq/{ids["customer"]}',{'title':'แก้แล้ว','category':'ทดสอบ','body':'ใหม่','audience':'staff'},'PATCH')
        self.assertNotIn(ids['customer'],[a['id'] for a in self.ok(Client(self.base),'/api/public/alpha')['articles']])
        self.assertEqual(self.admin.call('/api/platform/faq/'+'0'*32,None,'DELETE')[0],404)

    def test_starter_articles_are_added_once(self):
        with D.control() as cd:
            before = cd.execute('SELECT COUNT(*) FROM global_articles').fetchone()[0]
            cd.execute('DELETE FROM global_articles')
        D.init()
        with D.control() as cd:
            self.assertEqual(cd.execute('SELECT COUNT(*) FROM global_articles').fetchone()[0],0)
        self.assertGreater(before,0)

    def test_platform_team_grows_and_shrinks_but_never_to_nobody(self):
        me = self.boot['user']['id']
        self.assertEqual([a['id'] for a in self.ok(self.admin,'/api/platform/admins')['admins']],[me])
        agent,_ = self.create_member()
        self.assertEqual(agent.call('/api/platform/admins')[0],403)
        self.assertEqual(self.admin.call(f'/api/platform/admins/{me}',None,'DELETE')[0],400)
        self.ok(self.admin,'/api/platform/admins',{'email':'agent@example.com'})
        self.assertEqual(self.admin.call('/api/platform/admins',{'email':'agent@example.com'})[0],409)
        # The role applies from the next request, next to the account's work in its organization.
        self.assertEqual(agent.call('/api/platform/system')[0],200)
        self.assertEqual(agent.call('/api/tickets')[0],200)
        self.assertEqual(self.admin.call('/api/platform/admins',{'email':'ops@example.com'})[0],400)
        ops_id = self.ok(self.admin,'/api/platform/admins',{'email':'ops@example.com','admin_name':'ทีมเซิร์ฟเวอร์','password':'Test-password-123!'})['id']
        ops = Client(self.base)
        ops.login('ops@example.com')
        self.assertEqual(ops.call('/api/platform/system')[0],200)
        self.ok(self.admin,f'/api/platform/admins/{ops_id}',None,'DELETE')
        self.assertEqual(ops.call('/api/platform/system')[0],403)
        events = [e['action'] for e in self.ok(self.admin,'/api/platform/tenants')['audit']]
        self.assertIn('platform.admin_added',events)
        self.assertIn('platform.admin_removed',events)

    def test_customer_can_turn_off_reply_emails(self):
        visitor,conv = self.visitor()
        self.assertTrue(self.ok(visitor,'/api/customer/account')['notify_email'])
        self.assertEqual(visitor.call('/api/customer/notifications',{'email':'no'})[0],400)
        self.ok(visitor,'/api/customer/notifications',{'email':False})
        self.assertFalse(self.ok(visitor,'/api/customer/account')['notify_email'])
        self.ok(self.admin,f'/api/conversations/{conv}/messages',{'kind':'reply','body':'ตอบแล้ว'})
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM customer_notifications').fetchone()[0],0)
        self.ok(visitor,'/api/customer/notifications',{'email':True})
        self.ok(self.admin,f'/api/conversations/{conv}/messages',{'kind':'reply','body':'ตอบอีกครั้ง'})
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM customer_notifications').fetchone()[0],1)


if __name__=='__main__':
    unittest.main()
