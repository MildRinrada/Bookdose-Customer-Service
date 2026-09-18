"""A customer who closed the page hears about what the chatbot did in their web chat: its answer ('ai') and a handoff to
the team they did not ask for themselves ('handoff'). An account holder is told by email (or LINE) as they chose per
event; a guest on every channel they proved. The notice waits the same couple of minutes as a team reply, is dropped
when they read the chat on the page meanwhile, and never contains the messages. Provider and email are mocked."""
import re
import unittest

import test_ai
import test_app as base
import test_guest_chat as guest_tests
from test_app import D
from backend.modules.customers import service as customers
from backend.modules.guest import service as guest


class AINoticeTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    create_member = base.IntegrationTests.create_member
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    customer = base.IntegrationTests.customer
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD
    enable = test_ai.AITests.enable
    article = test_ai.AITests.article
    visitor = test_ai.AITests.visitor
    run_job = test_ai.AITests.run_job

    def events(self, conversation=None):
        with D.tenant(self.org) as db:
            return [r[0] for r in db.execute('SELECT event FROM customer_notifications WHERE ?1 IS NULL OR conversation_id=?1 ORDER BY rowid',
                                             (conversation,))]

    def age(self):
        """Past the couple of minutes a notice waits, and not read on the page since."""
        with D.tenant(self.org) as db:
            db.execute("UPDATE customer_notifications SET created_at='2000-01-01T00:00:00+00:00' WHERE sent_at IS NULL")
            db.execute("UPDATE customer_seen SET seen_at='1999-01-01T00:00:00+00:00'")

    def test_the_chatbots_answer_is_emailed_to_a_customer_who_left_the_page(self):
        self.enable()
        self.article()
        _,conv = self.visitor()
        sent = self.mailer.call_count
        self.run_job()
        self.assertEqual(self.events(conv),['ai'])
        self.assertEqual(customers.send_notices(self.org),0)   # waits like a team reply
        self.age()
        self.assertEqual(customers.send_notices(self.org),1)
        self.assertEqual(self.mailer.call_count,sent+1)
        mail = self.mailer.call_args.args[3]
        self.assertEqual(mail['Subject'],'มีคำตอบใหม่: ดาวน์โหลดรายงานการอ่าน')
        self.assertIn('ผู้ช่วย AI ของ องค์กร A',mail.get_content())
        self.assertIn('/#chats/alpha/'+conv,mail.get_content())
        # Never the answer itself: the link leads to it after signing in.
        self.assertNotIn('เปิดเมนูรายงาน',mail.get_content())

    def test_an_answer_read_on_the_page_is_not_emailed(self):
        self.enable()
        self.article()
        visitor,_ = self.visitor()
        self.run_job()
        with D.tenant(self.org) as db:
            db.execute("UPDATE customer_notifications SET created_at='2000-01-01T00:00:00+00:00'")
        self.ok(visitor,'/api/public/alpha/session')      # still on the page: the answer is read there
        sent = self.mailer.call_count
        self.assertEqual(customers.send_notices(self.org),0)
        self.assertEqual(self.mailer.call_count,sent)

    def test_a_handoff_the_customer_did_not_ask_for_is_told_but_their_own_is_not(self):
        self.enable()
        _,conv = self.visitor(body='quantum-unrelated-zebra')
        self.run_job()                                      # nothing in the knowledge base: straight to the team
        self.assertEqual(self.events(conv),['handoff'])
        self.age()
        self.assertEqual(customers.send_notices(self.org),1)
        mail = self.mailer.call_args.args[3]
        self.assertEqual(mail['Subject'],'ส่งต่อให้เจ้าหน้าที่แล้ว: ดาวน์โหลดรายงานการอ่าน')
        self.assertIn('เจ้าหน้าที่จะตอบกลับในแชทนี้',mail.get_content())
        # Asking for a person on the page tells nobody by email: they are looking at the page.
        self.article()
        second,other = self.visitor()
        self.ok(second,'/api/public/alpha/handoff',{})
        self.assertEqual(self.events(other),[])

    def test_each_event_follows_the_customers_own_choice(self):
        self.enable()
        self.article()
        visitor,conv = self.visitor()
        self.ok(visitor,'/api/customer/notification-settings',{'events':{'ai':{'email':False}}})
        settings = {e['key']:e for e in self.ok(visitor,'/api/customer/notification-settings')['events']}
        self.assertEqual((settings['ai']['email'],settings['handoff']['email'],settings['reply']['email']),(False,True,True))
        self.run_job()
        self.assertEqual(self.events(conv),[])
        # A team reply is still told: switching one event off leaves the others as they were.
        self.ok(self.admin,f'/api/conversations/{conv}/messages',{'kind':'reply','body':'เจ้าหน้าที่ตอบเพิ่มเติม'})
        self.assertEqual(self.events(conv),['reply'])


class GuestAINoticeTests(guest_tests.GuestChatTests):
    """A guest who proved an email by opening a follow link hears about the chatbot's answer there too."""
    enable = test_ai.AITests.enable
    article = test_ai.AITests.article
    run_job = test_ai.AITests.run_job

    def test_a_guest_hears_about_the_chatbots_answer_on_the_proven_email(self):
        self.customer_mail()
        self.enable()
        self.article()
        page = self.browser()
        conv = self.started(page,body='ดาวน์โหลดรายงานการอ่านอย่างไร')
        self.send_link(page)
        _,(status,_) = self.resume(self.emailed_token(),page)
        self.assertEqual(status,200)
        sent = self.mailer.call_count
        self.run_job()
        self.assertEqual([(n['channel'],n['event']) for n in self.notices() if n['conversation_id']==conv],[('email','ai')])
        self.age_notices()
        self.assertEqual(guest.send_notices(self.org),1)
        self.assertEqual(self.mailer.call_count,sent+1)
        mail = self.mailer.call_args.args[3]
        self.assertIn('ผู้ช่วย AI ของ องค์กร A',mail.get_content())
        self.assertNotIn('เปิดเมนูรายงาน',mail.get_content())
        self.assertTrue(re.search(r'/chat/alpha/resume#t=[A-Za-z0-9_-]{43}',mail.get_content()))


# Only the new tests: the guest chat's own tests run from test_guest_chat.
for _name in [n for n in dir(guest_tests.GuestChatTests) if n.startswith('test_')]:
    setattr(GuestAINoticeTests,_name,None)


if __name__=='__main__':
    unittest.main()
