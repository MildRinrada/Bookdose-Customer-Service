"""A staff member's working preferences (staff_prefs): the work status, hours and leave that keep routing rules and
SLA escalation from giving them new cases while they are away; the emails they asked for about their own work; the
signature and the name customers see on their replies; and their own quick replies. Email is mocked; nothing leaves
the machine."""
import datetime as dt
import unittest

import test_app as base
from test_app import D
from backend.modules.automation import service as A
from backend.modules.staff_prefs import service as P
from backend.modules.staff_prefs.model import WORK_TZ
from backend.utils.dates import after

PREFS = '/api/account/preferences'


class StaffPrefsTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    visitor = base.IntegrationTests.visitor
    customer = base.IntegrationTests.customer
    create_member = base.IntegrationTests.create_member
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD

    def ticket_of(self, conversation):
        return self.ok(self.admin,f'/api/conversations/{conversation}')['ticket']

    def mails_to(self, email):
        return [c.args[3] for c in self.mailer.call_args_list if c.args[2]==email]

    def test_saving_each_section_is_checked(self):
        agent,_ = self.create_member()
        view = self.ok(agent,PREFS)
        self.assertEqual((view['preferences']['status'],view['availability']['available']),('online',True))
        self.assertTrue(view['preferences']['notify']['celebrate'])
        self.assertTrue(view['preferences']['notify']['popup'])  # the in-app pop-up is on until the member turns it off
        saved = self.ok(agent,PREFS,{'hours':{'enabled':True,'days':[0,1,2,3,4],'start':'08:30','end':'17:30'},
                                     'leave':[{'from':'2026-12-28','to':'2026-12-31','note':'พักร้อน'}],
                                     'notify':{'desktop':True,'sound':True,'email':False,'events':{'assigned':True,'customer_reply':False,'sla':True}},
                                     'signature':{'enabled':True,'text':'ขอบคุณค่ะ\nฝ่ายบริการลูกค้า'},'alias':'น้องบี',
                                     'snippets':[{'shortcut':'/Thanks','text':'ขอบคุณที่ติดต่อเราค่ะ'},{'shortcut':'รอสักครู่','text':'รบกวนรอสักครู่นะคะ'}]})['preferences']
        self.assertEqual(saved['hours']['start'],'08:30')
        self.assertEqual([s['shortcut'] for s in saved['snippets']],['thanks','รอสักครู่'])
        self.assertFalse(saved['notify']['events']['customer_reply'])
        self.assertFalse(self.ok(agent,PREFS,{'notify':{**saved['notify'],'celebrate':False}})['preferences']['notify']['celebrate'])
        self.assertFalse(self.ok(agent,PREFS,{'notify':{**saved['notify'],'popup':False}})['preferences']['notify']['popup'])
        # A later save of one section keeps the others.
        self.ok(agent,PREFS,{'alias':''})
        self.assertEqual(self.ok(agent,PREFS)['preferences']['signature']['text'],'ขอบคุณค่ะ\nฝ่ายบริการลูกค้า')
        for body in ({'status':'sleeping'},{'hours':{'enabled':True,'days':[],'start':'09:00','end':'18:00'}},
                     {'hours':{'enabled':False,'days':[1],'start':'9:00','end':'18:00'}},
                     {'leave':[{'from':'2026-12-31','to':'2026-12-01'}]},{'signature':{'enabled':True,'text':''}},
                     {'snippets':[{'shortcut':'a','text':'x'},{'shortcut':'A','text':'y'}]},{'snippets':[{'shortcut':'มี ช่องว่าง','text':'x'}]},
                     {'alias':'x'*61},{'unknown':1},{'notify':{'events':{'party':True}}},{'notify':{'celebrate':'yes'}}):
            self.assertEqual(agent.call(PREFS,body)[0],400,body)
        # Each account has its own; a visitor has none.
        self.assertEqual(self.ok(self.admin,PREFS)['preferences']['alias'],'')
        self.assertEqual(base.Client(self.base).call(PREFS)[0],401)

    def test_availability_follows_status_leave_and_hours(self):
        prefs = P.schema.merged({})
        monday_10 = dt.datetime(2026,9,21,10,0,tzinfo=WORK_TZ)
        self.assertTrue(P.availability(prefs,monday_10)['available'])
        prefs['status'] = 'break'
        self.assertEqual(P.availability(prefs,monday_10)['reason'],'พักเบรก / ทานข้าว')
        prefs['status'] = 'online'
        prefs['leave'] = [{'from':'2026-09-21','to':'2026-09-21','note':''}]
        self.assertFalse(P.availability(prefs,monday_10)['available'])
        prefs['leave'] = []
        prefs['hours'] = {'enabled':True,'days':[0,1,2,3,4],'start':'09:00','end':'18:00'}
        self.assertTrue(P.availability(prefs,monday_10)['available'])
        self.assertFalse(P.availability(prefs,monday_10.replace(hour=18))['available'])
        self.assertFalse(P.availability(prefs,monday_10+dt.timedelta(days=5))['available'])     # Saturday
        # A night shift belongs to the day it started: Friday 22:00 to Saturday 06:00.
        prefs['hours'] = {'enabled':True,'days':[4],'start':'22:00','end':'06:00'}
        friday = dt.datetime(2026,9,25,23,0,tzinfo=WORK_TZ)
        self.assertTrue(P.availability(prefs,friday)['available'])
        self.assertTrue(P.availability(prefs,friday+dt.timedelta(hours=5))['available'])
        self.assertFalse(P.availability(prefs,friday+dt.timedelta(hours=8))['available'])

    def test_a_member_on_a_break_gets_no_new_case_from_a_rule(self):
        agent,agent_id = self.create_member()
        self.ok(self.admin,'/api/automation/rules',{'name':'ระบบล่มให้บี','channel':'web','keywords':'ระบบล่ม','set_assignee_id':agent_id})
        self.ok(agent,'/api/account/status',{'status':'break'})
        _,first = self.visitor(email='one@example.com',subject='ระบบล่ม',body='ระบบล่มตั้งแต่เช้า')
        ticket = self.ticket_of(first)
        self.assertIsNone(ticket['assignee_id'])
        events = self.ok(self.admin,f"/api/tickets/{ticket['id']}")['events']
        self.assertTrue(any('พักเบรก' in (e['detail'] or '') for e in events))
        # The team sees the break in the workspace; back online, the rule gives the next case to them.
        member = next(m for m in self.ok(self.admin,'/api/workspace')['members'] if m['id']==agent_id)
        self.assertEqual((member['availability']['status'],member['availability']['available']),('break',False))
        self.ok(agent,'/api/account/status',{'status':'online'})
        _,second = self.visitor(email='two@example.com',subject='ระบบล่ม',body='ระบบล่มอีกแล้ว')
        self.assertEqual(self.ticket_of(second)['assignee_id'],agent_id)
        # On leave today: no new case either.
        today = dt.datetime.now(WORK_TZ).date().isoformat()
        self.ok(agent,PREFS,{'leave':[{'from':today,'to':today,'note':''}]})
        _,third = self.visitor(email='three@example.com',subject='ระบบล่ม',body='ระบบล่มครั้งที่สาม')
        self.assertIsNone(self.ticket_of(third)['assignee_id'])

    def test_escalation_goes_to_an_available_lead(self):
        first,first_id = self.create_member(role='admin',email='lead1@example.com')
        second,second_id = self.create_member(role='admin',email='lead2@example.com')
        # The organization's first owner is away: the two under test are the ones to choose from.
        self.ok(self.admin,'/api/account/status',{'status':'offline'})
        with D.control() as cd, D.tenant(self.org) as db:
            A.escalate_due(cd,db,self.org)
        for away,expected in ((first,second_id),(second,first_id)):
            self.ok(first,'/api/account/status',{'status':'online'})
            self.ok(second,'/api/account/status',{'status':'online'})
            self.ok(away,'/api/account/status',{'status':'busy'})
            with D.tenant(self.org) as db:
                db.execute("UPDATE tickets SET status='closed'")
                db.commit()
            _,conv = self.visitor(email=f'{expected[:6]}@example.com')
            tid = self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']
            with D.control() as cd, D.tenant(self.org) as db:
                db.execute('UPDATE tickets SET created_at=? WHERE id=?',(after(minutes=-30),tid))
                db.commit()
                self.assertEqual(A.escalate_due(cd,db,self.org),1)
            self.assertEqual(self.ok(self.admin,f'/api/tickets/{tid}')['ticket']['assignee_id'],expected)

    def test_signature_and_alias_are_on_replies_not_on_notes(self):
        agent,_ = self.create_member()
        visitor,conv = self.visitor()
        self.ok(agent,PREFS,{'signature':{'enabled':True,'text':'ขอบคุณค่ะ · ฝ่ายบริการ'},'alias':'น้องบี'})
        self.ok(agent,f'/api/conversations/{conv}/messages',{'kind':'reply','body':'ตรวจสอบให้แล้วค่ะ'})
        self.ok(agent,f'/api/conversations/{conv}/messages',{'kind':'note','body':'ลูกค้ารายนี้ใช้แอปเวอร์ชันเก่า'})
        messages = self.ok(self.admin,f'/api/conversations/{conv}')['messages']
        reply = next(m for m in messages if m['kind']=='reply')
        note = next(m for m in messages if m['kind']=='note')
        self.assertEqual(reply['author_name'],'น้องบี')
        self.assertEqual(reply['body'],'ตรวจสอบให้แล้วค่ะ\n\nขอบคุณค่ะ · ฝ่ายบริการ')
        self.assertEqual((note['author_name'],note['body']),('เจ้าหน้าที่ทดสอบ','ลูกค้ารายนี้ใช้แอปเวอร์ชันเก่า'))
        # The customer reads the chosen name and the signature.
        public = self.ok(visitor,f'/api/public/alpha/session?conversation={conv}')['messages']
        seen = next(m for m in public if m['kind']=='reply')
        self.assertEqual(seen['author_name'],'น้องบี')
        self.assertTrue(seen['body'].endswith('ขอบคุณค่ะ · ฝ่ายบริการ'))
        self.assertNotIn('ลูกค้ารายนี้ใช้แอปเวอร์ชันเก่า',str(public))

    def test_emails_go_only_for_the_events_a_member_chose(self):
        self.enable_registration_mail()
        agent,agent_id = self.create_member()
        visitor,conv = self.visitor()
        tid = self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']
        # Email is off by default: the assignment is queued, then closed unsent.
        self.ok(self.admin,f'/api/tickets/{tid}',{'assignee_id':agent_id},'PATCH')
        self.assertEqual(P.send_notices(self.org),0)
        self.assertEqual(self.mails_to('agent@example.com'),[])
        self.ok(agent,PREFS,{'notify':{'desktop':False,'sound':False,'email':True,'events':{'assigned':True,'customer_reply':True,'sla':False}}})
        self.ok(self.admin,f'/api/tickets/{tid}',{'assignee_id':None},'PATCH')
        self.ok(self.admin,f'/api/tickets/{tid}',{'assignee_id':agent_id},'PATCH')
        self.ok(visitor,'/api/public/alpha/messages',{'body':'ขอบคุณค่ะ ตอนนี้ยังเปิดไม่ได้'})
        self.assertEqual(P.send_notices(self.org),2)
        subjects = [str(m['Subject']) for m in self.mails_to('agent@example.com')]
        self.assertTrue(any('มอบหมายให้คุณ' in s for s in subjects),subjects)
        self.assertTrue(any('ลูกค้าตอบกลับ' in s for s in subjects),subjects)
        self.assertIn('https://bookdose.example.com/tickets/'+tid,self.mails_to('agent@example.com')[0].get_content())
        # Taking a case yourself tells you nothing; an event left off stays quiet.
        with D.tenant(self.org) as db:
            db.execute('DELETE FROM staff_notices')
            db.commit()
        self.ok(agent,PREFS,{'notify':{'desktop':False,'sound':False,'email':True,'events':{'assigned':True,'customer_reply':False,'sla':False}}})
        self.ok(agent,f'/api/tickets/{tid}',{'assignee_id':None},'PATCH')
        self.ok(agent,f'/api/tickets/{tid}',{'assignee_id':agent_id},'PATCH')
        self.ok(visitor,'/api/public/alpha/messages',{'body':'ยังไม่ได้ค่ะ'})
        self.assertEqual(P.send_notices(self.org),0)

    def test_the_test_email_goes_to_the_member_only_when_mail_is_set_up(self):
        agent,_ = self.create_member()
        self.assertEqual(agent.call(PREFS+'/test-email',{})[0],503)
        self.enable_registration_mail()
        self.assertEqual(self.ok(agent,PREFS+'/test-email',{})['email'],'agent@example.com')
        self.assertEqual(len(self.mails_to('agent@example.com')),1)


if __name__=='__main__':
    unittest.main()
