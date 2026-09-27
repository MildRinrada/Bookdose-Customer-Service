"""The service report's goals and the figures behind them (reports/stats.py, goals.py, weekly.py): how long the customer
waited for each next reply, the team's replies (one-reply solves), how upset the customer got at any point, the
owner's goals for the organization and per team, and the weekly summary email to the owners. Disposable databases."""
import datetime as dt
import json
import unittest

import test_app as base
from test_app import D
from backend.modules.reports import stats, weekly

GOALS = '/api/reports/goals'


def stamp(moment):
    return moment.isoformat(timespec='seconds')


class ReportGoalTests(unittest.TestCase):
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

    def conversation(self, start=None):
        """A customer who was angry at first, answered after 10 minutes, wrote again an hour in and waited 90 minutes
        for the next reply, opened at `start` (five hours ago): (ticket id, start)."""
        client,conv = self.visitor(subject='ของเสียหาย',body='ได้ของมาแตก แย่มาก')
        tid = self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']
        self.ok(self.admin,f'/api/conversations/{conv}/messages',{'kind':'reply','body':'ขออภัยค่ะ จะส่งชิ้นใหม่ให้'})
        self.ok(client,'/api/public/alpha/messages',{'body':'ส่งเมื่อไหร่คะ'})
        self.ok(client,'/api/public/alpha/messages',{'body':'รอคำตอบอยู่นะคะ'})
        self.ok(self.admin,f'/api/conversations/{conv}/messages',{'kind':'reply','body':'ส่งพรุ่งนี้ค่ะ'})
        start = start or dt.datetime.now(dt.timezone.utc).replace(microsecond=0)-dt.timedelta(hours=5)
        with D.tenant(self.org) as db:
            ids = [r[0] for r in db.execute("SELECT id FROM messages WHERE conversation_id=? AND kind IN ('customer','reply') ORDER BY rowid",(conv,))]
            for message_id,minutes in zip(ids,(0,10,60,70,150)):
                db.execute('UPDATE messages SET created_at=? WHERE id=?',(stamp(start+dt.timedelta(minutes=minutes)),message_id))
            db.execute('UPDATE tickets SET created_at=?,first_response_at=? WHERE id=?',(stamp(start),stamp(start+dt.timedelta(minutes=10)),tid))
            db.commit()
        return tid,start

    def test_the_figures_behind_the_report_come_from_each_case(self):
        # Long before the demo cases, so they do not count.
        tid,start = self.conversation(dt.datetime(2020,1,6,3,0,tzinfo=dt.timezone.utc))
        extras = self.ok(self.admin,'/api/reports/extras?from=2020-01-06&to=2020-01-06&tz=0')
        # The next reply: from the customer's first message of the turn (60) to the team's reply (150). The words read
        # the first message as angry; a calmer message after it does not undo that for the report.
        self.assertEqual(extras['case_stats'][tid],{'waits':[90.0],'replies':2,'upset':2})
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute('SELECT level FROM conversation_moods').fetchone()[0],0)
        # The same figures for a window, as the weekly email counts them.
        self.ok(self.admin,f'/api/tickets/{tid}',{'status':'resolved'},'PATCH')
        with D.tenant(self.org) as db:
            db.execute('UPDATE tickets SET resolved_at=? WHERE id=?',(stamp(start+dt.timedelta(minutes=160)),tid))
            db.commit()
            summary = stats.summary(db,stamp(start-dt.timedelta(hours=1)),stamp(start+dt.timedelta(hours=4)))
        self.assertEqual({k:summary[k] for k in ('opened','first_response','response_sla','next_reply','fcr','upset','reopen')},
                         {'opened':1,'first_response':10.0,'response_sla':100.0,'next_reply':90.0,'fcr':0.0,'upset':100.0,'reopen':0.0})
        # An agent of another team sees none of it.
        other = self.ok(self.admin,'/api/teams',{'name':'ทีมอื่น'})['id']
        agent,_ = self.create_member(team=other,email='other-team@example.com')
        self.assertNotIn(tid,self.ok(agent,'/api/reports/extras?from=2020-01-06&to=2020-01-06&tz=0')['case_stats'])

    def test_the_owner_sets_goals_for_the_organization_and_per_team(self):
        agent,_ = self.create_member()
        self.assertEqual(agent.call(GOALS,{'org':{'csat':4.5}})[0],403)
        for bad in ({'org':{'response_sla':150}},{'org':{'speed':1}},{'org':{'csat':'4'}},{'teams':{'f'*32:{'csat':4}}}):
            self.assertEqual(self.admin.call(GOALS,bad)[0],400,bad)
        saved = self.ok(self.admin,GOALS,{'org':{'response_sla':90,'csat':4.5,'reopen':5,'first_response':''},
                                           'teams':{self.team:{'next_reply':120},}})
        self.assertEqual(saved,{'org':{'response_sla':90.0,'csat':4.5,'reopen':5.0},'teams':{self.team:{'next_reply':120.0}}})
        self.assertEqual(json.loads(self.ok(agent,'/api/workspace')['settings']['report_goals']),saved)
        # A team with no target of its own left out.
        self.assertEqual(self.ok(self.admin,GOALS,{'org':{'csat':4},'teams':{self.team:{'csat':None}}})['teams'],{})

    def test_the_owners_get_last_weeks_summary_on_monday_morning(self):
        self.conversation()
        self.ok(self.admin,GOALS,{'org':{'response_sla':90,'next_reply':60}})
        agent,_ = self.create_member()
        today = dt.datetime.now(weekly.WORK_TZ).date()
        monday = today+dt.timedelta(days=7-today.weekday())
        at = lambda day,hour:dt.datetime.combine(day,dt.time(hour),weekly.WORK_TZ)
        with D.control() as cd, D.tenant(self.org) as db:
            self.assertEqual(weekly.run(cd,db,self.org,at(monday,7)),0)                        # before eight
            self.assertEqual(weekly.run(cd,db,self.org,at(monday+dt.timedelta(days=1),9)),0)   # not a Monday
            self.assertEqual(weekly.run(cd,db,self.org,at(monday,9)),1)                        # the owner, not the agent
            self.assertEqual(weekly.run(cd,db,self.org,at(monday,10)),0)                       # once a week
            notice = db.execute("SELECT user_id,subject,detail,path FROM staff_notices WHERE event='weekly_report'").fetchone()
        self.assertEqual(notice['path'],'/reports')
        # A formal memo, with no dots between its parts.
        self.assertTrue(notice['subject'].startswith('สรุปรายงานผลการให้บริการลูกค้าประจำสัปดาห์'))
        self.assertTrue(notice['detail'].startswith('ขอนำส่งสรุปรายงานผลการให้บริการลูกค้าประจำสัปดาห์ของ'))
        self.assertRegex(notice['detail'],r'1\. จำนวนเคสที่เปิดใหม่ \d+ เคส \(0 เคส\)')
        self.assertRegex(notice['detail'],r'การตอบกลับครั้งแรกทันกำหนด ร้อยละ [\d.]+ \(ไม่มีข้อมูล\) เป้าหมายไม่น้อยกว่า ร้อยละ 90 (เป็นไปตามเป้าหมาย|ไม่เป็นไปตามเป้าหมาย)')
        self.assertIn('เวลารอคำตอบถัดไป ค่ามัธยฐาน 1 ชั่วโมง 30 นาที (ไม่มีข้อมูล) เป้าหมายไม่เกิน 1 ชั่วโมง ไม่เป็นไปตามเป้าหมาย',notice['detail'])
        self.assertNotIn('·',notice['subject']+notice['detail'])
        from backend.modules.staff_prefs import service as staff_prefs
        letter = staff_prefs._formal_body('ทดสอบ',notice['detail'],'https://example.com/reports')
        self.assertTrue(letter.startswith('เรียน คุณทดสอบ'))
        self.assertIn('จึงเรียนมาเพื่อโปรดทราบ',letter)
        # The owner chooses it among the emails about their work.
        self.assertIn('weekly_report',self.ok(self.admin,'/api/account/preferences')['events'])


if __name__=='__main__':
    unittest.main()
