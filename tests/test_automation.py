"""Routing rules, SLA escalation, macros, CSAT, @mentions, the manager dashboard and Facebook Messenger.
Each test uses a disposable database; Facebook is mocked, no message leaves the machine."""
import hashlib
import hmac
import json
import unittest
from unittest.mock import patch

import test_app as base
from test_app import D
from backend.extensions import channel_transport as T
from backend.modules.automation import service as A
from backend.modules.channels import facebook as F, service as C
from backend.utils.dates import after

PAGE = '1234567890'
PSID = '9876543210'


class AutomationTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    visitor = base.IntegrationTests.visitor
    create_member = base.IntegrationTests.create_member
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    customer = base.IntegrationTests.customer
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD

    def new_team(self, name='ทีมเทคนิค'):
        return self.ok(self.admin,'/api/teams',{'name':name})['id']

    def ticket_of(self, conversation):
        return self.ok(self.admin,f'/api/conversations/{conversation}')['ticket']

    def open_case(self, conversation):
        return self.ok(self.admin,f'/api/conversations/{conversation}/ticket',{})['id']

    # Routing rules
    def test_rule_opens_routes_and_prioritises_matching_conversation(self):
        accounting = self.new_team()
        rule = self.ok(self.admin,'/api/automation/rules',{'name':'ระบบล่มจากเว็บ','channel':'web','keywords':'ระบบล่ม, เข้าไม่ได้',
                                                          'set_priority':'high','set_team_id':accounting})['id']
        _,plain = self.visitor()
        self.assertIsNone(self.ticket_of(plain))
        _,paid = self.visitor(email='down@example.com',subject='สอบถาม',body='ระบบล่มตั้งแต่เช้า ยังใช้งานไม่ได้')
        ticket = self.ticket_of(paid)
        self.assertEqual((ticket['priority'],ticket['team_id']),('high',accounting))
        self.assertEqual(self.ok(self.admin,f'/api/conversations/{paid}')['conversation']['team_id'],accounting)
        events = self.ok(self.admin,f"/api/tickets/{ticket['id']}")['events']
        self.assertIn('automation.rule_applied',[e['action'] for e in events])
        # A disabled rule does nothing; a rule for another channel does not match the web.
        self.ok(self.admin,f'/api/automation/rules/{rule}',{'name':'ปิดไว้','enabled':False,'channel':'web','keywords':'ระบบล่ม','set_priority':'high'},'PATCH')
        self.ok(self.admin,'/api/automation/rules',{'name':'LINE เท่านั้น','channel':'line','keywords':'ระบบล่ม','set_priority':'urgent'})
        _,again = self.visitor(email='down@example.com',subject='ระบบล่ม',body='ระบบล่มอีกครั้ง')
        self.assertIsNone(self.ticket_of(again))

    def test_rule_applies_to_cases_staff_open_and_keeps_owner_in_team(self):
        accounting = self.new_team()
        _,outsider = self.create_member(email='outside@example.com')
        self.ok(self.admin,'/api/automation/rules',{'name':'ด่วนข้อมูลหาย','channel':'manual','keywords':'ข้อมูลหาย','set_priority':'urgent','set_team_id':accounting})
        contact = self.ok(self.admin,'/api/contacts')['contacts'][0]['id']
        tid = self.ok(self.admin,'/api/tickets',{'subject':'ข้อมูลหาย','contact_id':contact,'team_id':self.team,'assignee_id':outsider})['id']
        ticket = self.ok(self.admin,f'/api/tickets/{tid}')['ticket']
        # The owner belonged to the old team, so the case moves without them.
        self.assertEqual((ticket['priority'],ticket['team_id'],ticket['assignee_id']),('urgent',accounting,None))

    def test_only_admins_and_leads_manage_automation(self):
        agent,_ = self.create_member()
        self.assertEqual(agent.call('/api/automation')[0],403)
        self.assertEqual(agent.call('/api/automation/rules',{'name':'x','set_priority':'high'})[0],403)
        self.assertEqual(agent.call('/api/automation/settings',{'escalation_minutes':5},'PATCH')[0],403)
        self.assertIsNone(self.ok(agent,'/api/automation/overview')['manager'])
        for body in ({'name':'ไม่มีการกระทำ'},{'name':'ช่องทางผิด','channel':'fax','set_priority':'high'},
                     {'name':'ทีมผิด','set_team_id':'0'*32}):
            self.assertIn(self.admin.call('/api/automation/rules',body)[0],(400,404),body)
        self.assertEqual(self.admin.call('/api/automation/macros',{'name':'ว่าง'})[0],400)

    # SLA escalation
    def test_unclaimed_case_moves_to_team_lead_once(self):
        lead,lead_id = self.create_member(role='admin',email='lead@example.com')
        self.ok(self.admin,'/api/account/status',{'status':'offline'})
        with D.control() as cd, D.tenant(self.org) as db:
            A.escalate_due(cd,db,self.org)   # the demo data already has an unclaimed case
        _,conv = self.visitor()
        tid = self.open_case(conv)
        with D.control() as cd, D.tenant(self.org) as db:
            self.assertEqual(A.escalate_due(cd,db,self.org),0)
            db.execute('UPDATE tickets SET created_at=? WHERE id=?',(after(minutes=-20),tid))
            db.commit()
            self.assertEqual(A.escalate_due(cd,db,self.org),1)
            self.assertEqual(A.escalate_due(cd,db,self.org),0)
        detail = self.ok(self.admin,f'/api/tickets/{tid}')
        self.assertEqual(detail['ticket']['assignee_id'],lead_id)
        self.assertEqual(detail['automation']['escalation']['reason'],'unclaimed')
        self.assertIn(tid,[e['ticket_id'] for e in self.ok(lead,'/api/automation/alerts')['escalations']])
        listed = next(t for t in self.ok(self.admin,'/api/tickets')['tickets'] if t['id']==tid)
        self.assertEqual(listed['escalation_reason'],'unclaimed')
        # Switched off, nothing is escalated.
        self.ok(self.admin,'/api/automation/settings',{'escalation_enabled':False,'escalation_minutes':15,'csat_enabled':True,'csat_message':'ให้คะแนน 1-5'},'PATCH')
        with D.control() as cd, D.tenant(self.org) as db:
            db.execute('UPDATE tickets SET created_at=?,assignee_id=NULL WHERE status!=?',(after(hours=-5),'closed'))
            db.execute('DELETE FROM escalations')
            db.commit()
            self.assertEqual(A.escalate_due(cd,db,self.org),0)

    # Macros and follow-ups
    def test_macro_replies_sets_status_and_reminder_in_one_click(self):
        visitor,conv = self.visitor()
        tid = self.open_case(conv)
        macro = self.ok(self.admin,'/api/automation/macros',{'name':'ขอข้อมูลเพิ่มเติม','reply':'รบกวนคุณ{customer} ส่งภาพหน้าจอสำหรับ {case} ค่ะ',
                                                            'set_status':'pending_customer','followup_hours':24})['id']
        self.assertIn(macro,[m['id'] for m in self.ok(self.admin,'/api/workspace')['macros']])
        self.assertEqual(self.ok(self.admin,f'/api/macros/{macro}/run',{'ticket_id':tid})['done'],['reply','status','followup'])
        detail = self.ok(self.admin,f'/api/tickets/{tid}')
        self.assertEqual(detail['ticket']['status'],'pending_customer')
        self.assertIsNotNone(detail['ticket']['first_response_at'])
        self.assertEqual(len(detail['automation']['followups']),1)
        number = detail['ticket']['number']
        self.assertEqual(self.ok(visitor,'/api/public/alpha/session')['messages'][-1]['body'],f'รบกวนคุณลูกค้าทดสอบ ส่งภาพหน้าจอสำหรับ BD-{number} ค่ะ')
        followup = detail['automation']['followups'][0]['id']
        self.assertEqual(self.ok(self.admin,'/api/automation/alerts')['followups'][0]['id'],followup)
        self.ok(self.admin,f'/api/followups/{followup}/done',{})
        self.assertEqual(self.ok(self.admin,'/api/automation/alerts')['followups'],[])
        # From the inbox the same macro finds the case; a manual case cannot be replied to, so that step is skipped.
        self.assertEqual(self.ok(self.admin,f'/api/macros/{macro}/run',{'conversation_id':conv})['ticket_id'],tid)
        contact = self.ok(self.admin,'/api/contacts')['contacts'][0]['id']
        manual = self.ok(self.admin,'/api/tickets',{'subject':'บันทึกเอง','contact_id':contact})['id']
        result = self.ok(self.admin,f'/api/macros/{macro}/run',{'ticket_id':manual})
        self.assertEqual((result['done'],result['skipped']),(['status','followup'],['reply']))
        self.assertEqual(self.admin.call(f'/api/macros/{macro}/run',{'ticket_id':tid,'conversation_id':conv})[0],400)

    def test_agent_runs_macros_only_on_own_team_work(self):
        other = self.new_team('ทีมอื่น')
        agent,_ = self.create_member(team=other,email='other@example.com')
        _,conv = self.visitor()
        tid = self.open_case(conv)
        macro = self.ok(self.admin,'/api/automation/macros',{'name':'ปิดงาน','set_status':'resolved'})['id']
        self.assertEqual(agent.call(f'/api/macros/{macro}/run',{'ticket_id':tid})[0],404)
        self.assertEqual(agent.call(f'/api/tickets/{tid}/followups',{'hours':2})[0],404)
        self.ok(self.admin,f'/api/tickets/{tid}/followups',{'hours':2,'note':'โทรหาลูกค้า'})

    # CSAT
    def test_closing_sends_survey_and_rating_does_not_reopen(self):
        visitor,conv = self.visitor()
        tid = self.open_case(conv)
        self.ok(self.admin,f'/api/tickets/{tid}',{'status':'resolved'},'PATCH')
        session = self.ok(visitor,'/api/public/alpha/session')
        self.assertTrue(session['survey']['pending'])
        self.assertTrue(session['messages'][-1]['survey'])
        self.ok(visitor,'/api/public/alpha/messages',{'body':'๕'})
        detail = self.ok(self.admin,f'/api/tickets/{tid}')
        self.assertEqual(detail['ticket']['status'],'resolved')
        self.assertEqual(detail['automation']['survey']['rating'],5)
        # The survey is a system message, never the team's first reply.
        self.assertIsNone(detail['ticket']['first_response_at'])
        self.assertEqual(visitor.call('/api/public/alpha/csat',{'rating':4})[0],409)
        # Writing again reopens as before; closing again asks again, and the stars answer it.
        self.ok(visitor,'/api/public/alpha/messages',{'body':'ยังมีปัญหาอยู่ค่ะ'})
        self.assertEqual(self.ok(self.admin,f'/api/tickets/{tid}')['ticket']['status'],'open')
        self.ok(self.admin,f'/api/tickets/{tid}',{'status':'closed'},'PATCH')
        self.assertEqual(visitor.call('/api/public/alpha/csat',{'rating':9})[0],400)
        self.ok(visitor,'/api/public/alpha/csat',{'rating':3})
        csat = self.ok(self.admin,'/api/automation/overview?tz=-420')['manager']['csat']
        self.assertEqual((csat['count'],csat['average'],csat['distribution']['5']),(2,4.0,1))

    def test_no_survey_when_switched_off_or_case_recorded_by_staff(self):
        self.ok(self.admin,'/api/automation/settings',{'escalation_enabled':True,'escalation_minutes':15,'csat_enabled':False,'csat_message':'ให้คะแนน'},'PATCH')
        visitor,conv = self.visitor()
        tid = self.open_case(conv)
        self.ok(self.admin,f'/api/tickets/{tid}',{'status':'closed'},'PATCH')
        self.assertIsNone(self.ok(visitor,'/api/public/alpha/session')['survey'])
        self.ok(self.admin,'/api/automation/settings',{'escalation_enabled':True,'escalation_minutes':15,'csat_enabled':True,'csat_message':'ให้คะแนน'},'PATCH')
        contact = self.ok(self.admin,'/api/contacts')['contacts'][0]['id']
        manual = self.ok(self.admin,'/api/tickets',{'subject':'บันทึกเอง','contact_id':contact})['id']
        self.ok(self.admin,f'/api/tickets/{manual}',{'status':'closed'},'PATCH')
        self.assertIsNone(self.ok(self.admin,f'/api/tickets/{manual}')['automation']['survey'])

    # Mentions and the manager's view
    def test_note_mentions_notify_only_members_who_can_see_it(self):
        other = self.new_team('ทีมอื่น')
        agent,_ = self.create_member(email='agent@example.com')
        outsider,_ = self.create_member(team=other,email='outsider@example.com')
        _,conv = self.visitor()
        self.ok(self.admin,f'/api/conversations/{conv}/messages',{'kind':'reply','body':'@เจ้าหน้าที่ทดสอบ ไม่ใช่บันทึก'})
        self.ok(self.admin,f'/api/conversations/{conv}/messages',{'kind':'note','body':'@เจ้าหน้าที่ทดสอบ ช่วยดูเรื่องนี้หน่อย'})
        mentions = self.ok(agent,'/api/automation/alerts')['mentions']
        self.assertEqual([(m['conversation_id'],m['author_name']) for m in mentions],[(conv,'ผู้ดูแลองค์กร A')])
        self.assertEqual(self.ok(outsider,'/api/automation/alerts')['mentions'],[])
        self.ok(agent,'/api/mentions/read',{'conversation_id':conv})
        self.assertEqual(self.ok(agent,'/api/automation/alerts')['mentions'],[])
        self.ok(agent,f'/api/conversations/{conv}/messages',{'kind':'note','body':'@ทีม ขอความเห็นด้วยค่ะ'})
        self.assertEqual(len(self.ok(self.admin,'/api/automation/alerts')['mentions']),1)

    def test_manager_overview_shows_activity_workload_and_busy_hours(self):
        agent,agent_id = self.create_member()
        self.ok(agent,'/api/workspace')
        _,conv = self.visitor()
        tid = self.open_case(conv)
        self.ok(self.admin,f'/api/tickets/{tid}',{'assignee_id':agent_id},'PATCH')
        self.ok(agent,f'/api/conversations/{conv}/messages',{'kind':'reply','body':'รับเรื่องแล้วค่ะ'})
        manager = self.ok(self.admin,'/api/automation/overview?tz=-420')['manager']
        row = next(a for a in manager['agents'] if a['id']==agent_id)
        self.assertIsNotNone(row['last_seen'])
        self.assertEqual((row['open'],row['replies_today']),(1,1))
        self.assertIsNotNone(row['avg_first_response'])
        counts = manager['heatmap']['counts']
        self.assertEqual((len(counts),len(counts[0])),(7,24))
        with D.tenant(self.org) as db:
            total = db.execute('SELECT COUNT(*) FROM conversations').fetchone()[0]
        self.assertEqual(sum(map(sum,counts)),total)
        self.assertEqual(self.ok(self.admin,'/api/automation/overview?tz=abc')['manager']['heatmap']['weeks'],8)


class FacebookTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    create_member = base.IntegrationTests.create_member

    def configure(self, **changes):
        data = {'team_id':self.team,'enabled':True,'page_access_token':'page-token','app_secret':'app-secret',**changes}
        with patch.object(T,'verify_facebook',return_value={'identity':PAGE,'display_name':'Bookdose Page'}):
            return self.ok(self.admin,'/api/channels/facebook',data,'PATCH')

    def webhook(self, route, events, secret=b'app-secret', page=PAGE):
        payload = {'object':'page','entry':[{'id':page,'time':1,'messaging':events}]}
        signature = 'sha256='+hmac.new(secret,json.dumps(payload).encode(),hashlib.sha256).hexdigest()
        return self.admin.call('/api/webhooks/facebook/'+route,payload,headers={'X-Hub-Signature-256':signature,'X-CSRF-Token':''})

    def event(self, mid='m-1', text='ระบบล่มค่ะ', **extra):
        return {'sender':{'id':PSID},'recipient':{'id':PAGE},'timestamp':1,'message':{'mid':mid,'text':text,**extra}}

    def test_verify_receive_route_reply_and_deduplicate(self):
        self.ok(self.admin,'/api/automation/rules',{'name':'ระบบล่มจากเฟซบุ๊ก','channel':'facebook','keywords':'ระบบล่ม','set_priority':'high'})
        cfg = self.configure()
        route,token = cfg['route_id'],cfg['config']['verify_token']
        self.assertEqual((cfg['config']['page_id'],cfg['credentials_configured']),(PAGE,True))
        self.assertNotIn('page-token',json.dumps(cfg))
        self.assertEqual(self.admin.call(f'/api/webhooks/facebook/{route}?hub.mode=subscribe&hub.verify_token={token}&hub.challenge=12345'),(200,b'12345'))
        self.assertEqual(self.admin.call(f'/api/webhooks/facebook/{route}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1')[0],403)
        self.assertEqual(self.webhook(route,[self.event()],secret=b'wrong')[0],403)
        for _ in range(2):
            self.assertEqual(self.webhook(route,[self.event(),self.event('echo',is_echo=True)])[0],200)
        self.assertEqual(self.webhook(route,[self.event('elsewhere')],page='555')[0],200)
        convs = [c for c in self.ok(self.admin,'/api/conversations')['conversations'] if c['channel']=='facebook']
        self.assertEqual(len(convs),1)
        conv = convs[0]['id']
        self.assertEqual(len(self.ok(self.admin,f'/api/conversations/{conv}')['messages']),1)
        self.assertEqual(self.ticket_priority(conv),'high')
        path = f'/api/conversations/{conv}/messages'
        self.assertEqual(self.admin.call(path,{'kind':'reply','body':'ก'*2001})[0],400)
        self.assertEqual(self.admin.call(path,{'kind':'reply','body':'ไฟล์','attachments':[{'name':'a.txt','data':'YQ=='}]})[0],400)
        mid = self.ok(self.admin,path,{'kind':'reply','body':'ได้รับเรื่องแล้วค่ะ'})['id']
        self.assertFalse(C.process_outbox(self.org))   # the LINE / Email round leaves Facebook jobs alone
        with patch.object(T,'send_facebook',return_value='mid.out') as send:
            self.assertTrue(F.process_outbox(self.org))
            self.assertEqual(send.call_args.args,('page-token',PSID,'ได้รับเรื่องแล้วค่ะ'))
            self.assertFalse(F.process_outbox(self.org))
        data = self.ok(self.admin,f'/api/conversations/{conv}')
        self.assertEqual(next(m for m in data['messages'] if m['id']==mid)['delivery'],'accepted')
        self.assertIsNotNone(data['ticket']['first_response_at'])
        # A second message in the same chat joins the conversation.
        self.webhook(route,[self.event('m-2','ขอบคุณค่ะ')])
        self.assertEqual(len([c for c in self.ok(self.admin,'/api/conversations')['conversations'] if c['channel']=='facebook']),1)

    def ticket_priority(self, conversation):
        return self.ok(self.admin,f'/api/conversations/{conversation}')['ticket']['priority']

    def test_failed_send_can_be_retried_and_settings_are_admin_only(self):
        cfg = self.configure()
        self.webhook(cfg['route_id'],[self.event(text='สวัสดี')])
        conv = next(c for c in self.ok(self.admin,'/api/conversations')['conversations'] if c['channel']=='facebook')['id']
        mid = self.ok(self.admin,f'/api/conversations/{conv}/messages',{'kind':'reply','body':'ตอบกลับ'})['id']
        from backend.exceptions.errors import ChannelError
        with patch.object(T,'send_facebook',side_effect=ChannelError('rejected')):
            F.process_outbox(self.org)
        self.assertEqual(next(m for m in self.ok(self.admin,f'/api/conversations/{conv}')['messages'] if m['id']==mid)['delivery'],'failed')
        self.ok(self.admin,f'/api/messages/{mid}/retry',{})
        with patch.object(T,'send_facebook',return_value='ok'):
            F.process_outbox(self.org)
        self.assertEqual(next(m for m in self.ok(self.admin,f'/api/conversations/{conv}')['messages'] if m['id']==mid)['delivery'],'accepted')
        agent,_ = self.create_member()
        self.assertEqual(agent.call('/api/channels/facebook')[0],403)
        # Turning the channel off stops replies before they are queued.
        self.ok(self.admin,'/api/channels/facebook',{'enabled':False},'PATCH')
        self.assertEqual(self.admin.call(f'/api/conversations/{conv}/messages',{'kind':'reply','body':'อีกครั้ง'})[0],503)


if __name__=='__main__':
    unittest.main()
