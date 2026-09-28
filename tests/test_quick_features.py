"""ค้นหาด่วน (search/service.py), รีแอคข้อความ (conversations/reactions.py), หัวใจจากการ์ดขอบคุณ (automation/thanks.py
heart) and เส้นทางเคส (tickets/journey.py). Disposable databases."""
import sqlite3
import unittest

import test_app as base
from backend.modules.conversations import reactions
from backend.modules.kudos import model as kudos_model, service as kudos

SETTINGS = {'escalation_enabled':True,'escalation_minutes':15,'csat_enabled':True,'csat_message':'ให้คะแนนหน่อยนะ',
            'thanks_enabled':True,'thanks_message':''}


class QuickFeatureTests(unittest.TestCase):
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

    def reply(self, conv, body='ตรวจให้แล้ว ลองอีกครั้งได้เลยค่ะ', client=None):
        self.ok(client or self.admin,f'/api/conversations/{conv}/messages',{'kind':'reply','body':body})
        return self.ok(client or self.admin,f'/api/conversations/{conv}')['messages'][-1]['id']

    def test_search_finds_cases_customers_and_articles_the_member_may_open(self):
        client,conv = self.visitor(subject='สั่งซื้อแล้วไม่ได้รับอีเมล')
        tid = self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']
        number = self.ok(self.admin,f'/api/tickets/{tid}')['ticket']['number']
        self.ok(self.admin,'/api/contacts',{'first_name':'สมหญิง ใจดี','email':'somying@example.com','phone':'081-234-5678','company':'ร้านใจดี'})
        self.ok(self.admin,'/api/articles',{'title':'วิธีรีเซ็ตรหัสผ่าน','category':'บัญชี','body':'ขั้นตอน'})
        find = lambda client,q:self.ok(client,f'/api/search?q={q}')
        for q in (f'BD-{number}',f'bd{number}',f'%23{number}',f'BD-{str(number)[:-1] or number}'):
            self.assertEqual(find(self.admin,q)['cases'][0]['id'],tid,q)
        self.assertEqual([c['id'] for c in find(self.admin,'%E0%B9%84%E0%B8%A1%E0%B9%88%E0%B9%84%E0%B8%94%E0%B9%89%E0%B8%A3%E0%B8%B1%E0%B8%9A')['cases']],[tid])
        # A phone number however it is written, and the article by its title.
        for q in ('0812345678','081%20234%205678','2345678'):
            self.assertEqual([c['name'] for c in find(self.admin,q)['customers']],['สมหญิง ใจดี'],q)
        self.assertEqual([a['title'] for a in find(self.admin,'%E0%B8%A3%E0%B8%B5%E0%B9%80%E0%B8%8B%E0%B9%87%E0%B8%95')['articles']],['วิธีรีเซ็ตรหัสผ่าน'])
        # A % typed is a percent sign, not "anything"; an empty box finds nothing.
        self.assertEqual(find(self.admin,'%25')['cases'],[])
        self.assertEqual(find(self.admin,'%20'),{'query':'','cases':[],'customers':[],'articles':[]})
        # An agent of another team finds neither the case nor its customer; articles are everybody's.
        other_team = self.ok(self.admin,'/api/teams',{'name':'ทีมเทคนิค'})['id']
        agent,_ = self.create_member(team=other_team)
        self.assertEqual(find(agent,f'BD-{number}')['cases'],[])
        self.assertEqual(find(agent,'visitor%40example.com')['customers'],[])
        self.assertEqual(len(find(agent,'%E0%B8%A3%E0%B8%B5%E0%B9%80%E0%B8%8B%E0%B9%87%E0%B8%95')['articles']),1)
        self.assertEqual(client.call('/api/search?q=x')[0],401)

    def test_a_reaction_tells_the_team_without_reopening_the_case(self):
        agent,agent_id = self.create_member()
        self.ok(self.admin,'/api/automation/settings',SETTINGS,'PATCH')
        client,conv = self.visitor()
        reply = self.reply(conv)
        tid = self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']
        self.ok(self.admin,f'/api/tickets/{tid}',{'assignee_id':agent_id,'status':'resolved'},'PATCH')
        path = f'/api/public/alpha/messages/{reply}/reaction'
        self.assertEqual(self.ok(client,path,{'reaction':'heart'}),{'reaction':'heart'})
        # The case stays finished and the thank-you card stays; both sides see the heart on the reply.
        self.assertEqual(self.ok(self.admin,f'/api/tickets/{tid}')['ticket']['status'],'resolved')
        session = self.ok(client,'/api/public/alpha/session')
        self.assertIsNotNone(session['thanks'])
        self.assertEqual({m['id']:m['reaction'] for m in session['messages']}[reply],'heart')
        staff = self.ok(self.admin,f'/api/conversations/{conv}')['messages']
        self.assertEqual({m['id']:m['reaction'] for m in staff}[reply],'heart')
        # Another choice changes it; the same again takes it back.
        for reaction in ('like','laugh','wow','sad','thanks'):
            self.assertEqual(self.ok(client,path,{'reaction':reaction}),{'reaction':reaction})
        self.ok(client,path,{'reaction':None})
        self.assertIsNone({m['id']:m['reaction'] for m in self.ok(client,'/api/public/alpha/session')['messages']}[reply])
        # Not the survey, not the customer's own words, nothing but 👍 and ❤, and nobody else's chat.
        survey = next(m['id'] for m in self.ok(client,'/api/public/alpha/session')['messages'] if m['survey'])
        own = next(m['id'] for m in self.ok(client,'/api/public/alpha/session')['messages'] if m['kind']=='customer')
        self.assertEqual(client.call(f'/api/public/alpha/messages/{survey}/reaction',{'reaction':'like'})[0],400)
        self.assertEqual(client.call(f'/api/public/alpha/messages/{own}/reaction',{'reaction':'like'})[0],404)
        self.assertEqual(client.call(path,{'reaction':'angry'})[0],400)
        other,_ = self.visitor(email='other@example.com')
        self.assertEqual(other.call(path,{'reaction':'like'})[0],404)

    def test_a_heart_from_the_thank_you_card_goes_up_on_the_wall(self):
        agent,agent_id = self.create_member()
        self.ok(self.admin,'/api/automation/settings',SETTINGS,'PATCH')
        client,conv = self.visitor()
        self.reply(conv,client=agent)
        tid = self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']
        self.ok(self.admin,f'/api/tickets/{tid}',{'assignee_id':agent_id,'status':'resolved'},'PATCH')
        card = self.ok(client,'/api/public/alpha/session')['thanks']
        self.assertFalse(card['hearted'])
        heart = f"/api/public/alpha/thanks/{card['id']}/heart"
        other,_ = self.visitor(email='other@example.com')
        self.assertEqual(other.call(heart,{})[0],404)
        self.ok(client,heart,{})
        self.ok(client,heart,{})
        self.assertTrue(self.ok(client,'/api/public/alpha/session')['thanks']['hearted'])
        wall = self.ok(self.admin,'/api/kudos')['items']
        self.assertEqual([(k['source'],k['user_id'],k['text']) for k in wall],[('thanks',agent_id,kudos_model.HEART_TEXT)])
        # The member's celebration hears about it.
        self.assertEqual([k['source'] for k in self.ok(agent,'/api/automation/alerts')['kudos']],['thanks'])
        # Once the customer writes again the card has gone, and so has its heart button.
        self.ok(client,'/api/public/alpha/messages',{'body':'มีอีกเรื่องค่ะ'})
        self.assertEqual(client.call(heart,{})[0],409)

    def test_the_customer_follows_each_step_of_their_case(self):
        client,conv = self.visitor()
        tid = self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']
        steps = lambda:[s['state'] for s in self.ok(client,f'/api/public/alpha/cases/{tid}')['journey']]
        self.assertEqual(steps(),['received'])
        self.reply(conv)
        self.assertEqual(steps(),['received','working'])
        # Waiting on a colleague is still being looked after, as far as the customer is concerned.
        self.ok(self.admin,f'/api/tickets/{tid}',{'status':'pending_internal'},'PATCH')
        self.assertEqual(steps(),['received','working'])
        self.ok(self.admin,f'/api/tickets/{tid}',{'status':'pending_customer'},'PATCH')
        self.ok(client,'/api/public/alpha/messages',{'body':'ส่งข้อมูลให้แล้วค่ะ'})
        self.ok(self.admin,f'/api/tickets/{tid}',{'status':'resolved'},'PATCH')
        journey = self.ok(client,f'/api/public/alpha/cases/{tid}')['journey']
        self.assertEqual([s['state'] for s in journey],['received','working','waiting','working','done'])
        self.assertEqual([s['at'] for s in journey],sorted(s['at'] for s in journey))

    def test_old_walls_take_hearts_after_the_upgrade(self):
        db = sqlite3.connect(':memory:')
        db.execute(kudos_model.KUDOS_TABLE.format(name='kudos').replace(",'thanks'",''))
        db.execute("INSERT INTO kudos(id,source,source_id,user_id,user_name,text,conversation_id,created_at) VALUES('k1','message','m1','u1','เอ','ดีมาก','c1','2026-01-01')")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO kudos(id,source,source_id,user_id,user_name,text,conversation_id,created_at) VALUES('k2','thanks','t1','u1','เอ','x','c1','2026-01-01')")
        kudos.widen_sources(db)
        db.execute("INSERT INTO kudos(id,source,source_id,user_id,user_name,text,conversation_id,created_at) VALUES('k2','thanks','t1','u1','เอ','x','c1','2026-01-01')")
        self.assertEqual([r[0] for r in db.execute('SELECT id FROM kudos ORDER BY id')],['k1','k2'])
        kudos.widen_sources(db)

    def test_reactions_made_with_two_emoji_take_six_after_the_upgrade(self):
        db = sqlite3.connect(':memory:')
        db.execute(reactions.REACTIONS_TABLE.format(name='message_reactions').replace(",'laugh','wow','sad','thanks'",''))
        db.execute("INSERT INTO message_reactions VALUES('m1','c1','heart','2026-01-01')")
        reactions.widen(db)
        db.execute("INSERT INTO message_reactions VALUES('m2','c1','sad','2026-01-01')")
        self.assertEqual(db.execute('SELECT reaction FROM message_reactions ORDER BY message_id').fetchall(),[('heart',),('sad',)])
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO message_reactions VALUES('m3','c1','angry','2026-01-01')")


if __name__=='__main__':
    unittest.main()
