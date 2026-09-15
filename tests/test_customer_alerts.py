"""Customer notifications: preferences per event and channel, linking an account with the organization's LINE by a
6-digit code sent in a 1:1 chat (valid, expired, wrong, reused, limited), the notification outbox (sent after the
commit, retried, an uncertain email never twice), reminders sent once, and alerts that reach only people who can act
on them (with their buttons). Email and LINE are mocked; nothing leaves the machine."""
import datetime as dt
import unittest
from unittest.mock import patch

import test_app as base
import test_channels as channel_tests
import test_client_team as team_tests
import test_contracts as contract_tests
from test_app import app, D, rate_limit
from backend.exceptions.errors import ChannelError
from backend.extensions import channel_transport as T
from backend.modules.channels import service as C
from backend.modules.customers import notify

ORG = '/api/public/alpha'
SENDER = channel_tests.SENDER
OTHER = 'U'+'c'*32
SETTINGS = '/api/customer/notification-settings'


def day(offset):
    return (dt.date.today()+dt.timedelta(days=offset)).isoformat()


class CustomerAlertTests(unittest.TestCase):
    tearDown = base.IntegrationTests.tearDown
    visitor = base.IntegrationTests.visitor
    customer = base.IntegrationTests.customer
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    create_member = base.IntegrationTests.create_member
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD
    draft = contract_tests.ContractTests.draft
    signed = contract_tests.ContractTests.signed
    no_email = contract_tests.ContractTests.no_email
    project = contract_tests.ContractTests.project
    configure = channel_tests.ChannelTests.configure
    webhook = channel_tests.ChannelTests.webhook
    event = channel_tests.ChannelTests.event
    ok = team_tests.ClientTeamTests.ok
    status = team_tests.ClientTeamTests.status
    invite = team_tests.ClientTeamTests.invite
    join = team_tests.ClientTeamTests.join
    sent = team_tests.ClientTeamTests.sent

    def setUp(self):
        base.IntegrationTests.setUp(self)
        # Every LINE push is mocked (a linked account is told at once after a contract event).
        self.line = patch.object(T,'send_line',return_value='line-request-id').start()
        self.addCleanup(patch.stopall)
        self.events = 0

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

    def outbox(self, channel=None):
        with D.tenant(self.org) as db:
            return D.rows(db,'SELECT * FROM customer_alert_outbox'+(' WHERE channel=?' if channel else '')+' ORDER BY rowid',(channel,) if channel else ())

    def emailed(self, since):
        return [c.args[2] for c in self.mailer.call_args_list[since:]]

    def alerts(self, client):
        return self.ok(client,'/api/customer/overview')['alerts']

    def test_preferences_choose_the_channels_of_each_event(self):
        owner = self.customer(email='owner@example.com',name='เจ้าของงาน')
        settings = self.ok(owner,SETTINGS)
        events = {e['key']:e for e in settings['events']}
        self.assertEqual((events['contract_review']['email'],events['contract_review']['line'],events['drive']['email']),(True,True,False))
        self.assertEqual((settings['email']['ready'],settings['email']['verified'],settings['line']),(True,True,[]))
        self.assertEqual(self.status(owner,SETTINGS,{'events':{'nothing':{'email':True}}}),400)
        self.assertEqual(self.status(owner,SETTINGS,{'events':{'invoice':{'email':'yes'}}}),400)
        # Sending a document for signing: emailed by default, not once email is turned off for that event.
        before = self.mailer.call_count
        self.sent()
        self.assertEqual(self.emailed(before),['owner@example.com'])
        saved = self.ok(owner,SETTINGS,{'events':{'contract_review':{'email':False},'drive':{'email':True}}})
        events = {e['key']:e for e in saved['events']}
        self.assertEqual((events['contract_review']['email'],events['contract_review']['line'],events['drive']['email']),(False,True,True))
        before = self.mailer.call_count
        self.sent()
        self.assertEqual(self.emailed(before),[])
        # LINE once linked, on for every event by default, and off when the customer says so.
        self.line_on()
        self.link(owner)
        self.assertEqual([(l['org_slug'],l['linked'],l['oa_name']) for l in self.ok(owner,SETTINGS)['line']],[('alpha',True,'Test OA')])
        self.line.reset_mock()
        self.sent()
        self.assertEqual([c.args[1] for c in self.line.call_args_list],[SENDER])
        self.assertIn('/#documents/alpha/',self.line.call_args.args[2])
        self.ok(owner,SETTINGS,{'events':{'contract_review':{'line':False}}})
        self.line.reset_mock()
        self.sent()
        self.line.assert_not_called()
        # A chat reply by email is the old switch: both settings agree.
        self.ok(owner,SETTINGS,{'events':{'reply':{'email':False}}})
        self.assertFalse(self.ok(owner,'/api/customer/account')['notify_email'])
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
        # In a group a code is never taken.
        second = self.code(other)
        self.configure(groups_enabled=True)
        self.say(second,OTHER,'group')
        self.assertFalse(self.ok(other,f'{ORG}/line')['linked'])
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

    def test_the_outbox_retries_and_never_repeats_an_uncertain_email(self):
        owner = self.customer(email='owner@example.com',name='เจ้าของงาน')
        self.line_on()
        self.link(owner)
        notify.send(self.org)
        # LINE: a network failure is tried again later with the same retry key, and gives up after 3 attempts.
        self.line.side_effect = ChannelError('network',retryable=True)
        self.line.reset_mock()
        self.sent()
        row = self.outbox('line')[-1]
        self.assertEqual((row['sent_at'],row['attempts'],row['error']),(None,1,'network'))
        self.assertEqual(notify.send(self.org),0)                          # not due yet
        with D.tenant(self.org) as db:
            db.execute("UPDATE customer_alert_outbox SET next_at='2000-01-01T00:00:00+00:00' WHERE id=?",(row['id'],))
        self.line.side_effect = None
        self.assertEqual(notify.send(self.org),1)
        keys = {c.args[3] for c in self.line.call_args_list}
        self.assertEqual(len(keys),1)
        self.assertEqual((self.outbox('line')[-1]['attempts'],self.outbox('line')[-1]['error']),(2,''))
        self.line.side_effect = ChannelError('network',retryable=True)
        self.sent()
        row = self.outbox('line')[-1]
        for _ in range(2):
            with D.tenant(self.org) as db:
                db.execute("UPDATE customer_alert_outbox SET next_at='2000-01-01T00:00:00+00:00' WHERE id=?",(row['id'],))
            notify.send(self.org)
        row = self.outbox('line')[-1]
        self.assertEqual((row['attempts'],row['error'],bool(row['sent_at'])),(3,'network',True))
        # Email: a temporary refusal is retried; an uncertain delivery is never sent twice.
        self.line.side_effect = None
        self.ok(owner,SETTINGS,{'events':{'contract_review':{'line':False}}})
        self.mailer.side_effect = ChannelError('temporary',retryable=True)
        self.sent()
        row = self.outbox('email')[-1]
        self.assertEqual((row['sent_at'],row['error']),(None,'temporary'))
        with D.tenant(self.org) as db:
            db.execute("UPDATE customer_alert_outbox SET next_at='2000-01-01T00:00:00+00:00' WHERE id=?",(row['id'],))
        self.mailer.side_effect = ChannelError('unknown',uncertain=True)
        before = self.mailer.call_count
        notify.send(self.org)
        row = self.outbox('email')[-1]
        self.assertEqual((row['error'],bool(row['sent_at']),self.mailer.call_count),('unknown',True,before+1))
        self.assertEqual(notify.send(self.org),0)
        self.assertEqual(self.mailer.call_count,before+1)
        # A notice whose LINE link went away meanwhile is closed unsent.
        with D.tenant(self.org) as db:
            db.execute("INSERT INTO customer_alert_outbox(id,account_id,channel,subject,text,link,created_at,next_at) "
                       "SELECT 'f'||substr(id,2),account_id,'line','ทดสอบ','','',created_at,created_at FROM customer_alert_outbox LIMIT 1")
        self.ok(owner,f'{ORG}/line',None,'DELETE')
        self.line.reset_mock()
        notify.send(self.org)
        self.line.assert_not_called()
        self.assertEqual(self.outbox('line')[-1]['error'],'off')

    def test_reminders_go_out_once(self):
        self.customer(email='finance@example.com',name='การเงิน ใจดี')
        self.customer(email='technical@example.com',name='ไอที เก่งมาก')
        owner,contract = self.signed([{'kind':'delivery','title':'ติดตั้งระบบ','due_date':'','amount':''},
                                      {'kind':'payment','title':'ค่างวดแรก','due_date':'','amount':'20000'}],warranty=30,
                                     customer_email='owner@example.com')
        finance,technical = self.customer(email='finance@example.com'),self.customer(email='technical@example.com')
        self.join(owner,finance,'finance@example.com','finance')
        self.join(owner,technical,'technical@example.com','technical')
        install,payment = self.project(owner,contract)['milestones']
        self.ok(self.admin,f'/api/contracts/{contract}/milestones/{install["id"]}/deliver',{'note':'ติดตั้งแล้ว'})
        self.ok(owner,f'{ORG}/contracts/{contract}/milestones/{install["id"]}/accept',{})
        invoice = self.ok(self.admin,f'/api/contracts/{contract}/milestones/{payment["id"]}/invoice',{})['id']
        self.enable_registration_mail()
        with D.tenant(self.org) as db:
            db.execute('UPDATE contract_invoices SET due_date=? WHERE id=?',(day(2),invoice))
        # Due within 3 days: the owner and finance; the warranty ends within 30 days: the owner (decide) only.
        notify.remind(self.org)
        self.assertEqual(notify.send(self.org),3)
        mails = {(c.args[2],c.args[3]['Subject']) for c in self.mailer.call_args_list}
        self.assertEqual({to for to,subject in mails if 'ใกล้ถึงกำหนดชำระ' in subject},{'owner@example.com','finance@example.com'})
        self.assertEqual({to for to,subject in mails if 'การรับประกัน' in subject},{'owner@example.com'})
        self.assertIn(f'/customer/billing/alpha/{invoice}',next(c for c in self.mailer.call_args_list if c.args[2]=='finance@example.com').args[3].get_content())
        # Once a day, and each reminder once whatever how often it runs.
        self.assertEqual(notify.remind(self.org),[])
        self.assertEqual(notify.remind(self.org,force=True),[])
        # Due today, then overdue, then a warranty ending within 7 days: one more each.
        for due in (day(0),day(-1)):
            with D.tenant(self.org) as db:
                db.execute('UPDATE contract_invoices SET due_date=? WHERE id=?',(due,invoice))
            self.assertEqual(len(notify.remind(self.org,force=True)),2)
            self.assertEqual(len(notify.remind(self.org,force=True)),0)
        with D.tenant(self.org) as db:
            db.execute('UPDATE contracts SET coverage_end=? WHERE id=?',(day(5),contract))
        self.assertEqual(len(notify.remind(self.org,force=True)),1)
        # Paid, or an MA renewal asked for: nothing more.
        self.ok(self.admin,f'/api/contracts/{contract}/invoices/{invoice}/confirm',{})
        self.ok(owner,f'{ORG}/contracts/{contract}/renewal',{})
        with D.tenant(self.org) as db:
            db.execute('UPDATE contracts SET coverage_end=? WHERE id=?',(day(3),contract))
        self.assertEqual(notify.remind(self.org,force=True),[])
        self.assertNotIn('technical@example.com',[c.args[2] for c in self.mailer.call_args_list])

    def test_alerts_reach_the_people_who_can_act(self):
        people = {role:self.customer(email=f'{role}@example.com',name=name) for role,name in
                  (('manager','มานพ ดูแล'),('approver','อารี ตรวจรับ'),('finance','การเงิน ใจดี'))}
        owner,contract = self.signed([{'kind':'delivery','title':'ออกแบบระบบ','due_date':'','amount':''},
                                      {'kind':'payment','title':'งวดสุดท้าย','due_date':'','amount':'20000'}],warranty=30,
                                     customer_email='owner@example.com')
        for role,client in people.items():
            self.join(owner,client,f'{role}@example.com',role)
        design,final = self.project(owner,contract)['milestones']
        self.enable_registration_mail()
        before = self.mailer.call_count
        self.ok(self.admin,f'/api/contracts/{contract}/milestones/{design["id"]}/deliver',{'note':'แบบหน้าจอ'})
        # The email too goes only to people who can accept the work.
        self.assertEqual(sorted(c.args[2] for c in self.mailer.call_args_list[before:] if 'ตรวจงานแล้วกดอนุมัติรับงาน' in c.args[3].get_content()),
                         ['manager@example.com','owner@example.com'])
        kinds = lambda client:[a['kind'] for a in self.alerts(client) if a['action']]
        delivery = next(a for a in self.alerts(people['manager']) if a['kind']=='delivery')
        self.assertEqual((delivery['milestone_id'],delivery['action_label'],delivery['org_slug']),(design['id'],'ตรวจรับงาน','alpha'))
        self.assertNotIn('delivery',kinds(people['approver'])+kinds(people['finance']))
        # Invoices: finance and the owner, due within 7 days then overdue; never the signing of a contract.
        invoice = self.ok(self.admin,f'/api/contracts/{contract}/milestones/{final["id"]}/invoice',{})['id']
        self.assertIn('invoice',kinds(people['finance']))
        with D.tenant(self.org) as db:
            db.execute('UPDATE contract_invoices SET due_date=? WHERE id=?',(day(2),invoice))
        due = next(a for a in self.alerts(people['finance']) if a.get('invoice_id')==invoice)
        self.assertEqual((due['kind'],due['days_left'],due['seq'],due['action_label']),('invoice_due',2,2,'ชำระเงิน'))
        with D.tenant(self.org) as db:
            db.execute('UPDATE contract_invoices SET due_date=? WHERE id=?',(day(-3),invoice))
        self.assertIn('invoice_overdue',kinds(owner))
        self.assertNotIn('invoice_overdue',kinds(people['approver']))
        self.sent('owner@example.com')
        self.assertIn('contract',kinds(owner))
        self.assertIn('contract',kinds(people['manager']))
        self.assertNotIn('contract',kinds(people['finance'])+kinds(people['approver']))
        # The warranty: who may ask for the MA renewal (decide).
        self.ok(owner,f'{ORG}/contracts/{contract}/milestones/{design["id"]}/accept',{})
        warranty = next(a for a in self.alerts(people['manager']) if a['kind']=='warranty')
        self.assertEqual((warranty['action_label'],warranty['days_left']),('ขอต่อสัญญา MA',30))
        self.assertNotIn('warranty',kinds(people['approver'])+kinds(people['finance']))

    def test_an_approval_step_is_an_alert_for_whoever_it_waits_for(self):
        owner = self.customer(email='owner@example.com',name='เจ้าของงาน')
        approver = self.customer(email='approver@example.com',name='อารี ตรวจรับ')
        manager = self.customer(email='manager@example.com',name='มานพ ดูแล')
        self.join(owner,approver,'approver@example.com','approver')
        self.join(owner,manager,'manager@example.com','manager')
        reviewer = next(p['account_id'] for p in self.ok(owner,f'{ORG}/team/flows')['reviewers'] if p['name']=='อารี ตรวจรับ')
        self.ok(owner,f'{ORG}/team/flows',{'contract':[reviewer]})
        contract = self.sent()
        mine = next(a for a in self.alerts(approver) if a['kind']=='approval')
        self.assertEqual((mine['contract_id'],mine['target'],mine['step'],mine['steps'],mine['final'],mine['action_label']),
                         (contract,'contract',1,1,False,'ตรวจและอนุมัติ'))
        # Until every step approved, the deciders have nothing to do yet.
        self.assertNotIn('contract',[a['kind'] for a in self.alerts(owner)+self.alerts(manager)])
        self.assertNotIn('approval',[a['kind'] for a in self.alerts(owner)])
        self.ok(approver,f'{ORG}/contracts/{contract}/review',{'decision':'approved','remark':''})
        self.assertNotIn('approval',[a['kind'] for a in self.alerts(approver)])
        final = next(a for a in self.alerts(manager) if a['kind']=='approval')
        self.assertEqual((final['final'],final['action_label']),(True,'ลงนาม'))

    def test_an_invitation_is_an_alert_to_accept(self):
        owner = self.customer(email='owner@example.com',name='เจ้าของงาน')
        member = self.customer(email='staff@example.com',name='สมศรี')
        self.sent()
        row = self.invite(owner,'staff@example.com','technical')
        invite = next(a for a in self.alerts(member) if a['kind']=='invite')
        self.assertEqual((invite['invite_id'],invite['action'],invite['action_label'],invite['org_slug']),(row,True,'รับคำเชิญ','alpha'))
        self.assertIn('เจ้าของงาน',invite['subject'])
        self.assertIn('ฝ่ายเอกสาร/IT',invite['subject'])
        self.assertEqual(self.ok(member,'/api/customer/overview')['alert_count'],1)
        self.ok(member,f'{ORG}/team/{row}/accept',{})
        self.assertNotIn('invite',[a['kind'] for a in self.alerts(member)])


if __name__=='__main__':
    unittest.main()
