"""ผู้ช่วย AI that does the work (ai/assistant_context.py, ai/assistant_actions.py): what it is shown of the workspace,
which of the actions it proposes are offered, and what happens when the member presses ทำเลย. Each test uses a
disposable database; the provider is mocked."""
import datetime as dt
import json
import unittest
from unittest.mock import patch

import test_ai
import test_app as base
from test_app import D
from backend.extensions import openai_client as OpenAI
from backend.modules.ai import repository as AIR, service as AI
from backend.modules.automation import distribution
from backend.utils.dates import after


def act(kind, case='', **fields):
    """One action as the provider writes it: every field there, unused ones empty."""
    return {'type':kind,'case':case,'status':'','priority':'','team':'','assignee':'','add_tags':[],'remove_tags':[],
            'until':'','text':'','enabled':'','cap':0,'macro':'','customers':[],'values':[],**fields}


def ref(items, name):
    return next(i['ref'] for i in items if i['name']==name)


class AssistantActionTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    create_member = base.IntegrationTests.create_member
    visitor = base.IntegrationTests.visitor
    customer = base.IntegrationTests.customer
    customer_mail = base.IntegrationTests.customer_mail
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    mail_link = base.IntegrationTests.mail_link
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD
    enable = test_ai.AITests.enable

    def ask(self, client, question, answer, page=None):
        """(job id, what the provider was sent, the job as the member reads it)."""
        job = self.ok(client,'/api/ai/assistant',{'question':question,**({'page':page} if page else {})})['id']
        seen = []

        def provider(key, cfg, payload, mode):
            seen.append(payload)
            return answer(payload),{'input_tokens':1,'output_tokens':1}
        with patch.object(OpenAI,'call_provider',side_effect=provider):
            AI.process_one(self.org)
        return job,seen[0],self.ok(client,'/api/ai/jobs/'+job)

    def new_case(self, subject='สินค้ามาไม่ครบ', team=None):
        contact = self.ok(self.admin,'/api/contacts')['contacts'][0]['id']
        tid = self.ok(self.admin,'/api/tickets',{'subject':subject,'contact_id':contact,**({'team_id':team} if team else {})})['id']
        return self.ok(self.admin,f'/api/tickets/{tid}')['ticket']

    def test_it_sees_the_workspace_by_refs_and_never_a_customers_details(self):
        self.enable(chatbot_enabled=False)
        self.ok(self.admin,'/api/settings/tags',{'tags':[{'name':'ส่งช้า'}]})
        _,conv = self.visitor(subject='ติดตามพัสดุ',body='ของยังไม่มาเลย ติดต่อ buyer@example.com หรือ 0812345678')
        self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})
        ticket = self.ok(self.admin,f'/api/conversations/{conv}')['ticket']
        number = f"BD-{ticket['number']}"
        _,payload,job = self.ask(self.admin,'สรุปเคสนี้ให้หน่อย',
                                 lambda p:{'answer':f'{number} ลูกค้ารอของอยู่ ส่วน BD-99999 ไม่มี','citations':[],'actions':[]},
                                 page={'conversation_id':conv})
        text = json.dumps(payload,ensure_ascii=False)
        self.assertNotIn('_refs',payload)
        for secret in ('buyer@example.com','0812345678','ลูกค้าทดสอบ',ticket['id']):
            self.assertNotIn(secret,text)
        self.assertEqual(payload['me']['role'],'owner')
        self.assertEqual(payload['current']['case'],number)
        self.assertTrue(payload['current']['can_reply'])
        self.assertIn('[อีเมล]',payload['current']['messages'][0]['text'])
        self.assertIn(number,[c['case'] for c in payload['cases']])
        self.assertEqual([t['name'] for t in payload['tags']],['ส่งช้า'])
        self.assertTrue(payload['tags'][0]['ref'].startswith('g'))
        self.assertIn('auto_assign',payload['health'])
        # The answer links the cases the member may open, and only those.
        self.assertEqual(job['result']['cases'],{number:ticket['id']})
        self.assertEqual(job['result']['actions'],[])

    def test_only_what_it_was_shown_is_offered_and_a_proposal_runs_once(self):
        self.enable(chatbot_enabled=False)
        tag = self.ok(self.admin,'/api/settings/tags',{'tags':[{'name':'ส่งช้า'}]})['tags'][0]['id']
        _,agent_id = self.create_member()
        case = self.new_case()
        number = f"BD-{case['number']}"
        tomorrow = (dt.datetime.now(dt.timezone(dt.timedelta(hours=7)))+dt.timedelta(days=1)).replace(microsecond=0).isoformat()

        def answer(p):
            member,label = ref(p['members'],'เจ้าหน้าที่ทดสอบ'),ref(p['tags'],'ส่งช้า')
            return {'answer':'เสนอให้ทำตามนี้ กด ทำเลย ได้เลย','citations':[],'actions':[
                act('update_case',number,status='pending_customer',priority='high',assignee=member),
                act('tag_case',number,add_tags=[label,'g99']),
                act('note',number,text='ตรวจพัสดุแล้ว'),
                act('update_case','BD-99999',status='closed'),        # not shown to it
                act('update_case',number,status='closed'),            # a second change of the same case
                act('snooze_case',number,until='2000-01-01T09:00:00+07:00'),   # in the past
                act('snooze_case',number,until=tomorrow,text='รอขนส่งตอบ'),
                act('auto_assign',enabled='on',cap=3)]}
        job,_,found = self.ask(self.admin,f'{number} รอลูกค้า ด่วน มอบให้เจ้าหน้าที่ทดสอบ ติดป้ายส่งช้า',answer)
        actions = found['result']['actions']
        self.assertEqual([a['type'] for a in actions],['update_case','tag_case','note','snooze_case','auto_assign'])
        self.assertEqual(found['result']['dropped'],3)
        self.assertEqual(actions[0]['changes'],{'status':'pending_customer','priority':'high','assignee_id':agent_id})
        self.assertEqual(actions[1]['add_tags'],[tag])

        # Another member cannot run it; the member picks four and rewrites the note.
        other,_ = self.create_member(email='other@example.com')
        self.assertEqual(other.call(f'/api/ai/assistant/{job}/run',{'picked':[0]})[0],404)
        self.assertEqual(self.admin.call(f'/api/ai/assistant/{job}/run',{'picked':[]})[0],400)
        self.assertEqual(self.admin.call(f'/api/ai/assistant/{job}/run',{'picked':[9]})[0],400)
        results = self.ok(self.admin,f'/api/ai/assistant/{job}/run',{'picked':[0,1,2,3],'texts':{'2':'ตรวจพัสดุแล้ว รอขนส่งตอบ'}})['results']
        self.assertEqual([r['ok'] for r in results],[True,True,True,True],results)
        detail = self.ok(self.admin,f"/api/tickets/{case['id']}")
        self.assertEqual((detail['ticket']['status'],detail['ticket']['priority'],detail['ticket']['assignee_id']),('pending_customer','high',agent_id))
        self.assertEqual(detail['ticket']['tags'],[tag])
        self.assertTrue(detail['ticket']['snoozed_until'])
        notes = [m for c in detail['conversations'] for m in c['messages'] if m['kind']=='note']
        self.assertEqual(notes[-1]['body'],'ตรวจพัสดุแล้ว รอขนส่งตอบ')
        with D.tenant(self.org) as db:
            self.assertFalse(distribution.config(db)['enabled'])
        # Run once: a second press is refused, and the answer remembers what was done.
        self.assertEqual(self.admin.call(f'/api/ai/assistant/{job}/run',{'picked':[3]})[0],409)
        self.assertEqual(len(self.ok(self.admin,'/api/ai/jobs/'+job)['result']['ran']['results']),4)

    def test_an_agent_stays_in_their_team_and_each_action_is_checked_again(self):
        self.enable(chatbot_enabled=False)
        other_team = self.ok(self.admin,'/api/teams',{'name':'ทีมเทคนิค'})['id']
        hidden = self.new_case('เรื่องของทีมอื่น',team=other_team)
        mine = self.new_case('เรื่องของทีมฉัน')
        agent,_ = self.create_member()

        def answer(p):
            return {'answer':'ได้เลย','citations':[],'actions':[
                act('update_case',f"BD-{hidden['number']}",status='closed'),
                act('update_case',f"BD-{mine['number']}",status='resolved'),
                act('reply',f"BD-{mine['number']}",text='เรียนลูกค้า ทีมงานแก้ไขให้แล้ว'),
                act('auto_assign',enabled='on',cap=3)]}
        job,payload,found = self.ask(agent,'ปิดทุกเคสให้หน่อย',answer)
        self.assertEqual(payload['me']['role'],'agent')
        self.assertNotIn(f"BD-{hidden['number']}",[c['case'] for c in payload['cases']])
        self.assertEqual([t['name'] for t in payload['teams']],[next(t['name'] for t in self.work['teams'] if t['id']==self.team)])
        self.assertNotIn('auto_assign_ready',json.dumps(payload['members']))
        self.assertEqual([a['type'] for a in found['result']['actions']],['update_case','reply'])
        # Between the answer and the press, the case moved to the other team: it is out of the agent's hands now.
        self.ok(self.admin,f"/api/tickets/{mine['id']}",{'team_id':other_team},'PATCH')
        results = self.ok(agent,f'/api/ai/assistant/{job}/run',{'picked':[0,1]})['results']
        self.assertEqual([r['ok'] for r in results],[False,False])
        self.assertTrue(all(r['error'] for r in results))
        self.assertNotEqual(self.ok(self.admin,f"/api/tickets/{mine['id']}")['ticket']['status'],'resolved')

    def test_the_member_sees_what_the_assistant_is_doing_while_they_wait(self):
        self.enable(chatbot_enabled=False)
        self.new_case()
        first = self.ok(self.admin,'/api/ai/assistant',{'question':'สรุปงานวันนี้'})
        self.assertGreaterEqual(first['gathered']['cases'],1)
        self.assertEqual((first['gathered']['current'],first['gathered']['history']),('',0))
        # Another member asks after: the first question is ahead of theirs.
        agent,_ = self.create_member()
        second = self.ok(agent,'/api/ai/assistant',{'question':'เคสไหนด่วน'})['id']
        waiting = self.ok(agent,'/api/ai/jobs/'+second)
        self.assertEqual(waiting['status'],'pending')
        self.assertEqual({k:waiting['progress'][k] for k in ('ahead','running_seconds','provider','limit_seconds')},
                         {'ahead':1,'running_seconds':None,'provider':'openai','limit_seconds':60})
        # The worker took the first one five seconds ago.
        with D.tenant(self.org) as db:
            db.execute("UPDATE ai_jobs SET status='running',updated_at=? WHERE id=?",(after(seconds=-5),first['id']))
            db.commit()
        running = self.ok(self.admin,'/api/ai/jobs/'+first['id'])['progress']
        self.assertEqual(running['ahead'],0)
        self.assertGreaterEqual(running['running_seconds'],5)
        self.assertEqual(self.ok(agent,'/api/ai/jobs/'+second)['progress']['ahead'],1)
        # Done: nothing to wait for.
        with patch.object(OpenAI,'call_provider',side_effect=lambda *a:({'answer':'ได้เลย','citations':[],'actions':[]},{'input_tokens':1,'output_tokens':1})):
            with D.tenant(self.org) as db:
                db.execute("UPDATE ai_jobs SET status='done' WHERE id=?",(first['id'],))
                db.commit()
            AI.process_one(self.org)
        done = self.ok(agent,'/api/ai/jobs/'+second)
        self.assertEqual(done['status'],'done')
        self.assertNotIn('progress',done)

    def test_the_member_can_stop_waiting_and_the_next_job_waits_for_the_call_that_is_out(self):
        self.enable(chatbot_enabled=False)
        # Not started yet: stopped, it never reaches the AI.
        first = self.ok(self.admin,'/api/ai/assistant',{'question':'สรุปงานวันนี้'})['id']
        other,_ = self.create_member()
        self.assertEqual(other.call(f'/api/ai/assistant/{first}',method='DELETE')[0],404)
        self.assertEqual(self.ok(self.admin,f'/api/ai/assistant/{first}',method='DELETE'),{'status':'cancelled','started':False})
        with patch.object(OpenAI,'call_provider') as provider:
            AI.process_one(self.org)
        provider.assert_not_called()
        stopped = self.ok(self.admin,'/api/ai/jobs/'+first)
        self.assertEqual((stopped['status'],stopped['error']),('cancelled','หยุดรอแล้ว'))
        self.assertEqual(self.admin.call(f'/api/ai/assistant/{first}',method='DELETE')[0],409)

        # Stopped while the AI is answering: the answer is thrown away, and another job does not start before that
        # call has come back.
        second = self.ok(self.admin,'/api/ai/assistant',{'question':'เคสไหนด่วน'})['id']
        seen = {}

        def provider(key, cfg, payload, mode):
            seen['stop'] = self.ok(self.admin,f'/api/ai/assistant/{second}',method='DELETE')
            self.ok(other,'/api/ai/assistant',{'question':'ถามต่อ'})
            with D.tenant(self.org) as db:
                seen['held'] = AIR.any_running(db,after(minutes=-10))
            return {'answer':'คำตอบที่ไม่มีใครรอแล้ว','citations':[],'actions':[]},{'input_tokens':1,'output_tokens':1}
        with patch.object(OpenAI,'call_provider',side_effect=provider):
            AI.process_one(self.org)
        self.assertEqual((seen['stop']['started'],seen['held']),(True,True))
        job = self.ok(self.admin,'/api/ai/jobs/'+second)
        self.assertEqual((job['status'],job['result']),('cancelled',{}))
        with D.tenant(self.org) as db:
            self.assertFalse(AIR.any_running(db,after(minutes=-10)))
        # The call is back: the other member's question goes next.
        with patch.object(OpenAI,'call_provider',side_effect=lambda *a:({'answer':'ได้เลย','citations':[],'actions':[]},{'input_tokens':1,'output_tokens':1})) as provider:
            AI.process_one(self.org)
        provider.assert_called_once()

    def test_a_problem_is_found_in_the_health_and_the_owner_fixes_it(self):
        self.enable(chatbot_enabled=False)
        self.new_case('ยังไม่มีคนรับ')
        # A chat on screen that is not a case yet: it can be answered, not paused.
        _,conv = self.visitor(subject='สอบถาม',body='ขอสอบถามการใช้งาน')
        until = (dt.datetime.now(dt.timezone(dt.timedelta(hours=7)))+dt.timedelta(days=1)).replace(microsecond=0).isoformat()

        def answer(p):
            self.assertFalse(p['health']['auto_assign']['on'])
            self.assertGreaterEqual(p['health']['unassigned_open_cases'],1)
            self.assertEqual((p['current']['case'],p['current']['subject']),('','สอบถาม'))
            return {'answer':'การแจกเคสอัตโนมัติปิดอยู่ เสนอให้เปิด','citations':[],'actions':[
                act('auto_assign',enabled='on',cap=4),
                act('reply','current',text='สวัสดีค่ะ'),
                act('snooze_case','current',until=until,text='รอลูกค้าส่งเอกสาร')]}
        job,_,found = self.ask(self.admin,'ทำไมเคสใหม่ไม่ถูกแจกให้ใคร',answer,page={'conversation_id':conv})
        self.assertEqual([a['type'] for a in found['result']['actions']],['auto_assign','reply'])
        results = self.ok(self.admin,f'/api/ai/assistant/{job}/run',{'picked':[0,1],'texts':{'1':'สวัสดีค่ะ ทีมงานรับเรื่องแล้ว'}})['results']
        self.assertEqual([r['ok'] for r in results],[True,True],results)
        with D.tenant(self.org) as db:
            cfg = distribution.config(db)
        self.assertEqual((cfg['enabled'],cfg['cap']),(True,4))
        replies = [m for m in self.ok(self.admin,f'/api/conversations/{conv}')['messages'] if m['kind']=='reply']
        self.assertTrue(replies[-1]['body'].startswith('สวัสดีค่ะ ทีมงานรับเรื่องแล้ว'))
        events = [e['action'] for e in self.ok(self.admin,'/api/audit')['events']]
        self.assertIn('ai.actions_run',events)

    def test_a_macro_of_the_organization_is_proposed_and_runs_as_its_button_does(self):
        self.enable(chatbot_enabled=False)
        self.ok(self.admin,'/api/automation/macros',{'name':'ขอเอกสารเพิ่ม','reply':'รบกวนส่งเอกสารเพิ่ม โทร 0812345678',
                                                    'set_status':'pending_customer','followup_hours':24})
        _,conv = self.visitor(subject='ขอคืนสินค้า',body='ขอคืนสินค้าค่ะ')
        self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})
        ticket = self.ok(self.admin,f'/api/conversations/{conv}')['ticket']
        number = f"BD-{ticket['number']}"

        def answer(p):
            macro = ref(p['macros'],'ขอเอกสารเพิ่ม')
            self.assertEqual((p['macros'][0]['sets_status'],p['macros'][0]['follow_up_hours']),('pending_customer',24))
            self.assertNotIn('0812345678',p['macros'][0]['reply'])
            return {'answer':'ใช้มาโครขอเอกสารเพิ่มได้','citations':[],'actions':[
                act('macro',number,macro=macro),
                act('reply',number,text='ส่งเอกสารด้วยค่ะ'),          # the macro already sends its reply
                act('macro','BD-99999',macro=macro),                   # not shown
                act('macro',number,macro='m99')]}                      # no such macro
        job,_,found = self.ask(self.admin,f'{number} ขอเอกสารลูกค้าเพิ่ม',answer)
        actions = found['result']['actions']
        self.assertEqual([a['type'] for a in actions],['macro'])
        self.assertEqual(actions[0]['macro'],{'name':'ขอเอกสารเพิ่ม','reply':True,'set_status':'pending_customer','followup_hours':24})
        self.assertEqual(found['result']['dropped'],3)
        results = self.ok(self.admin,f'/api/ai/assistant/{job}/run',{'picked':[0]})['results']
        self.assertEqual(results,[{'index':0,'ok':True,'error':''}])
        detail = self.ok(self.admin,f"/api/tickets/{ticket['id']}")
        self.assertEqual(detail['ticket']['status'],'pending_customer')
        replies = [m for c in detail['conversations'] for m in c['messages'] if m['kind']=='reply']
        self.assertTrue(replies[-1]['body'].startswith('รบกวนส่งเอกสารเพิ่ม'))
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM followups WHERE ticket_id=?',(ticket['id'],)).fetchone()[0],1)

        # On a chat that is not a case: the reply goes, the status and reminder cannot, and the member is told.
        _,chat = self.visitor(email='second@example.com',subject='สอบถาม',body='สอบถามหน่อย')
        job,_,found = self.ask(self.admin,'ใช้มาโครขอเอกสารกับแชทนี้',
                               lambda p:{'answer':'ได้เลย','citations':[],'actions':[act('macro','current',macro=ref(p['macros'],'ขอเอกสารเพิ่ม'))]},
                               page={'conversation_id':chat})
        self.assertEqual(len(found['result']['actions']),1)
        result = self.ok(self.admin,f'/api/ai/assistant/{job}/run',{'picked':[0]})['results'][0]
        self.assertTrue(result['ok'])
        self.assertEqual(result['note'],'ข้ามเปลี่ยนสถานะและตั้งเตือน (แชทนี้ยังไม่เป็นเคส)')

    def test_an_owner_is_shown_records_that_look_like_one_person_and_merges_them_once_confirmed(self):
        self.enable(chatbot_enabled=False)
        contact = lambda **body:self.ok(self.admin,'/api/contacts',body)['id']
        kept = contact(name='สมหญิง ใจดี',email='somying@example.com',phone='081-234-5678')
        by_email = contact(name='Somying J',email='SOMYING@example.com')
        by_phone = contact(name='คุณหญิง',phone='+66812345678')
        name_only = [contact(name='สมชาย ขายดี'),contact(name='สมชาย  ขายดี')]
        contact(name='ไม่ซ้ำใคร',email='alone@example.com')
        self.ok(self.admin,'/api/tickets',{'subject':'ของมาไม่ครบ','contact_id':kept})

        # A question about something else: the groups are only counted.
        _,payload,_ = self.ask(self.admin,'เคสไหนด่วน',lambda p:{'answer':'ไม่มี','citations':[],'actions':[]})
        self.assertEqual(payload['duplicate_customers'],{'groups':2,'listed':[]})

        def answer(p):
            first,second = p['duplicate_customers']['listed']
            refs = [c['ref'] for c in first['customers']]
            return {'answer':'พบลูกค้าซ้ำ 2 กลุ่ม','citations':[],'actions':[
                act('merge_customers',customers=refs),
                act('merge_customers',customers=[refs[1],second['customers'][0]['ref']]),   # a record already in a merge
                act('merge_customers',customers=[second['customers'][0]['ref'],'c99'])]}    # not shown: one left
        job,payload,found = self.ask(self.admin,'มีลูกค้าซ้ำไหม รวมให้หน่อย',answer)
        text = json.dumps(payload,ensure_ascii=False)
        for secret in ('สมหญิง','somying','0812345678','812345678','สมชาย',kept):
            self.assertNotIn(secret,text.lower())
        first,second = payload['duplicate_customers']['listed']
        self.assertEqual((first['matched_by'],second['matched_by']),(['email','phone'],['name']))
        self.assertEqual((first['customers'][0]['cases'],len(first['customers']),len(second['customers'])),(1,3,2))
        actions = found['result']['actions']
        self.assertEqual(([a['type'] for a in actions],found['result']['dropped']),(['merge_customers'],2))
        self.assertEqual((actions[0]['keep'],set(actions[0]['merge'])),(kept,{by_email,by_phone}))
        self.assertEqual((actions[0]['customers'][0]['name'],actions[0]['matched_by']),('สมหญิง ใจดี',['email','phone']))

        # An agent is not shown them and cannot merge.
        agent,_ = self.create_member()
        _,payload,found = self.ask(agent,'มีลูกค้าซ้ำไหม',lambda p:{'answer':'ไม่ทราบ','citations':[],'actions':[act('merge_customers',customers=['c1','c2'])]})
        self.assertNotIn('duplicate_customers',payload)
        self.assertEqual(found['result']['actions'],[])

        self.assertEqual(self.ok(self.admin,f'/api/ai/assistant/{job}/run',{'picked':[0]})['results'],[{'index':0,'ok':True,'error':''}])
        left = {c['id'] for c in self.ok(self.admin,'/api/contacts')['contacts']}
        self.assertIn(kept,left)
        self.assertFalse({by_email,by_phone}&left)
        self.assertTrue(set(name_only)<=left)

    def test_members_rate_answers_and_the_owner_reads_how_the_assistant_does(self):
        self.enable(chatbot_enabled=False)
        agent,_ = self.create_member()
        mine,_,_ = self.ask(self.admin,'สรุปงาน',lambda p:{'answer':'ได้เลย','citations':[],'actions':[]})
        theirs,_,_ = self.ask(agent,'เคสไหนด่วน',lambda p:{'answer':'ไม่มี','citations':[],'actions':[]})
        rate = lambda client,job,**body:client.call(f'/api/ai/assistant/{job}/feedback',body)
        self.assertEqual(rate(agent,mine,rating='up')[0],404)
        self.assertEqual(rate(self.admin,mine,rating='up',reason='wrong')[0],400)
        self.assertEqual(rate(self.admin,mine,rating='so-so')[0],400)
        self.assertEqual(rate(self.admin,mine,rating='down',comment='ก'*301)[0],400)
        self.assertEqual(self.ok(self.admin,f'/api/ai/assistant/{mine}/feedback',{'rating':'up'}),{'rating':'up','reason':''})
        # A change of mind replaces it; taking it back removes it.
        self.ok(self.admin,f'/api/ai/assistant/{mine}/feedback',{'rating':'down','reason':'wrong','comment':'ตอบผิด ลูกค้าเบอร์ 0812345678'})
        self.ok(agent,f'/api/ai/assistant/{theirs}/feedback',{'rating':'down','reason':'off_topic'})
        self.ok(agent,f'/api/ai/assistant/{theirs}/feedback',{'rating':''})
        self.ok(agent,f'/api/ai/assistant/{theirs}/feedback',{'rating':'up'})
        day = dt.date.today()
        path = f'/api/reports/extras?from={day-dt.timedelta(days=1)}&to={day+dt.timedelta(days=1)}&tz=0'
        report = self.ok(self.admin,path)['assistant']
        self.assertEqual({k:report[k] for k in ('asked','answered','failed','proposed','ran','people','up','down')},
                         {'asked':2,'answered':2,'failed':0,'proposed':0,'ran':0,'people':2,'up':1,'down':1})
        self.assertEqual(report['reasons'],[{'reason':'wrong','count':1}])
        self.assertEqual([c['comment'] for c in report['comments']],['ตอบผิด ลูกค้าเบอร์ [เบอร์โทร]'])
        self.assertNotIn('user_id',json.dumps(report))
        self.assertIsNone(self.ok(agent,path)['assistant'])


if __name__=='__main__':
    unittest.main()
