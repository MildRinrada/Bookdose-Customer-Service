"""The overview beyond the numbers: รับงานถัดไป (the one case to open now), วันนี้ของฉัน, the owner's ตั้งค่าองค์กรให้ครบ,
the chatbot's results, the questions no article answers (with an AI article draft from them) and today's AI summary.
The AI provider is mocked; nothing leaves the machine."""
import datetime as dt
import sqlite3
import unittest
from unittest.mock import patch

import test_app as base
from test_app import D
from backend.extensions import openai_client as OpenAI
from backend.modules.ai import insights, repository as AIR, service as AI
from backend.modules.platform import health
from backend.utils.dates import iso, utc_now
from backend.utils.security import uid

FAKE_KEY = 'sk-unit-test-not-a-real-key-0123456789'
NEXT = '/api/tickets/next'
OVERVIEW = '/api/automation/overview?tz=-420'


def hours(n):
    return iso(utc_now()+dt.timedelta(hours=n))


class DashboardExtrasTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    create_member = base.IntegrationTests.create_member
    customer = base.IntegrationTests.customer
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD

    def visitor(self, body, email='visitor@example.com'):
        return base.IntegrationTests.visitor(self,'alpha',email,'สอบถาม',body)

    def sql(self, statement, params=()):
        with D.tenant(self.org) as db:
            db.execute(statement,params)
            db.commit()

    def case(self, body='เปิดหนังสือไม่ได้'):
        """A new case of the admin's team from a customer's conversation; (ticket id, conversation id)."""
        _,conv = self.visitor(body)
        return self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id'],conv

    def test_next_task_opens_the_most_urgent_case_then_takes_the_oldest_waiting_one(self):
        agent,agent_id = self.create_member()
        self.sql("UPDATE tickets SET status='closed'")
        self.assertEqual(self.ok(agent,NEXT,{}),{'ticket':None,'reason':'none','taken':False})
        # Nobody's case waiting in the team: it becomes the agent's.
        old,_ = self.case()
        self.sql('UPDATE tickets SET assignee_id=NULL,team_id=?,created_at=?,first_response_due_at=?,resolution_due_at=? WHERE id=?',
                 (self.team,hours(-5),hours(48),hours(72),old))
        taken = self.ok(agent,NEXT,{})
        self.assertEqual((taken['ticket']['id'],taken['reason'],taken['taken']),(old,'unassigned',True))
        self.assertEqual(self.ok(self.admin,f'/api/tickets/{old}')['ticket']['assignee_id'],agent_id)
        self.assertIn('ticket.updated',[e['action'] for e in self.ok(self.admin,f'/api/tickets/{old}')['events']])
        # Nothing urgent and nobody waiting: their own case is still the one to open.
        self.assertEqual(self.ok(agent,NEXT,{})['reason'],'mine')
        # Due within two hours, then past its SLA - the one that ends first wins; waiting for the customer is not their move.
        self.sql('UPDATE tickets SET resolution_due_at=? WHERE id=?',(hours(1),old))
        self.assertEqual(self.ok(agent,NEXT,{})['reason'],'due_soon')
        late,_ = self.case('ขอใบเสร็จย้อนหลัง')
        self.sql('UPDATE tickets SET assignee_id=?,first_response_due_at=?,resolution_due_at=? WHERE id=?',(agent_id,hours(-1),hours(24),late))
        found = self.ok(agent,NEXT,{})
        self.assertEqual((found['ticket']['id'],found['reason']),(late,'overdue'))
        self.sql("UPDATE tickets SET status='pending_customer' WHERE id=?",(late,))
        self.assertEqual(self.ok(agent,NEXT,{})['ticket']['id'],old)
        # Another team's waiting case is not theirs to take.
        other = self.ok(self.admin,'/api/teams',{'name':'ทีมเทคนิค'})['id']
        self.sql("UPDATE tickets SET status='closed'")
        waiting,_ = self.case()
        self.sql('UPDATE tickets SET assignee_id=NULL,team_id=? WHERE id=?',(other,waiting))
        self.assertEqual(self.ok(agent,NEXT,{})['ticket'],None)

    def test_my_day_for_everyone_and_the_owner_cards_for_owners_only(self):
        agent,_ = self.create_member()
        _,conv = self.visitor('เปิดหนังสือไม่ได้')
        self.ok(agent,f'/api/conversations/{conv}/messages',{'kind':'reply','body':'ลองออกจากระบบแล้วเข้าใหม่ค่ะ'})
        mine = self.ok(agent,OVERVIEW)
        self.assertEqual(mine['today']['replies'],1)
        self.assertEqual((mine['manager'],mine['setup'],mine['insights']),(None,None,None))
        owner = self.ok(self.admin,OVERVIEW)
        steps = {s['key']:s for s in owner['setup']['steps']}
        self.assertEqual(set(steps),{'channels','agents','articles','rules','ai'})
        self.assertTrue(steps['agents']['done'])
        self.assertFalse(steps['channels']['done'])
        self.assertFalse(steps['ai']['done'])
        self.assertEqual(steps['channels']['action']['href'],'/settings?tab=connections')
        self.assertEqual(owner['setup']['problems'],[])
        # A channel whose replies fail is the owner's to fix.
        broken = {'kind':'line','name':'LINE','enabled':True,'error':'','status':'error','stuck':False,'failed':3,'unknown':0,
                  'waiting':0,'last_failure':'token หมดอายุ','last_failure_at':None,'last_received':None,'oldest_waiting':None}
        with patch.object(health,'tenant_channels',return_value=[broken]):
            problem = self.ok(self.admin,OVERVIEW)['setup']['problems'][0]
        self.assertEqual((problem['level'],problem['title'],problem['detail']),('critical','LINE ส่งข้อความไม่สำเร็จ 3 ข้อความ','token หมดอายุ'))

    def test_the_questions_no_article_answers_are_grouped(self):
        for body in ('เครื่องอ่านอีบุ๊กเชื่อมต่อบลูทูธไม่ได้ครับ','เครื่องอ่านอีบุ๊กเชื่อมต่อบลูทูธไม่ได้ ทำอย่างไรดี','ดาวน์โหลดรายงานการอ่านประจำเดือนอย่างไร'):
            self.visitor(body)
        self.visitor('ขอคุยกับเจ้าหน้าที่')
        self.ok(self.admin,'/api/articles',{'title':'วิธีดาวน์โหลดรายงานการอ่าน','category':'รายงาน','visibility':'public',
            'body':'เปิดเมนูรายงาน แล้วเลือกดาวน์โหลดรายงานการอ่านประจำเดือน เลือกช่วงเวลาและกดส่งออก CSV'})
        gaps = self.ok(self.admin,OVERVIEW)['insights']['gaps']
        bluetooth = next(g for g in gaps['groups'] if 'บลูทูธ' in g['label'])
        self.assertEqual(bluetooth['count'],2)
        self.assertEqual(len(bluetooth['conversations']),2)
        labels = ' '.join(g['label']+' '.join(g['examples']) for g in gaps['groups'])
        self.assertNotIn('รายงานการอ่าน',labels)
        self.assertNotIn('ขอคุยกับเจ้าหน้าที่',labels)

    def test_how_the_chatbot_did(self):
        _,answered = self.visitor('เปิดหนังสือไม่ได้')
        _,passed = self.visitor('ขอเปลี่ยนอีเมลบัญชี')
        with D.tenant(self.org) as db:
            AIR.set_bot(db,answered)
            message = uid()
            db.execute("INSERT INTO messages(id,conversation_id,author_id,author_name,kind,body,created_at) VALUES(?,?,NULL,'Bookdose AI','reply','ลองใหม่ค่ะ',?)",
                       (message,answered,hours(0)))
            AIR.insert_message_meta(db,message,'ai','[]')
            AIR.set_human(db,passed,'customer')
            db.commit()
        insights.forget(self.org)
        bot = self.ok(self.admin,OVERVIEW)['insights']['bot']
        self.assertEqual((bot['resolved'],bot['handed_off'],bot['answers']),(1,1,1))
        self.assertEqual(bot['reasons'],[{'reason':'customer','count':1}])

    def enable_ai(self, drafts=True):
        self.ok(self.admin,'/api/ai/settings',{'api_key':FAKE_KEY,'drafts_enabled':drafts,'chatbot_enabled':False},'PATCH')

    def run_job(self, answer):
        seen = []

        def provider(key, cfg, payload, mode):
            seen.append((mode,payload))
            return answer,{'input_tokens':50,'output_tokens':40}
        with patch.object(OpenAI,'call_provider',side_effect=provider):
            AI.process_one(self.org)
        return seen

    def test_an_article_drafted_from_a_group_of_questions(self):
        for body in ('เครื่องอ่านอีบุ๊กเชื่อมต่อบลูทูธไม่ได้ ติดต่อกลับ someone@example.com','เครื่องอ่านอีบุ๊กเชื่อมต่อบลูทูธไม่ได้ โทร 081-234-5678'):
            self.visitor(body)
        group = next(g for g in self.ok(self.admin,OVERVIEW)['insights']['gaps']['groups'] if 'บลูทูธ' in g['label'])
        body = {'conversation_ids':group['conversations']}
        # AI must be on (and the key set); only the organization's owners ask.
        self.assertEqual(self.admin.call('/api/ai/insights/article',body)[0],400)
        self.enable_ai()
        agent,_ = self.create_member()
        self.assertEqual(agent.call('/api/ai/insights/article',body)[0],403)
        self.assertEqual(self.admin.call('/api/ai/insights/article',{'conversation_ids':['x']})[0],400)
        job = self.ok(self.admin,'/api/ai/insights/article',body)['id']
        self.assertEqual(self.ok(self.admin,'/api/ai/insights/article',body)['id'],job)       # one at a time
        seen = self.run_job({'title':'เชื่อมต่อบลูทูธไม่ได้','category':'อุปกรณ์','body':'## วิธีแก้\n1. [ระบุขั้นตอน]'})
        mode,payload = seen[0]
        self.assertEqual(mode,'article')
        sent = ' '.join(payload['questions'])
        self.assertIn('บลูทูธ',sent)
        self.assertNotIn('someone@example.com',sent)
        self.assertNotIn('081-234-5678',sent)
        self.assertIn('[อีเมล]',sent)
        result = self.ok(self.admin,f'/api/ai/jobs/{job}')
        self.assertEqual((result['status'],result['result']['title']),('done','เชื่อมต่อบลูทูธไม่ได้'))
        # An answer that is not an article is refused.
        again = self.ok(self.admin,'/api/ai/insights/article',body)['id']
        self.run_job({'answer':'x'})
        self.assertEqual(self.ok(self.admin,f'/api/ai/jobs/{again}')['status'],'failed')

    def test_todays_summary_only_when_asked(self):
        self.visitor('เปิดหนังสือไม่ได้ ติดต่อ someone@example.com')
        self.assertIsNone(self.ok(self.admin,OVERVIEW)['insights']['brief'])
        self.enable_ai()
        job = self.ok(self.admin,'/api/ai/insights/brief?tz=-420',{})['id']
        self.assertEqual(self.ok(self.admin,OVERVIEW)['insights']['brief']['status'],'pending')
        seen = self.run_job({'lines':['วันนี้เรื่องเข้ามา 1 เรื่อง','ยังไม่มีเคสเกิน SLA']})
        mode,payload = seen[0]
        self.assertEqual(mode,'brief')
        self.assertGreaterEqual(sum(payload['conversations_today_by_channel'].values()),1)
        self.assertNotIn('someone@example.com',str(payload))
        brief = self.ok(self.admin,OVERVIEW)['insights']['brief']
        self.assertEqual((brief['id'],brief['status'],brief['lines'][0]),(job,'done','วันนี้เรื่องเข้ามา 1 เรื่อง'))
        agent,_ = self.create_member()
        self.assertEqual(agent.call('/api/ai/insights/brief',{})[0],403)

    def test_old_databases_get_the_wider_job_modes_and_keep_their_jobs(self):
        db = sqlite3.connect(':memory:')
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('CREATE TABLE conversations (id TEXT PRIMARY KEY)')
        db.execute('CREATE TABLE messages (id TEXT PRIMARY KEY)')
        db.execute('''CREATE TABLE ai_jobs (id TEXT PRIMARY KEY, conversation_id TEXT, trigger_id TEXT, requested_by TEXT,
            mode TEXT NOT NULL CHECK(mode IN ('draft','bot','test')),
            status TEXT NOT NULL CHECK(status IN ('pending','running','done','failed','cancelled')),
            result TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '', lease TEXT, config_version TEXT NOT NULL,
            input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)''')
        db.execute("INSERT INTO ai_jobs(id,mode,status,config_version,created_at,updated_at) VALUES('old','draft','done','0','t','t')")
        db.commit()
        AIR.widen_jobs(db)
        AIR.widen_jobs(db)
        self.assertEqual(db.execute('SELECT id,mode,payload FROM ai_jobs').fetchall(),[('old','draft','{}')])
        db.execute("INSERT INTO ai_jobs(id,mode,status,config_version,created_at,updated_at) VALUES('new','brief','pending','0','t','t')")


if __name__=='__main__':
    unittest.main()
