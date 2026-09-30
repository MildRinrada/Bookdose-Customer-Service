"""Routing rules, SLA escalation, macros, CSAT, @mentions, the manager dashboard and Facebook Messenger.
Each test uses a disposable database; Facebook is mocked, no message leaves the machine."""
import datetime as dt
import hashlib
import hmac
import json
import unittest
from unittest.mock import patch

import test_app as base
from test_app import D
from backend.exceptions.errors import CHANNEL_ERRORS
from backend.extensions import channel_transport as T
from backend.modules.automation import service as A
from backend.modules.channels import facebook as F, service as C
from backend.utils.dates import after, utc_now

PAGE = '1234567890'
APP = '5550001112'              # the Meta app the Page token was made for
PSID = '9876543210'
IG = '17841400000000001'        # the Instagram professional account connected to the Page
IGSID = '9876543210'            # an Instagram user; the same digits as the Messenger user on purpose


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
        # A macro that only sends a text is a canned reply; that belongs in คำตอบสำเร็จรูปของทีม, which the
        # team reads over before sending. A macro must also move the case on.
        self.assertEqual(self.admin.call('/api/automation/macros',{'name':'ทักทาย','reply':'สวัสดีค่ะ'})[0],400)
        self.ok(self.admin,'/api/automation/macros',{'name':'ทักทายแล้วรอ','reply':'สวัสดีค่ะ','set_status':'pending_customer'})

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
        me = self.admin.boot()['user']['id']
        self.ok(self.admin,f'/api/tickets/{tid}',{'status':'resolved','assignee_id':me},'PATCH')
        self.assertEqual(self.ok(self.admin,'/api/automation/alerts')['praise'],[])
        session = self.ok(visitor,'/api/public/alpha/session')
        self.assertTrue(session['survey']['pending'])
        self.assertTrue(session['messages'][-1]['survey'])
        self.ok(visitor,'/api/public/alpha/messages',{'body':'๕'})
        detail = self.ok(self.admin,f'/api/tickets/{tid}')
        self.assertEqual(detail['ticket']['status'],'resolved')
        self.assertEqual(detail['automation']['survey']['rating'],5)
        # Five stars on the member's own case reach their alerts (the staff frame celebrates them); nobody else's.
        self.assertEqual([p['ticket_id'] for p in self.ok(self.admin,'/api/automation/alerts')['praise']],[tid])
        agent,_ = self.create_member()
        self.assertEqual(self.ok(agent,'/api/automation/alerts')['praise'],[])
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
        # The customer list shows how satisfied this customer has been and where they write.
        contact = self.ok(self.admin,f'/api/tickets/{tid}')['contact']['id']
        row = next(c for c in self.ok(self.admin,'/api/contacts')['contacts'] if c['id']==contact)
        self.assertEqual((row['satisfaction']['average'],row['satisfaction']['count'],row['main_channel']),(4.0,2,'web'))
        # The case list (the service report) carries the case's channel and its latest answer.
        case = next(t for t in self.ok(self.admin,'/api/tickets')['tickets'] if t['id']==tid)
        self.assertEqual((case['channel'],case['csat_rating']),('web',3));self.assertTrue(case['csat_at'])

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
        # งานค้าง: a case waiting for the customer, or paused, is not work to do now.
        def backlog():
            manager = self.ok(self.admin,'/api/automation/overview?tz=-420')['manager']
            return next(a for a in manager['agents'] if a['id']==agent_id)['open']
        self.ok(self.admin,f'/api/tickets/{tid}',{'status':'pending_customer'},'PATCH')
        self.assertEqual(backlog(),0)
        self.ok(self.admin,f'/api/tickets/{tid}',{'status':'open'},'PATCH')
        with D.tenant(self.org) as db:
            db.execute('UPDATE tickets SET snoozed_until=? WHERE id=?',((utc_now()+dt.timedelta(hours=3)).isoformat(timespec='seconds'),tid))
            db.commit()
        self.assertEqual(backlog(),0)
        with D.tenant(self.org) as db:
            db.execute('UPDATE tickets SET snoozed_until=NULL WHERE id=?',(tid,))
            db.commit()
        self.assertEqual(backlog(),1)
        # The busy hours moved to the service report: every conversation of the period, by weekday and hour.
        self.assertNotIn('heatmap',manager)
        first,last = (utc_now()-dt.timedelta(days=365)).date().isoformat(),utc_now().date().isoformat()
        hours = self.ok(self.admin,f'/api/reports/extras?from={first}&to={last}&tz=0')['hours']
        self.assertEqual((len(hours['counts']),len(hours['counts'][0])),(7,24))
        with D.tenant(self.org) as db:
            total = db.execute('SELECT COUNT(*) FROM conversations WHERE created_at>=?',(first,)).fetchone()[0]
        self.assertEqual((sum(map(sum,hours['counts'])),hours['total']),(total,total))


class FacebookTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    create_member = base.IntegrationTests.create_member

    def configure(self, page=PAGE, **changes):
        data = {'team_id':self.team,'enabled':True,'page_access_token':'page-token','app_secret':'app-secret',**changes}
        with patch.object(T,'verify_facebook',return_value={'identity':page,'display_name':'Bookdose Page','app_id':APP}):
            with patch.object(T,'subscribe_facebook',return_value=True):
                return self.ok(self.admin,'/api/channels/facebook',data,'PATCH')

    def test_page_changes_until_a_message_came_and_is_subscribed(self):
        # A person's own token, or the secret of another app, is refused with what to do.
        with patch.object(T,'verify_facebook',side_effect=T.ChannelError('not_page')):
            status,body = self.admin.call('/api/channels/facebook',{'team_id':self.team,'enabled':True,'page_access_token':'user-token','app_secret':'app-secret'},'PATCH')
        self.assertEqual((status,body['error']),(400,CHANNEL_ERRORS['not_page']))
        # A first save taken for a Page by mistake can still be corrected: no message came yet.
        self.configure(page='111')
        with patch.object(T,'verify_facebook',return_value={'identity':PAGE,'display_name':'Bookdose Page','app_id':APP}):
            with patch.object(T,'subscribe_facebook',return_value=True) as subscribe:
                cfg = self.ok(self.admin,'/api/channels/facebook',{'enabled':True},'PATCH')
        self.assertEqual(cfg['config']['page_id'],PAGE)
        self.assertEqual(subscribe.call_args.args,('page-token',PAGE,APP))
        # Saved even when the Page would not subscribe; the settings say what to do.
        with patch.object(T,'verify_facebook',return_value={'identity':PAGE,'display_name':'Bookdose Page','app_id':APP}):
            with patch.object(T,'subscribe_facebook',side_effect=T.ChannelError('subscribe')):
                cfg = self.ok(self.admin,'/api/channels/facebook',{'enabled':True},'PATCH')
        self.assertEqual((cfg['enabled'],cfg['last_error']),(True,CHANNEL_ERRORS['subscribe']))
        # Once a message came in, the Page stays.
        self.assertEqual(self.webhook(cfg['route_id'],[self.event()])[0],200)
        with patch.object(T,'verify_facebook',return_value={'identity':'222','display_name':'Other Page','app_id':APP}):
            self.assertEqual(self.admin.call('/api/channels/facebook',{'enabled':True},'PATCH')[0],400)

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
            self.assertEqual(send.call_args.args,('page-token',PSID,'ได้รับเรื่องแล้วค่ะ',None))
            self.assertFalse(F.process_outbox(self.org))
        data = self.ok(self.admin,f'/api/conversations/{conv}')
        self.assertEqual(next(m for m in data['messages'] if m['id']==mid)['delivery'],'accepted')
        self.assertIsNotNone(data['ticket']['first_response_at'])
        # A second message in the same chat joins the conversation.
        self.webhook(route,[self.event('m-2','ขอบคุณค่ะ')])
        self.assertEqual(len([c for c in self.ok(self.admin,'/api/conversations')['conversations'] if c['channel']=='facebook']),1)

    def test_receipt_with_buttons_on_messenger(self):
        self.ok(self.admin,'/api/settings/receipt',{'enabled':True,'message':'ได้รับแล้ว ทีมงานจะตอบกลับ{เวลารอ}'})
        route = self.configure()['route_id']
        self.webhook(route,[self.event()])
        conv = self.channel_convs('facebook')[0]['id']
        system = lambda: [m for m in self.ok(self.admin,f'/api/conversations/{conv}')['messages'] if m['author_name']=='ระบบ']
        self.assertEqual(len(system()),1)
        with patch.object(T,'send_facebook',return_value='mid.out') as send:
            self.assertTrue(F.process_outbox(self.org))
        self.assertEqual([q['payload'] for q in send.call_args.args[3]],['bookdose:queue','bookdose:no_rush'])
        # A press arrives as a message carrying the button's payload: answered, not stored as the customer's.
        self.webhook(route,[self.event('press-1','ดูลำดับคิวตอนนี้',quick_reply={'payload':'bookdose:queue'})])
        detail = self.ok(self.admin,f'/api/conversations/{conv}')['messages']
        self.assertEqual(len([m for m in detail if m['kind']=='customer']),1)
        self.assertRegex(system()[-1]['body'],r'^ตอนนี้คุณอยู่ประมาณลำดับที่ \d+ ')

    def ticket_priority(self, conversation):
        return self.ok(self.admin,f'/api/conversations/{conversation}')['ticket']['priority']

    def instagram(self, route, events, account=IG, secret=b'app-secret'):
        payload = {'object':'instagram','entry':[{'id':account,'time':1,'messaging':events}]}
        signature = 'sha256='+hmac.new(secret,json.dumps(payload).encode(),hashlib.sha256).hexdigest()
        return self.admin.call('/api/webhooks/facebook/'+route,payload,headers={'X-Hub-Signature-256':signature,'X-CSRF-Token':''})

    def dm(self, mid='ig-1', text='สั่งของทาง IG ยังไม่ได้รับค่ะ', **extra):
        return {'sender':{'id':IGSID},'recipient':{'id':IG},'timestamp':1,'message':{'mid':mid,'text':text,**extra}}

    def channel_convs(self, channel):
        return [c for c in self.ok(self.admin,'/api/conversations')['conversations'] if c['channel']==channel]

    def test_instagram_dms_ride_on_the_page(self):
        self.ok(self.admin,'/api/automation/rules',{'name':'ของไม่ถึงจาก IG','channel':'instagram','keywords':'ยังไม่ได้รับ','set_priority':'high'})
        # The Page must have an Instagram professional account connected.
        with patch.object(T,'facebook_instagram',return_value=None):
            with patch.object(T,'verify_facebook',return_value={'identity':PAGE,'display_name':'Bookdose Page','app_id':APP}):
                status,_ = self.admin.call('/api/channels/facebook',{'team_id':self.team,'enabled':True,'page_access_token':'page-token',
                                                                     'app_secret':'app-secret','instagram_enabled':True},'PATCH')
        self.assertEqual(status,400)
        with patch.object(T,'facebook_instagram',return_value={'identity':IG,'display_name':'bookdose.th'}):
            cfg = self.configure(instagram_enabled=True)
        self.assertEqual((cfg['config']['instagram_id'],cfg['config']['instagram_username'],cfg['instagram']['on']),(IG,'bookdose.th',True))
        route = cfg['route_id']
        # A DM, its redelivery, an echo, an unsent message and another account's DM: one message.
        self.assertEqual(self.instagram(route,[self.dm(),self.dm(),self.dm('echo',is_echo=True),self.dm('gone',is_deleted=True)])[0],200)
        self.assertEqual(self.instagram(route,[self.dm('other')],account='17841499999999999')[0],200)
        self.assertEqual(self.instagram(route,[self.dm('forged')],secret=b'wrong')[0],403)
        ig = self.channel_convs('instagram')
        self.assertEqual(len(ig),1)
        conv = ig[0]['id']
        detail = self.ok(self.admin,f'/api/conversations/{conv}')
        self.assertEqual(len(detail['messages']),1)
        self.assertTrue(detail['messages'][0]['author_name'].startswith('Instagram • '))
        self.assertEqual(self.ticket_priority(conv),'high')
        # A Messenger user with the same digits is someone else.
        self.webhook(route,[self.event('fb-1','สวัสดีจากเพจ')])
        self.assertEqual((len(self.channel_convs('facebook')),len(self.channel_convs('instagram'))),(1,1))
        # Replies: Instagram's own length limit, then out through the Page to the Instagram user.
        path = f'/api/conversations/{conv}/messages'
        self.assertEqual(self.admin.call(path,{'kind':'reply','body':'ก'*1001})[0],400)
        mid = self.ok(self.admin,path,{'kind':'reply','body':'กำลังตรวจสอบให้ค่ะ'})['id']
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute('SELECT kind FROM channel_outbox WHERE message_id=?',(mid,)).fetchone()[0],'instagram')
        with patch.object(T,'send_facebook',return_value='ig.out') as send:
            self.assertTrue(F.process_outbox(self.org))
        self.assertEqual(send.call_args.args,('page-token',IGSID,'กำลังตรวจสอบให้ค่ะ',None))
        self.assertEqual(next(m for m in self.ok(self.admin,path.rsplit('/',1)[0])['messages'] if m['id']==mid)['delivery'],'accepted')
        # The customer's help page lists Instagram beside the Page.
        kinds = {c['kind']:c['label'] for c in self.admin.call('/api/public/alpha')[1]['channels']}
        self.assertEqual((kinds.get('facebook'),kinds.get('instagram')),('Bookdose Page','@bookdose.th'))
        # Instagram off: DMs are no longer taken in or answered; Messenger goes on.
        self.configure(instagram_enabled=False)
        self.assertEqual(self.admin.call(path,{'kind':'reply','body':'อีกครั้ง'})[0],503)
        self.instagram(route,[self.dm('ig-2','ข้อความใหม่')])
        self.assertEqual(len(self.ok(self.admin,f'/api/conversations/{conv}')['messages']),2)
        self.webhook(route,[self.event('fb-2','ยังอยู่ไหม')])
        fb = self.channel_convs('facebook')[0]['id']
        self.assertEqual(len([m for m in self.ok(self.admin,f'/api/conversations/{fb}')['messages'] if m['kind']=='customer']),2)
        self.assertNotIn('instagram',{c['kind'] for c in self.admin.call('/api/public/alpha')[1]['channels']})

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
