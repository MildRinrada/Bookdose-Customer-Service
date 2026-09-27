"""What makes the team's day a little better: กำแพงคำชม (kudos), ยกมือขอช่วย (tickets/hands.py), พยากรณ์อากาศของ
กล่องข้อความ (automation/weather.py), and each member's own ผลงานของฉัน - the monthly summary and badges
(achievements). Disposable databases."""
import datetime as dt
import unittest

import test_app as base
from test_app import D
from backend.modules.achievements import badges, recap
from backend.modules.kudos import service as kudos


def stamp(moment):
    return moment.isoformat(timespec='seconds')


class TeamSpiritTests(unittest.TestCase):
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

    def test_praise_words_are_told_from_manners_and_questions(self):
        self.assertTrue(kudos.is_praise('ประทับใจมากค่ะ แอดมินใจดีสุด ๆ'))
        self.assertTrue(kudos.is_praise('ขอบคุณมากนะคะที่ช่วยตามเรื่องให้จนได้ของครบ'))
        self.assertFalse(kudos.is_praise('ขอบคุณค่ะ'))
        self.assertFalse(kudos.is_praise('ไม่ประทับใจเลย'))
        self.assertFalse(kudos.is_praise('ขอบคุณค่ะ แล้วจะได้ของเมื่อไหร่คะ'))
        self.assertFalse(kudos.is_praise('บริการดีมาก แต่รอนานจนโมโห'))
        self.assertEqual(kudos.shown_text('ขอบคุณ ติดต่อ a@b.co หรือ 081-234-5678'),'ขอบคุณ ติดต่อ [อีเมล] หรือ [เบอร์โทร]')

    def test_the_wall_takes_praise_for_the_last_reply_and_colleagues_cheer(self):
        agent,agent_id = self.create_member()
        client,conv = self.visitor()
        self.ok(agent,f'/api/conversations/{conv}/messages',{'kind':'reply','body':'ส่งของชิ้นใหม่ให้แล้วนะคะ'})
        self.ok(client,'/api/public/alpha/messages',{'body':'ขอบคุณค่ะ'})
        self.assertEqual(self.ok(self.admin,'/api/kudos')['items'],[])
        self.ok(client,'/api/public/alpha/messages',{'body':'ได้ของแล้ว ประทับใจมาก บริการดีมากค่ะ โทรมา 0812345678'})
        # Once a day per member and conversation, however often the customer says it.
        self.ok(client,'/api/public/alpha/messages',{'body':'ขอบคุณอีกครั้งนะคะ ช่วยได้มากจริง ๆ'})
        wall = self.ok(self.admin,'/api/kudos')
        self.assertEqual(wall['total'],1)
        item = wall['items'][0]
        self.assertEqual((item['user_id'],item['source']),(agent_id,'message'))
        self.assertIn('[เบอร์โทร]',item['text'])
        self.assertNotIn('0812345678',str(wall))
        self.assertTrue(item['removable'])
        # The praised member hears about it, and does not cheer their own.
        self.assertEqual([k['id'] for k in self.ok(agent,'/api/automation/alerts')['kudos']],[item['id']])
        self.assertEqual(agent.call(f"/api/kudos/{item['id']}/cheer",{'on':True})[0],403)
        # A member of another team reads it too, and cheers.
        other = self.ok(self.admin,'/api/teams',{'name':'ทีมอื่น'})['id']
        colleague,_ = self.create_member(team=other,email='other@example.com')
        self.ok(colleague,f"/api/kudos/{item['id']}/cheer",{'on':True})
        seen = self.ok(colleague,'/api/kudos')['items'][0]
        self.assertTrue(seen['cheered'])
        self.assertFalse(seen['removable'])
        self.assertEqual(colleague.call(f"/api/kudos/{item['id']}",None,'DELETE')[0],403)
        self.assertEqual(self.ok(self.admin,'/api/automation/overview?tz=-420')['kudos']['items'][0]['cheers'][0]['name'],'เจ้าหน้าที่ทดสอบ')
        # The owner takes it down.
        self.ok(self.admin,f"/api/kudos/{item['id']}",None,'DELETE')
        self.assertEqual(self.ok(self.admin,'/api/kudos')['total'],0)

    def test_five_stars_with_a_comment_praise_the_owner_and_go_with_the_customer(self):
        agent,agent_id = self.create_member()
        client,conv = self.visitor()
        tid = self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']
        self.ok(self.admin,f'/api/tickets/{tid}',{'assignee_id':agent_id},'PATCH')
        with D.tenant(self.org) as db:
            survey = {'id':'s'*32,'ticket_id':tid,'conversation_id':conv}
            kudos.on_rating(db,survey,4,'ดีค่ะ')
            kudos.on_rating(db,survey,5,'แอดมินน่ารักมาก ตอบไวสุด ๆ')
            db.commit()
            forget = [r[0] for r in db.execute('SELECT id FROM conversations WHERE id=?',(conv,))]
        item = self.ok(self.admin,'/api/kudos')['items'][0]
        self.assertEqual((item['user_id'],item['rating'],item['source']),(agent_id,5,'csat'))
        with D.tenant(self.org) as db:
            kudos.forget_conversations(db,forget)
            db.commit()
        self.assertEqual(self.ok(self.admin,'/api/kudos')['total'],0)

    def test_a_raised_hand_reaches_the_team_and_the_owner_and_comes_down(self):
        agent,agent_id = self.create_member()
        helper,helper_id = self.create_member(email='helper@example.com')
        other = self.ok(self.admin,'/api/teams',{'name':'ทีมอื่น'})['id']
        stranger,_ = self.create_member(team=other,email='stranger@example.com')
        client,conv = self.visitor()
        tid = self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']
        hand = self.ok(agent,f'/api/tickets/{tid}/hand',{'note':'ลูกค้าขอคืนสินค้าเกินกำหนด ทำยังไงดี'})['hand']
        self.assertEqual((hand['raised_by'],hand['note']),(agent_id,'ลูกค้าขอคืนสินค้าเกินกำหนด ทำยังไงดี'))
        self.assertEqual(helper.call(f'/api/tickets/{tid}/hand',{})[0],409)
        # Another team's agent does not see the case, nor its hand.
        self.assertEqual(stranger.call(f'/api/tickets/{tid}/hand/help',{})[0],404)
        self.assertEqual(self.ok(stranger,'/api/automation/alerts')['hands'],[])
        # The team and the owner do; the one who asked hears nothing yet.
        self.assertEqual([h['kind'] for h in self.ok(helper,'/api/automation/alerts')['hands']],['ask'])
        self.assertEqual(len(self.ok(self.admin,'/api/automation/alerts')['hands']),1)
        self.assertEqual(self.ok(agent,'/api/automation/alerts')['hands'],[])
        listed = next(t for t in self.ok(helper,'/api/tickets')['tickets'] if t['id']==tid)
        self.assertEqual((listed['hand']['raised_name'],listed['hand']['raised_by']),('เจ้าหน้าที่ทดสอบ',agent_id))
        self.assertEqual(agent.call(f'/api/tickets/{tid}/hand/help',{})[0],400)
        self.ok(helper,f'/api/tickets/{tid}/hand/help',{})
        coming = self.ok(agent,'/api/automation/alerts')['hands']
        self.assertEqual((coming[0]['kind'],coming[0]['helper_id']),('coming',helper_id))
        self.assertEqual(self.ok(self.admin,f'/api/tickets/{tid}')['ticket']['hand']['helper_id'],helper_id)
        # A member with nothing to do with it cannot put it down; finishing the case does.
        bystander,_ = self.create_member(email='bystander@example.com')
        self.assertEqual(bystander.call(f'/api/tickets/{tid}/hand',None,'DELETE')[0],403)
        self.ok(self.admin,f'/api/tickets/{tid}',{'status':'resolved'},'PATCH')
        self.assertIsNone(self.ok(self.admin,f'/api/tickets/{tid}')['ticket']['hand'])
        self.assertEqual(agent.call(f'/api/tickets/{tid}/hand',{})[0],400)
        with D.tenant(self.org) as db:
            self.assertEqual(badges.measures(db,helper_id)['helped'],1)

    def test_the_weather_line_reads_the_day(self):
        weather = self.ok(self.admin,'/api/automation/overview?tz=-420')['weather']
        self.assertIn(weather['kind'],('storm','rain','hot','cloudy','clear','fair'))
        self.assertTrue(weather['title'] and weather['detail'])
        # A team whose weekday brought one case each of the last five weeks, and twelve so far today: a storm.
        team = self.ok(self.admin,'/api/teams',{'name':'ทีมพยากรณ์'})['id']
        agent,_ = self.create_member(team=team,email='weather@example.com')
        with D.tenant(self.org) as db:
            contact = db.execute('SELECT id FROM contacts LIMIT 1').fetchone()[0]
            moment = dt.datetime.now(dt.timezone.utc)
            number = db.execute('SELECT MAX(number) FROM tickets').fetchone()[0] or 0
            def case(at):
                nonlocal number
                number += 1
                db.execute('''INSERT INTO tickets(id,number,subject,contact_id,team_id,priority,status,created_at,updated_at,
                              first_response_due_at,resolution_due_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)''',
                           (f'{number:032x}',number,'ทดสอบ',contact,team,'normal','resolved',stamp(at),stamp(at),stamp(at),stamp(at)))
            for week in range(1,6):
                case(moment-dt.timedelta(days=7*week))
            for _ in range(12):
                case(moment-dt.timedelta(seconds=30))
            db.commit()
        weather = self.ok(agent,'/api/automation/overview?tz=-420')['weather']
        self.assertEqual(weather['kind'],'storm',weather)
        self.assertGreaterEqual(weather['expected'],12)

    def test_badges_and_the_months_summary_are_the_members_own(self):
        agent,agent_id = self.create_member()
        client,conv = self.visitor()
        tid = self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']
        self.ok(self.admin,f'/api/tickets/{tid}',{'assignee_id':agent_id},'PATCH')
        self.ok(agent,f'/api/conversations/{conv}/messages',{'kind':'reply','body':'ได้เลยค่ะ ส่งให้แล้ว'})
        self.ok(agent,f'/api/tickets/{tid}',{'status':'resolved'},'PATCH')
        # The first case closed is a badge, given with the alerts and celebrated once.
        fresh = self.ok(agent,'/api/automation/alerts')['badges']
        self.assertIn('first_close',[b['key'] for b in fresh])
        self.ok(agent,'/api/achievements/badges/seen',{'keys':[b['key'] for b in fresh]})
        badges._checked.clear()
        self.assertEqual(self.ok(agent,'/api/automation/alerts')['badges'],[])
        mine = {b['key']:b for b in self.ok(agent,'/api/achievements')['badges']}
        self.assertTrue(mine['first_close']['earned_at'])
        self.assertEqual((mine['close_50']['progress'],mine['close_50']['earned_at']),(1,None))
        self.assertFalse(next(b for b in self.ok(self.admin,'/api/achievements')['badges'] if b['key']=='first_close')['earned_at'])
        # Last month, in Thai time: the work is moved there, and the card pops up once.
        start,_ = recap.bounds(recap.last_month())
        when = stamp(dt.datetime.fromisoformat(start)+dt.timedelta(days=3,hours=23))   # 23:00 Thai time
        with D.tenant(self.org) as db:
            db.execute("UPDATE messages SET created_at=? WHERE conversation_id=? AND kind='reply'",(when,conv))
            db.execute('UPDATE tickets SET resolved_at=? WHERE id=?',(when,tid))
            db.commit()
        pending = self.ok(agent,'/api/automation/alerts')['recap']
        self.assertEqual(pending['month'],recap.last_month())
        card = self.ok(agent,'/api/achievements/recap')
        self.assertEqual((card['closed'],card['replies'],card['night'],card['empty']),(1,1,1,False))
        self.assertEqual(card['busiest']['count'],1)
        self.assertTrue(card['title']['name'] and card['title']['reason'])
        self.assertEqual(self.admin.call('/api/achievements/recap?month=2001-01')[0],400)
        self.ok(agent,'/api/achievements/recap/seen',{'month':pending['month']})
        self.assertIsNone(self.ok(agent,'/api/automation/alerts')['recap'])
        # Switched off, it never pops up.
        with D.tenant(self.org) as db:
            db.execute('DELETE FROM staff_recaps_seen')
            db.commit()
        self.ok(agent,'/api/account/preferences',{'notify':{'desktop':False,'sound':False,'email':False,'celebrate':True,'recap':False,'events':{}}})
        self.assertIsNone(self.ok(agent,'/api/automation/alerts')['recap'])


if __name__=='__main__':
    unittest.main()
