"""Customer notifications: preferences per event and channel, linking an account with the organization's LINE by a
6-digit code sent in a 1:1 chat (valid, expired, wrong, reused, limited, read out in a group), a team reply told on
LINE, and the LINE outbox (sent after the commit, retried with the same retry key, closed once the link is gone).
Email and LINE are mocked; nothing leaves the machine."""
import unittest
import uuid
from unittest.mock import patch

import test_app as base
import test_channels as channel_tests
from test_app import app, D, rate_limit
from backend.exceptions.errors import ChannelError
from backend.extensions import channel_transport as T
from backend.modules.channels import service as C
from backend.modules.customers import notify, service as customers

ORG = '/api/public/alpha'
SENDER = channel_tests.SENDER
OTHER = 'U'+'c'*32
SETTINGS = '/api/customer/notification-settings'


class CustomerAlertTests(unittest.TestCase):
    tearDown = base.IntegrationTests.tearDown
    visitor = base.IntegrationTests.visitor
    customer = base.IntegrationTests.customer
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    create_member = base.IntegrationTests.create_member
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD
    configure = channel_tests.ChannelTests.configure
    webhook = channel_tests.ChannelTests.webhook
    event = channel_tests.ChannelTests.event

    def setUp(self):
        base.IntegrationTests.setUp(self)
        # Every LINE push is mocked.
        self.line = patch.object(T,'send_line',return_value='line-request-id').start()
        self.addCleanup(patch.stopall)
        self.events = 0

    # The support page counts requests per address; these tests make many from one.
    def ok(self, client, path, body=None, method=None):
        rate_limit.RATES.clear()
        return base.IntegrationTests.ok(self,client,path,body,method)

    def status(self, client, path, body=None, method=None):
        rate_limit.RATES.clear()
        return client.call(path,body,method)[0]

    # LINE
    def say(self, text, sender=SENDER, kind='user'):
        """A text message to the organization's LINE, received and processed like a real one."""
        self.events += 1
        source = {'type':kind,'userId':sender} if kind=='user' else {'type':kind,'groupId':'C'+'d'*32,'userId':sender}
        route = self.route
        self.assertEqual(self.webhook(route,[self.event(f'event-{self.events}',source=source,
                                                         message={'id':str(self.events),'type':'text','text':text})])[0],200)
        self.assertTrue(C.process_line(self.org,app.store_message))

    def line_on(self):
        self.route = self.configure()['route_id']

    def code(self, client):
        rate_limit.RATES.clear()
        answer = self.ok(client,f'{ORG}/line',{})
        self.assertRegex(answer['code'],r'^[0-9]{6}$')
        return answer['code']

    def link(self, client, sender=SENDER):
        self.say(self.code(client),sender)
        self.assertTrue(self.ok(client,f'{ORG}/line')['linked'])

    def line_messages(self):
        with D.tenant(self.org) as db:
            return [r[0] for r in db.execute("SELECT m.body FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.channel='line'")]

    def outbox(self):
        with D.tenant(self.org) as db:
            return D.rows(db,'SELECT * FROM customer_alert_outbox ORDER BY rowid')

    def replied(self, client):
        """A team reply in a new chat of this customer, past the couple of minutes a notice waits; returns the chat."""
        conv = self.ok(client,f'{ORG}/conversations',{'subject':'สอบถามบริการ','body':'ขอรายละเอียด'})['id']
        self.ok(self.admin,f'/api/conversations/{conv}/messages',{'kind':'reply','body':'ตอบแล้วค่ะ'})
        with D.tenant(self.org) as db:
            db.execute("UPDATE customer_notifications SET created_at='2000-01-01T00:00:00+00:00'")
            db.execute("UPDATE customer_seen SET seen_at='1999-01-01T00:00:00+00:00'")
        customers.send_notices(self.org)
        return conv

    def told(self, email):
        """A LINE notice for the account with this email, queued as a chat reply queues it and sent by a worker round."""
        with D.control() as cd, D.tenant(self.org) as db:
            account_id = cd.execute('SELECT id FROM customer_accounts WHERE email=?',(email,)).fetchone()[0]
            notify.queue_line(cd,db,self.org,account_id,'ทดสอบ','/customer/chats')
        notify.send(self.org)

    def test_preferences_choose_the_channels_of_each_event(self):
        owner = self.customer(email='owner@example.com',name='เจ้าของงาน')
        settings = self.ok(owner,SETTINGS)
        self.assertEqual(settings['events'],[{'key':'reply','label':'ทีมงานตอบกลับในแชท','email':True,'line':True},
                                             {'key':'ai','label':'ผู้ช่วย AI ตอบคำถามในแชท','email':True,'line':True},
                                             {'key':'handoff','label':'ส่งต่อเรื่องให้เจ้าหน้าที่ดูแล','email':True,'line':True},
                                             {'key':'issue','label':'ปัญหาที่ติดตามไว้แก้เสร็จแล้ว','email':True,'line':True}])
        self.assertEqual((settings['email']['ready'],settings['email']['verified'],settings['line']),(True,True,[]))
        self.assertEqual(self.status(owner,SETTINGS,{'events':{'nothing':{'email':True}}}),400)
        self.assertEqual(self.status(owner,SETTINGS,{'events':{'reply':{'email':'yes'}}}),400)
        # A chat reply by email is the old switch: both settings agree.
        self.ok(owner,SETTINGS,{'events':{'reply':{'email':False}}})
        self.assertFalse(self.ok(owner,'/api/customer/account')['notify_email'])
        # Linked with the organization's LINE, a team reply is told there; not once the customer turns LINE off.
        self.line_on()
        self.link(owner)
        notify.send(self.org)
        self.assertEqual([(l['org_slug'],l['linked'],l['oa_name']) for l in self.ok(owner,SETTINGS)['line']],[('alpha',True,'Test OA')])
        self.line.reset_mock()
        before = self.mailer.call_count
        conv = self.replied(owner)
        self.assertEqual(notify.send(self.org),1)
        self.assertEqual(self.line.call_args.args[1],SENDER)
        self.assertIn(f'/customer/chats/alpha/{conv}',self.line.call_args.args[2])
        self.assertNotIn('ตอบแล้วค่ะ',self.line.call_args.args[2])
        self.assertEqual(self.mailer.call_count,before)
        self.ok(owner,SETTINGS,{'events':{'reply':{'line':False}}})
        self.line.reset_mock()
        self.replied(owner)
        self.assertEqual(notify.send(self.org),0)
        self.line.assert_not_called()
        self.ok(owner,'/api/customer/notifications',{'email':True})
        self.assertTrue({e['key']:e for e in self.ok(owner,SETTINGS)['events']}['reply']['email'])

    def test_linking_line_by_a_code(self):
        owner = self.customer(email='owner@example.com',name='เจ้าของงาน')
        other = self.customer(email='other@example.com')
        self.assertEqual(self.ok(owner,f'{ORG}/line'),{'available':False,'linked':False,'linked_at':None,'oa_name':'','code_expires_at':None})
        self.assertEqual(self.status(owner,f'{ORG}/line',{}),409)         # the organization has no LINE yet
        self.line_on()
        first = self.code(owner)
        self.assertTrue(self.ok(owner,f'{ORG}/line')['code_expires_at'])
        # A wrong code is an ordinary message (nothing tells the sender it was a code).
        wrong = f'{(int(first)+1)%10**6:06d}'
        self.say(wrong)
        self.assertEqual(self.line_messages(),[wrong])
        self.assertFalse(self.ok(owner,f'{ORG}/line')['linked'])
        # The live code links the sender and is not stored as a message; LINE confirms through the outbox.
        self.say(f'  {first} ')
        self.assertEqual(self.line_messages(),[wrong])
        status = self.ok(owner,f'{ORG}/line')
        self.assertEqual((status['linked'],status['code_expires_at']),(True,None))
        self.assertEqual(notify.send(self.org),1)
        self.assertEqual(self.line.call_args.args[1],SENDER)
        self.assertIn('เชื่อม LINE',self.line.call_args.args[2])
        self.assertIn('/customer/account',self.line.call_args.args[2])
        # Used once: the same code from someone else is just a message.
        self.say(first,OTHER)
        self.assertEqual(self.line_messages(),[wrong,first])
        # In a group a code is never taken: read out there it stops working and is not kept as a message.
        second = self.code(other)
        self.configure(groups_enabled=True)
        self.say(second,OTHER,'group')
        status = self.ok(other,f'{ORG}/line')
        self.assertEqual((status['linked'],status['code_expires_at']),(False,None))
        self.assertNotIn(second,self.line_messages())
        # A new code replaces the earlier one; an expired code does nothing.
        third = self.code(other)
        self.say(second,OTHER)
        self.assertFalse(self.ok(other,f'{ORG}/line')['linked'])
        with D.tenant(self.org) as db:
            db.execute("UPDATE customer_line_codes SET expires_at='2000-01-01T00:00:00+00:00'")
        self.say(third,OTHER)
        self.assertFalse(self.ok(other,f'{ORG}/line')['linked'])
        # Five wrong codes in an hour: the sixth message is not checked, even a right one.
        fourth = self.code(other)
        for n in range(5):
            self.say(f'{(int(fourth)+n+1)%10**6:06d}',OTHER)
        self.say(fourth,OTHER)
        self.assertFalse(self.ok(other,f'{ORG}/line')['linked'])
        # ...yet a live code is never left in the team's inbox for someone else to send: it stops working instead.
        self.assertNotIn(fourth,self.line_messages())
        self.assertIsNone(self.ok(other,f'{ORG}/line')['code_expires_at'])
        self.say(fourth,SENDER)
        self.assertFalse(self.ok(other,f'{ORG}/line')['linked'])
        with D.tenant(self.org) as db:
            db.execute("UPDATE customer_line_guesses SET since='2000-01-01T00:00:00+00:00'")
        self.say(self.code(other),OTHER)
        self.assertTrue(self.ok(other,f'{ORG}/line')['linked'])
        # One LINE user per account: linking the owner's LINE user to the other account moves it; unlinking ends it.
        self.say(self.code(other),SENDER)
        self.assertEqual((self.ok(owner,f'{ORG}/line')['linked'],self.ok(other,f'{ORG}/line')['linked']),(False,True))
        self.ok(other,f'{ORG}/line',None,'DELETE')
        self.assertFalse(self.ok(other,f'{ORG}/line')['linked'])

    def test_the_outbox_retries_and_closes_what_can_no_longer_go(self):
        owner = self.customer(email='owner@example.com',name='เจ้าของงาน')
        self.line_on()
        self.link(owner)
        notify.send(self.org)
        # LINE: a network failure is tried again later with the same retry key, and gives up after 3 attempts.
        self.line.side_effect = ChannelError('network',retryable=True)
        self.line.reset_mock()
        self.told('owner@example.com')
        row = self.outbox()[-1]
        self.assertEqual((row['sent_at'],row['attempts'],row['error']),(None,1,'network'))
        self.assertEqual(notify.send(self.org),0)                          # not due yet
        with D.tenant(self.org) as db:
            db.execute("UPDATE customer_alert_outbox SET next_at='2000-01-01T00:00:00+00:00' WHERE id=?",(row['id'],))
        self.line.side_effect = None
        self.assertEqual(notify.send(self.org),1)
        keys = {c.args[3] for c in self.line.call_args_list}
        self.assertEqual(len(keys),1)
        self.assertEqual((self.outbox()[-1]['attempts'],self.outbox()[-1]['error']),(2,''))
        self.line.side_effect = ChannelError('network',retryable=True)
        self.told('owner@example.com')
        row = self.outbox()[-1]
        for _ in range(2):
            with D.tenant(self.org) as db:
                db.execute("UPDATE customer_alert_outbox SET next_at='2000-01-01T00:00:00+00:00' WHERE id=?",(row['id'],))
            notify.send(self.org)
        row = self.outbox()[-1]
        self.assertEqual((row['attempts'],row['error'],bool(row['sent_at'])),(3,'network',True))
        self.line.side_effect = None
        # A notice whose LINE link went away meanwhile is closed unsent.
        with D.tenant(self.org) as db:
            # A fresh id (deriving one from an existing id collided whenever that id already began with the same letter).
            db.execute("INSERT INTO customer_alert_outbox(id,account_id,channel,subject,text,link,created_at,next_at) "
                       "SELECT ?,account_id,'line','ทดสอบ','','',created_at,created_at FROM customer_alert_outbox LIMIT 1",(uuid.uuid4().hex,))
        self.ok(owner,f'{ORG}/line',None,'DELETE')
        self.line.reset_mock()
        notify.send(self.org)
        self.line.assert_not_called()
        self.assertEqual(self.outbox()[-1]['error'],'off')


if __name__=='__main__':
    unittest.main()
