"""เวลาทำการ and เฝ้าช่องทาง: a customer writing outside the organization's hours hears when the team is back - once per
closed stretch, on the web chat and on LINE - and the conversation still waits for the team; a channel that stops
working is told to the organization's admins (email and bell) after a grace period, and its return is told too."""
import datetime as dt
import json
import unittest
from unittest.mock import patch

import test_guest_chat as guest_tests
from test_app import D
from backend.exceptions.errors import ChannelError
from backend.extensions import channel_transport as T
from backend.modules.automation import quiet
from backend.modules.channels import health, service as C
from backend.modules.organization import hours, retention

GUEST = guest_tests.GUEST
TZ = hours.TZ
WEEK = [['09:00','18:00']]*5+[None,None]


def closed_now():
    """Seven days with one short opening today that is not now."""
    local = dt.datetime.now(TZ)
    window = ['00:00','00:30'] if local.time()>=dt.time(1,0) else ['23:00','23:30']
    return [window if day==local.weekday() else None for day in range(7)]


class HoursAndWatchTests(unittest.TestCase):
    def hours(self, days, enabled=True, message=None, sla=False):
        return self.ok(self.admin,'/api/settings/hours',{'enabled':enabled,'sla':sla,'days':days,
                                                          'message':message or f'นอกเวลาทำการ ทีมงานจะตอบกลับ{hours.TOKEN}'})

    def test_opening_and_closing_times(self):
        cfg = {'enabled':True,'days':WEEK,'message':'x'}
        friday_evening = dt.datetime(2026,9,25,19,0,tzinfo=TZ)
        self.assertFalse(hours.is_open(cfg,friday_evening))
        self.assertTrue(hours.is_open(cfg,dt.datetime(2026,9,25,10,0,tzinfo=TZ)))
        self.assertEqual(hours.next_open(cfg,friday_evening),dt.datetime(2026,9,28,9,0,tzinfo=TZ))
        self.assertEqual(hours.when_text(hours.next_open(cfg,friday_evening),friday_evening),'วันจันทร์ 09:00')
        self.assertEqual(hours.when_text(dt.datetime(2026,9,24,9,0,tzinfo=TZ),dt.datetime(2026,9,23,20,0,tzinfo=TZ)),'พรุ่งนี้ 09:00')
        self.assertEqual(hours.last_close(cfg,friday_evening),dt.datetime(2026,9,25,18,0,tzinfo=TZ))
        self.assertEqual(hours.notice_text({**cfg,'message':f'กลับมา{hours.TOKEN}'},friday_evening),'กลับมา วันจันทร์ 09:00')

    def test_holidays_and_sla_in_opening_time(self):
        cfg = {'enabled':True,'days':WEEK,'message':'x','holidays':[{'date':'2026-09-28','name':'หยุดพิเศษ'}]}
        friday_evening = dt.datetime(2026,9,25,19,0,tzinfo=TZ)
        self.assertFalse(hours.is_open(cfg,dt.datetime(2026,9,28,10,0,tzinfo=TZ)))
        self.assertEqual(hours.next_open(cfg,friday_evening),dt.datetime(2026,9,29,9,0,tzinfo=TZ))
        # Four hours asked on Friday at 16:00: two that day, two on Tuesday (the weekend and the holiday stop the clock).
        self.assertEqual(hours.deadline(cfg,dt.datetime(2026,9,25,16,0,tzinfo=TZ),4),dt.datetime(2026,9,29,11,0,tzinfo=TZ))
        self.assertEqual(hours.deadline(cfg,friday_evening,1),dt.datetime(2026,9,29,10,0,tzinfo=TZ))
        self.assertEqual(hours.deadline({**cfg,'holidays':[]},dt.datetime(2026,9,23,10,0,tzinfo=TZ),9),dt.datetime(2026,9,24,10,0,tzinfo=TZ))
        self.assertEqual(hours.when_text(dt.datetime(2026,10,5,9,0,tzinfo=TZ),friday_evening),'5 ต.ค. 09:00')
        # Days already past are dropped; the rest kept in order, one per date.
        body = {'enabled':False,'sla':True,'days':WEEK,'message':'x',
                'holidays':[{'date':'2026-12-31','name':'สิ้นปี'},{'date':'2026-09-01','name':'ผ่านไปแล้ว'},{'date':'2026-10-13','name':''}]}
        self.assertEqual([h['date'] for h in hours.form(body,dt.date(2026,9,25))['holidays']],['2026-10-13','2026-12-31'])
        for bad in ({'date':'2026-02-30','name':''},{'date':'31/12/2026','name':''},'2026-12-31'):
            self.assertEqual(self.admin.call('/api/settings/hours',{**body,'holidays':[bad]})[0],400)
        self.assertEqual(self.admin.call('/api/settings/hours',{**body,'days':[None]*7})[0],400)

    def test_new_case_deadline_follows_opening_time_when_chosen(self):
        def due():
            conv = self.started(self.browser(),body='ขอเปิดเคสเพื่อทดสอบ SLA')
            case = self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']
            return dt.datetime.fromisoformat(self.ok(self.admin,f'/api/tickets/{case}')['ticket']['first_response_due_at'])
        self.ok(self.admin,'/api/settings',{'response_hours':'2','resolution_hours':'24','welcome':'สวัสดี'},'PATCH')
        start = dt.datetime.now(dt.timezone.utc)
        self.assertLess(abs((due()-start).total_seconds()-7200),120)
        self.assertFalse(self.ok(self.browser(),guest_tests.ORG)['response_in_opening_time'])
        self.hours(closed_now(),enabled=False,sla=True)
        # The customer's pages promise the reply in opening time too.
        self.assertTrue(self.ok(self.browser(),guest_tests.ORG)['response_in_opening_time'])
        # Closed now and open only 30 minutes a week: the two hours run into the coming weeks' openings.
        self.assertGreater((due()-start).total_seconds(),86400)

    def test_sla_by_priority(self):
        form = {'response_hours':'4','resolution_hours':'24','welcome':'สวัสดี'}
        for bad in ({'urgent':{'response':'0'}},{'urgent':{'response':'abc'}},{'high':'1'},['x']):
            self.assertEqual(self.admin.call('/api/settings',{**form,'sla_by_priority':bad},'PATCH')[0],400)
        self.ok(self.admin,'/api/settings',{**form,'sla_by_priority':{'urgent':{'response':'1','resolution':'8'},
                                                                        'high':{'response':'','resolution':''},'low':{'resolution':72}}},'PATCH')
        # A form without them keeps them.
        self.ok(self.admin,'/api/settings',form,'PATCH')
        saved = self.ok(self.admin,'/api/workspace')['settings']['sla_by_priority']
        self.assertEqual(json.loads(saved)['urgent'],{'response':1.0,'resolution':8.0})

        def case(body='ขอสอบถามเรื่องบัญชี'):
            conv = self.started(self.browser(),body=body)
            return conv,self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']

        def hours_of(case_id):
            t = self.ok(self.admin,f'/api/tickets/{case_id}')['ticket']
            start = dt.datetime.fromisoformat(t['created_at'])
            return tuple(round((dt.datetime.fromisoformat(t[k])-start).total_seconds()/3600,2) for k in ('first_response_due_at','resolution_due_at'))

        conv,normal = case()
        self.assertEqual(hours_of(normal),(4,24))
        # Made urgent: measured again from when it opened.
        self.ok(self.admin,f'/api/tickets/{normal}',{'priority':'urgent'},'PATCH')
        self.assertEqual(hours_of(normal),(1,8))
        # Answered, then made low: the first response keeps its deadline; the resolution follows ต่ำ.
        self.reply(conv)
        self.ok(self.admin,f'/api/tickets/{normal}',{'priority':'low'},'PATCH')
        self.assertEqual(hours_of(normal),(1,72))
        # High left empty: as ปกติ. A routing rule that makes a case urgent gives it the urgent targets from the start.
        self.ok(self.admin,'/api/tickets/'+case()[1],{'priority':'high'},'PATCH')
        self.ok(self.admin,'/api/automation/rules',{'name':'ระบบล่ม','channel':'web','keywords':'ระบบล่ม','set_priority':'urgent'})
        conv = self.started(self.browser(),body='ระบบล่ม เข้าไม่ได้เลยค่ะ')
        urgent = self.ok(self.admin,f'/api/conversations/{conv}')['ticket']['id']
        self.assertEqual(self.ok(self.admin,f'/api/tickets/{urgent}')['ticket']['priority'],'urgent')
        self.assertEqual(hours_of(urgent),(1,8))

    def test_quiet_cases_are_asked_then_closed(self):
        form = {'enabled':True,'remind_days':3,'close_days':2,'remind_message':f'ยังต้องการความช่วยเหลือไหม จะปิดใน {quiet.TOKEN} วัน',
                'close_message':'ปิดเรื่องนี้แล้ว ตอบกลับเพื่อเปิดใหม่'}
        for bad in ({'remind_days':0},{'close_days':31},{'remind_days':'3'},{'close_message':''},{'enabled':'yes'}):
            self.assertEqual(self.admin.call('/api/settings/quiet-close',{**form,**bad})[0],400)
        agent,_ = self.create_member()
        self.assertEqual(agent.call('/api/settings/quiet-close',form)[0],403)

        mine = set()   # the demo data has a waiting case of its own

        def run(days):
            with D.tenant(self.org) as db:
                return [change for case_id,change in quiet.run(db,self.org,dt.datetime.now(dt.timezone.utc)+dt.timedelta(days=days,minutes=1))
                        if case_id in mine]

        def waiting_case(page, body):
            conv = self.started(page,body=body)
            case = self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']
            self.reply(conv,'ขอเลขที่คำสั่งซื้อด้วยค่ะ')
            self.ok(self.admin,f'/api/tickets/{case}',{'status':'pending_customer'},'PATCH')
            mine.add(case)
            return conv,case

        page = self.browser()
        conv,case = waiting_case(page,'สั่งของแล้วยังไม่ได้รับ')
        # Off (the default): nothing, however long.
        self.assertEqual(run(30),[])
        self.ok(self.admin,'/api/settings/quiet-close',form)
        self.assertEqual(run(2),[])
        self.assertEqual(run(3),['reminded'])
        self.assertEqual(run(3),[])
        said = [m['body'] for m in self.ok(page,GUEST+'/session')['messages']]
        self.assertIn('ยังต้องการความช่วยเหลือไหม จะปิดใน 2 วัน',said)
        # Still waiting for the customer, and not the team's reply.
        listed = next(c for c in self.ok(self.admin,'/api/conversations')['conversations'] if c['id']==conv)
        self.assertEqual(listed['last_public_kind'],'reply')
        self.assertEqual(run(4),[])
        self.assertEqual(run(5),['closed'])
        ticket = self.ok(self.admin,f'/api/tickets/{case}')['ticket']
        self.assertEqual(ticket['status'],'closed')
        self.assertIn('ปิดเรื่องนี้แล้ว ตอบกลับเพื่อเปิดใหม่',[m['body'] for m in self.ok(page,GUEST+'/session')['messages']])
        # The customer writing again reopens it; a customer who answers the question is not closed.
        self.ok(page,GUEST+'/messages',{'body':'ยังไม่ได้ของค่ะ'})
        self.assertEqual(self.ok(self.admin,f'/api/tickets/{case}')['ticket']['status'],'open')
        page2 = self.browser()
        _,other = waiting_case(page2,'ขอใบกำกับภาษี')
        self.assertEqual(run(3),['reminded'])
        self.ok(page2,GUEST+'/messages',{'body':'ส่งเลขที่ให้แล้วค่ะ'})
        self.assertEqual(self.ok(self.admin,f'/api/tickets/{other}')['ticket']['status'],'open')
        self.assertEqual(run(10),[])
        # Back to รอลูกค้า: asked again from the start, not closed on the old question.
        self.ok(self.admin,f'/api/tickets/{other}',{'status':'pending_customer'},'PATCH')
        self.assertEqual(run(3),['reminded'])
        # LINE: the question goes out through LINE.
        self.route = self.configure()['route_id']
        self.say('สอบถามเรื่องสมาชิกทาง LINE')
        with D.tenant(self.org) as db:
            line_conv = db.execute("SELECT id FROM conversations WHERE channel='line' ORDER BY created_at DESC LIMIT 1").fetchone()[0]
        line_case = self.ok(self.admin,f'/api/conversations/{line_conv}/ticket',{})['id']
        self.ok(self.admin,f'/api/tickets/{line_case}',{'status':'pending_customer'},'PATCH')
        mine.add(line_case)
        self.line.reset_mock()
        self.assertIn('reminded',run(3))
        self.assertTrue(C.process_outbox(self.org))
        self.assertIn('ยังต้องการความช่วยเหลือไหม',self.line.call_args.args[2])

    def test_old_conversations_lose_their_content_after_the_chosen_time(self):
        for bad in ({'enabled':True,'months':7},{'enabled':'yes','months':24},{'enabled':True,'months':'24'}):
            self.assertEqual(self.admin.call('/api/settings/retention',bad)[0],400)
        agent,_ = self.create_member()
        self.assertEqual(agent.call('/api/settings/retention',{'enabled':False,'months':24})[0],403)

        def chat(body, status=None):
            conv = self.started(self.browser(),body=body)
            case = self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']
            self.reply(conv,'ตอบแล้วค่ะ')
            if status:
                self.ok(self.admin,f'/api/tickets/{case}',{'status':status},'PATCH')
            return conv,case

        old,old_case = chat('ที่อยู่ของฉันคือ 99 ถนนสุขุมวิท','resolved')
        working,_ = chat('เรื่องนี้ยังไม่จบ')
        recent,_ = chat('เพิ่งถามเมื่อวาน','resolved')
        three_years = (dt.datetime.now(dt.timezone.utc)-dt.timedelta(days=3*365)).isoformat(timespec='seconds')
        folder = D.DATA/'files'/self.org
        folder.mkdir(parents=True,exist_ok=True)
        (folder/'retention-test.pdf').write_bytes(b'%PDF-1.4 test')
        with D.tenant(self.org) as db:
            for conv in (old,working):
                db.execute('UPDATE messages SET created_at=? WHERE conversation_id=?',(three_years,conv))
                db.execute('UPDATE conversations SET created_at=?,updated_at=? WHERE id=?',(three_years,three_years,conv))
            first = db.execute('SELECT id FROM messages WHERE conversation_id=? ORDER BY created_at LIMIT 1',(old,)).fetchone()[0]
            db.execute("INSERT INTO attachments VALUES('a'||hex(randomblob(15)),?,'slip.pdf','application/pdf',13,'retention-test.pdf')",(first,))
            db.commit()
        state = self.ok(self.admin,'/api/settings/retention',{'enabled':True,'months':24})
        self.assertEqual(state['preview']['24'],{'conversations':1,'files':1,'bytes':13})
        self.assertTrue(state['starts_at'])

        def run(days):
            with D.tenant(self.org) as db:
                return retention.run(db,self.org,dt.datetime.now(dt.timezone.utc)+dt.timedelta(days=days))

        # Nothing goes during the wait after turning it on.
        self.assertEqual(run(0),0)
        self.assertEqual(run(retention.WAIT_DAYS+1),1)
        self.assertEqual(run(retention.WAIT_DAYS+1),0)
        messages = self.ok(self.admin,f'/api/conversations/{old}')['messages']
        self.assertTrue(messages and all(m['body']=='' and m['deleted_at'] for m in messages))
        self.assertFalse(any('สุขุมวิท' in str(m) for m in messages))
        self.assertFalse((folder/'retention-test.pdf').exists())
        ticket = self.ok(self.admin,f'/api/tickets/{old_case}')['ticket']
        self.assertEqual((ticket['subject'],ticket['status']),(retention.CLEARED_SUBJECT,'resolved'))
        # A case still being worked on and a recent chat keep everything.
        for conv in (working,recent):
            self.assertTrue(all(m['body'] for m in self.ok(self.admin,f'/api/conversations/{conv}')['messages']))
        cleared = self.ok(self.admin,'/api/settings/retention')['cleared']
        self.assertEqual((cleared['conversations'],cleared['files']),(1,1))
        # Turned off: nothing more.
        self.ok(self.admin,'/api/settings/retention',{'enabled':False,'months':24})
        self.assertEqual(run(400),0)

    def test_settings_are_checked_and_for_owners_only(self):
        for days in (WEEK[:6],[['18:00','09:00']]+WEEK[1:],[['9:00','18:00']]+WEEK[1:]):
            status,_ = self.admin.call('/api/settings/hours',{'enabled':True,'days':days,'message':'x'})
            self.assertEqual(status,400)
        status,_ = self.admin.call('/api/settings/hours',{'enabled':True,'days':[None]*7,'message':'x'})
        self.assertEqual(status,400)
        agent,_ = self.create_member()
        self.assertEqual(agent.call('/api/settings/hours',{'enabled':False,'days':WEEK,'message':'x'})[0],403)
        saved = self.hours(WEEK)['business_hours']
        self.assertEqual(saved['days'][0],['09:00','18:00'])
        self.assertIn('business_hours',self.ok(self.admin,'/api/workspace')['settings'])

    def test_notice_outside_hours_once_on_the_web_and_on_line(self):
        # Off (the default): nothing.
        page = self.browser()
        self.started(page,body='สอบถามก่อนเปิดใช้เวลาทำการ')
        self.assertFalse([m for m in self.ok(page,GUEST+'/session')['messages'] if 'นอกเวลา' in m['body']])
        self.hours(closed_now())
        page = self.browser()
        conv = self.started(page,body='สวัสดีค่ะ ตอนกลางคืน')
        self.ok(page,GUEST+'/messages',{'body':'ขอเพิ่มอีกข้อความค่ะ'})
        notices = [m for m in self.ok(page,GUEST+'/session')['messages'] if 'นอกเวลาทำการ' in m['body']]
        self.assertEqual(len(notices),1)
        # Still waiting for the team, and not the team's first response.
        listed = next(c for c in self.ok(self.admin,'/api/conversations')['conversations'] if c['id']==conv)
        self.assertEqual(listed['last_public_kind'],'customer')
        detail = self.ok(self.admin,f'/api/conversations/{conv}')
        self.assertIsNone((detail.get('ticket') or {}).get('first_response_at'))
        # LINE: the notice goes out through LINE.
        self.route = self.configure()['route_id']
        self.say('สวัสดีค่ะ ทัก LINE ตอนร้านปิด')
        self.assertTrue(C.process_outbox(self.org))
        self.assertIn('นอกเวลาทำการ',self.line.call_args.args[2])

    def test_channel_watch_tells_admins_when_line_stops_and_returns(self):
        self.enable_registration_mail()
        self.route = self.configure()['route_id']
        with patch.object(T,'verify_line',side_effect=ChannelError('credentials')):
            self.assertEqual(health.run(self.org),[])
        with D.tenant(self.org) as db:
            self.assertTrue(db.execute("SELECT broken_since FROM channel_health WHERE kind='line'").fetchone()[0])
        self.assertEqual(self.ok(self.admin,'/api/automation/alerts')['channels'],[])
        # Still refused after the grace period: told once, by email and in the admins' bell.
        self.age('broken_since',health.GRACE_MINUTES+1)
        self.age('verified_at',health.RECHECK_MINUTES+1)
        sent = self.mailer.call_count
        with patch.object(T,'verify_line',side_effect=ChannelError('credentials')):
            self.assertEqual(health.run(self.org),[('line','broken')])
            self.age('verified_at',health.RECHECK_MINUTES+1)
            self.assertEqual(health.run(self.org),[])
        self.assertEqual(self.mailer.call_count,sent+1)
        self.assertIn('LINE',self.mailer.call_args.args[3]['Subject'])
        self.assertEqual([a['kind'] for a in self.ok(self.admin,'/api/automation/alerts')['channels']],['line'])
        agent,_ = self.create_member()
        self.assertEqual(self.ok(agent,'/api/automation/alerts')['channels'],[])
        # Working again: told once, and the bell is clear.
        self.age('verified_at',health.RECHECK_MINUTES+1)
        with patch.object(T,'verify_line',return_value={'identity':guest_tests.channel_tests.BOT}), \
                patch.object(T,'line_webhook_info',return_value={'endpoint':'https://x/api/webhooks/line/'+self.route,'active':True}):
            self.assertEqual(health.run(self.org),[('line','recovered')])
        self.assertIn('กลับมาใช้ได้แล้ว',self.mailer.call_args.args[3]['Subject'])
        self.assertEqual(self.ok(self.admin,'/api/automation/alerts')['channels'],[])
        line = next(c for c in self.ok(self.admin,'/api/channels') if c['kind']=='line')
        self.assertEqual(line['webhook'],{'endpoint':'https://x/api/webhooks/line/'+self.route,'active':True})

    def age(self, column, minutes):
        stamp = (dt.datetime.now(dt.timezone.utc)-dt.timedelta(minutes=minutes)).isoformat(timespec='seconds')
        with D.tenant(self.org) as db:
            db.execute(f"UPDATE channel_health SET {column}=? WHERE kind='line'",(stamp,))
            db.commit()


# The setUp, the helpers and the LINE test tools of the guest chat tests, without their tests.
for _name, _member in vars(guest_tests.GuestChatTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(HoursAndWatchTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
