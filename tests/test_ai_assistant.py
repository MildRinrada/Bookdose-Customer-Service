"""ผู้ช่วย AI (the staff's floating assistant): who may ask, what reaches the provider, and which sources survive."""
import json
import sqlite3
import unittest
from unittest.mock import patch

import test_ai
import test_app as base
from backend.extensions import openai_client as OpenAI
from backend.modules.ai import service as AI, repository as AIR

ARTICLE_TEXT = 'เปิดเมนูรายงาน แล้วเลือกดาวน์โหลดรายงานการอ่านประจำเดือน เลือกช่วงเวลาและกดส่งออก CSV'


class AIAssistantTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    create_member = base.IntegrationTests.create_member
    enable = test_ai.AITests.enable
    article = test_ai.AITests.article

    def run_job(self, answer):
        seen = []

        def provider(key, cfg, payload, mode):
            seen.append((mode,payload))
            return answer(payload),{'input_tokens':40,'output_tokens':20}
        with patch.object(OpenAI,'call_provider',side_effect=provider):
            AI.process_one(self.org)
        return seen

    def test_staff_ask_and_see_only_real_sources(self):
        self.enable(chatbot_enabled=False)
        article_id = self.article('internal')
        agent,_ = self.create_member()
        history = [{'role':'user','text':'ลูกค้าถามเรื่องรายงาน'},{'role':'assistant','text':'ถามต่อได้เลย'}]
        job = self.ok(agent,'/api/ai/assistant',{'question':'ดาวน์โหลดรายงานการอ่านยังไง ลูกค้า someone@example.com ถามมา',
                                                 'history':history})['id']
        seen = self.run_job(lambda payload:{'answer':'เปิดเมนูรายงาน แล้วกดส่งออก CSV','citations':[
            {'article_id':payload['articles'][0]['id'],'quote':ARTICLE_TEXT[:40]},
            {'article_id':payload['articles'][0]['id'],'quote':'ข้อความที่ไม่มีอยู่ในบทความนี้เลยจริงๆ'},
            {'article_id':'0'*32,'quote':ARTICLE_TEXT[:40]}]})
        mode,payload = seen[0]
        self.assertEqual(mode,'ask');self.assertEqual(payload['asked_by'],'agent')
        self.assertEqual(payload['articles'][0]['id'],article_id);self.assertEqual(len(payload['history']),2)
        self.assertNotIn('someone@example.com',json.dumps(payload,ensure_ascii=False))
        result = self.ok(agent,'/api/ai/jobs/'+job)
        self.assertEqual(result['status'],'done');self.assertEqual(result['result']['answer'],'เปิดเมนูรายงาน แล้วกดส่งออก CSV')
        self.assertEqual([c['article_id'] for c in result['result']['citations']],[article_id])
        # Another member cannot read it; the owner can ask too.
        other,_ = self.create_member(email='other.agent@example.com')
        self.assertEqual(other.call('/api/ai/jobs/'+job)[0],404)
        self.ok(self.admin,'/api/ai/assistant',{'question':'สรุปงานวันนี้ให้หน่อย'})

    def test_assistant_needs_ai_for_staff_and_a_question(self):
        self.assertNotEqual(self.admin.call('/api/ai/assistant',{'question':'สวัสดี'})[0],201)
        self.enable(drafts_enabled=False,chatbot_enabled=False)
        self.assertNotEqual(self.admin.call('/api/ai/assistant',{'question':'สวัสดี'})[0],201)
        self.enable(chatbot_enabled=False)
        for body in ({'question':''},{'question':'x'*2001},{'question':'ok','history':[{'role':'system','text':'x'}]}):
            self.assertEqual(self.admin.call('/api/ai/assistant',body)[0],400,body)
        # A provider answer without text fails the job instead of showing an empty reply.
        job = self.ok(self.admin,'/api/ai/assistant',{'question':'สวัสดี'})['id']
        self.run_job(lambda payload:{'answer':'  ','citations':[]})
        self.assertEqual(self.ok(self.admin,'/api/ai/jobs/'+job)['status'],'failed')

    def test_old_job_tables_keep_their_payloads(self):
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE conversations (id TEXT PRIMARY KEY)')
        db.execute('CREATE TABLE messages (id TEXT PRIMARY KEY)')
        db.execute('''CREATE TABLE ai_jobs (id TEXT PRIMARY KEY, conversation_id TEXT, trigger_id TEXT, requested_by TEXT,
            mode TEXT NOT NULL CHECK(mode IN ('draft','bot','test','article','brief')),
            status TEXT NOT NULL CHECK(status IN ('pending','running','done','failed','cancelled')),
            result TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '', lease TEXT, config_version TEXT NOT NULL,
            input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}')''')
        db.execute('''INSERT INTO ai_jobs(id,mode,status,config_version,created_at,updated_at,payload)
                      VALUES('brief1','brief','done','0','t','t','{"questions_today":["a"]}')''')
        db.commit()
        AIR.widen_jobs(db);AIR.widen_jobs(db)
        self.assertEqual(db.execute('SELECT id,payload FROM ai_jobs').fetchall(),[('brief1','{"questions_today":["a"]}')])
        db.execute("INSERT INTO ai_jobs(id,mode,status,config_version,created_at,updated_at) VALUES('q','ask','pending','0','t','t')")


if __name__=='__main__':
    unittest.main()
