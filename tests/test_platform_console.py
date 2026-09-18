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
        data = self.ok(self.owner,'/api/platform/system')
        self.assertGreaterEqual(data['requests'],2)
        self.assertGreaterEqual(data['client_errors'],1)
        self.assertEqual(len(data['hours']),24)
        self.assertIn(self.org,[u['id'] for u in data['tenant_usage']])
        self.assertEqual(data['organizations']['active'],1)
        self.assertEqual({w['name'] for w in data['workers']},{'ai','channels','email','automation'})
        self.assertGreater(data['server']['disk_total'],0)
        self.assertEqual(set(data['queues']),{'outbox_waiting','outbox_failed','ai_pending','notices_pending'})

    def test_global_faq_reaches_its_audience_in_every_organization(self):
        seeded = self.ok(self.owner,'/api/platform/faq')['articles']
        self.assertEqual({a['audience'] for a in seeded},{'platform','staff','customer'})
        for article in seeded:
            self.ok(self.owner,f'/api/platform/faq/{article["id"]}',None,'DELETE')
        ids = {audience:self.ok(self.owner,'/api/platform/faq',{'title':f'บทความ {audience}','category':'ทดสอบ','body':'เนื้อหา','audience':audience})['id']
               for audience in ('platform','staff','customer')}
        self.assertEqual(self.owner.call('/api/platform/faq',{'title':'x','category':'y','body':'z','audience':'everyone'})[0],400)
        agent,_ = self.create_member()
        self.assertEqual(agent.call('/api/platform/faq')[0],403)
        # A new article is a draft: nobody reads it until it is published.
        self.assertEqual({a['state'] for a in self.ok(self.owner,'/api/platform/faq')['articles']},{'draft'})
        self.assertEqual(self.ok(agent,'/api/guides')['articles'],[])
        self.assertEqual(self.ok(Client(self.base),'/api/public/alpha')['articles'],[])
        self.assertEqual(agent.call(f'/api/platform/faq/{ids["staff"]}/publish',{})[0],403)
        for article_id in ids.values():
            self.ok(self.owner,f'/api/platform/faq/{article_id}/publish',{})
        self.assertEqual(self.owner.call(f'/api/platform/faq/{ids["staff"]}/publish',{})[0],409)
        self.assertEqual([a['id'] for a in self.ok(agent,'/api/guides')['articles']],[ids['staff']])
        public = [a['id'] for a in self.ok(Client(self.base),'/api/public/alpha')['articles']]
        self.assertIn(ids['customer'],public)
        self.assertNotIn(ids['staff'],public)
        self.assertNotIn(ids['platform'],public)
        # Customers of an organization created later read it too.
        self.ok(self.owner,'/api/platform/tenants',{'name':'องค์กร B','slug':'beta','email':'admin@example.com'})
        self.assertIn(ids['customer'],[a['id'] for a in self.ok(Client(self.base),'/api/public/beta')['articles']])
        # Changes to a published article wait: readers keep the published words until the changes are published.
        public_article = lambda: next((a for a in self.ok(Client(self.base),'/api/public/alpha')['articles'] if a['id']==ids['customer']),None)
        self.ok(self.owner,f'/api/platform/faq/{ids["customer"]}',{'title':'แก้แล้ว','category':'ทดสอบ','body':'ใหม่','audience':'customer'},'PATCH')
        self.assertEqual(public_article()['title'],'บทความ customer')
        edited = next(a for a in self.ok(self.owner,'/api/platform/faq')['articles'] if a['id']==ids['customer'])
        self.assertEqual((edited['state'],edited['title'],edited['live']['title']),('changed','แก้แล้ว','บทความ customer'))
        # Thrown away: back to the published words.
        self.ok(self.owner,f'/api/platform/faq/{ids["customer"]}/changes',None,'DELETE')
        self.assertEqual(next(a for a in self.ok(self.owner,'/api/platform/faq')['articles'] if a['id']==ids['customer'])['state'],'published')
        self.assertEqual(self.owner.call(f'/api/platform/faq/{ids["customer"]}/changes',None,'DELETE')[0],409)
        # Changed again and published: readers see the new words.
        self.ok(self.owner,f'/api/platform/faq/{ids["customer"]}',{'title':'แก้แล้ว','category':'ทดสอบ','body':'ใหม่','audience':'customer'},'PATCH')
        self.ok(self.owner,f'/api/platform/faq/{ids["customer"]}/publish',{})
        self.assertEqual((public_article()['title'],public_article()['body']),('แก้แล้ว','ใหม่'))
        # A new audience waits too, then moves the article away from customers once published.
        self.ok(self.owner,f'/api/platform/faq/{ids["customer"]}',{'title':'แก้แล้ว','category':'ทดสอบ','body':'ใหม่','audience':'staff'},'PATCH')
        self.assertIsNotNone(public_article())
        self.ok(self.owner,f'/api/platform/faq/{ids["customer"]}/publish',{})
        self.assertIsNone(public_article())
        # Unpublished: gone from readers, kept as a draft.
        self.ok(self.owner,f'/api/platform/faq/{ids["staff"]}/unpublish',{})
        self.assertEqual([a['id'] for a in self.ok(agent,'/api/guides')['articles']],[ids['customer']])
        self.assertEqual(self.owner.call(f'/api/platform/faq/{ids["staff"]}/unpublish',{})[0],409)
        events = [e['action'] for e in self.ok(self.owner,'/api/platform/tenants')['audit']]
        self.assertTrue({'faq.published','faq.unpublished','faq.changes_discarded'} <= set(events))
        self.assertEqual(self.owner.call('/api/platform/faq/'+'0'*32,None,'DELETE')[0],404)
        self.assertEqual(self.owner.call('/api/platform/faq/'+'0'*32+'/publish',{})[0],404)

    def test_articles_from_before_drafts_stay_published(self):
        from backend.modules.platform import repository
        with D.control() as cd:
            cd.executescript('''ALTER TABLE global_articles RENAME TO new_articles;
                CREATE TABLE global_articles (id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, body TEXT NOT NULL,
                    audience TEXT NOT NULL, author TEXT NOT NULL, updated_at TEXT NOT NULL);
                INSERT INTO global_articles SELECT id,title,category,body,audience,author,updated_at FROM new_articles;
                DROP TABLE new_articles;''')
            repository.add_publish_columns(cd)
            self.assertEqual(cd.execute('SELECT COUNT(*) FROM global_articles WHERE published_at IS NULL').fetchone()[0],0)
        self.assertTrue(self.ok(Client(self.base),'/api/public/alpha')['articles'])

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
        self.assertEqual([a['id'] for a in self.ok(self.owner,'/api/platform/admins')['admins']],[me])
        agent,_ = self.create_member()
        self.assertEqual(agent.call('/api/platform/admins')[0],403)
        self.assertEqual(self.owner.call(f'/api/platform/admins/{me}',None,'DELETE')[0],400)
        self.ok(self.owner,'/api/platform/admins',{'email':'agent@example.com'})
        self.assertEqual(self.owner.call('/api/platform/admins',{'email':'agent@example.com'})[0],409)
        # The role applies from the next request, next to the account's work in its organization.
        self.assertEqual(agent.call('/api/platform/system')[0],200)
        self.assertEqual(agent.call('/api/tickets')[0],200)
        self.assertEqual(self.owner.call('/api/platform/admins',{'email':'ops@example.com'})[0],400)
        ops_id = self.ok(self.owner,'/api/platform/admins',{'email':'ops@example.com','admin_name':'ทีมเซิร์ฟเวอร์','password':'Test-password-123!'})['id']
        ops = Client(self.base)
        ops.login('ops@example.com')
        self.assertEqual(ops.call('/api/platform/system')[0],200)
        self.ok(self.owner,f'/api/platform/admins/{ops_id}',None,'DELETE')
        self.assertEqual(ops.call('/api/platform/system')[0],403)
        events = [e['action'] for e in self.ok(self.owner,'/api/platform/tenants')['audit']]
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
