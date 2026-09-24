"""How the customer feels, and the queue that follows it: an upset customer's case is not left behind the calm ones
that only arrived earlier. The words' reading is checked on its own; then a customer's message through the support
page, the lists that show it, รับงานถัดไป that puts it first, and the AI's reading that replaces the words'."""
import unittest
from unittest.mock import patch

import test_app as base
from backend.database import db as D
from backend.extensions import openai_client as OpenAI
from backend.modules.ai import service as AI
from backend.modules.ai.mood import ANGRY, CALM, UPSET, by_words

FAKE_KEY = 'sk-unit-test-not-a-real-key-0123456789'


class WordsTests(unittest.TestCase):
    def test_a_calm_question_is_calm(self):
        self.assertEqual(by_words('สอบถามวิธีเปลี่ยนรหัสผ่านค่ะ'),(CALM,False,''))

    def test_waiting_and_asking_again_reads_as_displeased(self):
        level,urgent,reason = by_words('รอมา 3 วันแล้ว ทำไมยังไม่ได้รับของ')
        self.assertEqual((level,urgent),(UPSET,False))
        self.assertIn('รอมา',reason)

    def test_threats_and_insults_read_as_angry_and_each_word_is_named_once(self):
        level,_,reason = by_words('ห่วยแตก จะแจ้ง สคบ.!!!')
        self.assertEqual(level,ANGRY)
        self.assertIn('"ห่วยแตก"',reason)
        self.assertNotIn('"ห่วย"',reason)

    def test_urgency_is_its_own_flag(self):
        self.assertEqual(by_words('ด่วนมาก ระบบล่ม เข้าไม่ได้เลย')[:2],(CALM,True))

    def test_a_negated_word_is_not_counted(self):
        self.assertEqual(by_words('ไม่ด่วนค่ะ ไม่ต้องรีบ')[:2],(CALM,False))
        self.assertEqual(by_words('ไม่ได้โกรธนะคะ แค่ถาม')[0],CALM)


class MoodQueueTests(unittest.TestCase):
    def conversation(self, body, email):
        """A customer's support-page conversation with a case opened on it; (conversation id, case id)."""
        _,conversation = base.IntegrationTests.visitor(self,'alpha',email,'ปัญหาการใช้งาน',body)
        return conversation,self.ok(self.admin,f'/api/conversations/{conversation}/ticket',{})['id']

    def listed(self, conversation):
        return next(c for c in self.ok(self.admin,'/api/conversations')['conversations'] if c['id']==conversation)

    def test_an_angry_message_is_read_shown_and_put_first_in_the_queue(self):
        with D.tenant(self.org) as db:   # the demo data's own cases out of the way: this queue is the two below
            db.execute("UPDATE tickets SET status='closed'")
            db.commit()
        calm,calm_case = self.conversation('สอบถามวิธีดาวน์โหลดรายงานค่ะ','calm@example.com')
        angry,angry_case = self.conversation('รอมาสามวันแล้ว ห่วยแตกมาก จะแจ้ง สคบ.!!!','angry@example.com')
        mood = self.listed(angry)
        self.assertEqual((mood['mood_level'],mood['mood_source']),(ANGRY,'words'))
        self.assertIn('สคบ',mood['mood_reason'])
        self.assertEqual(self.listed(calm)['mood_level'],CALM)
        case = next(t for t in self.ok(self.admin,'/api/tickets')['tickets'] if t['id']==angry_case)
        self.assertEqual(case['mood_level'],ANGRY)
        self.assertEqual(self.ok(self.admin,f'/api/conversations/{angry}')['conversation']['mood']['level'],ANGRY)
        # รับงานถัดไป: the angry customer's case, although the calm one has waited longer.
        with D.tenant(self.org) as db:
            team = db.execute('SELECT team_id FROM tickets WHERE id=?',(calm_case,)).fetchone()[0]
            db.execute("UPDATE tickets SET assignee_id=NULL,team_id=?,created_at='2026-01-01T00:00:00+00:00' WHERE id=?",(team,calm_case))
            db.execute('UPDATE tickets SET assignee_id=NULL,team_id=? WHERE id=?',(team,angry_case))
            db.commit()
        agent,_ = self.create_member(role='agent',email='queue.agent@example.com')
        with D.control() as cd:
            cd.execute('UPDATE memberships SET team_id=? WHERE user_id=(SELECT id FROM users WHERE email=?)',(team,'queue.agent@example.com'))
            cd.commit()
        picked = self.ok(agent,'/api/tickets/next',{})
        self.assertEqual((picked['ticket']['id'],picked['reason'],picked['taken']),(angry_case,'upset',True))

    def test_the_ai_reading_replaces_the_words_when_the_organization_has_an_ai(self):
        self.ok(self.admin,'/api/ai/settings',{'api_key':FAKE_KEY,'drafts_enabled':False,'chatbot_enabled':False},'PATCH')
        # Polite words, a customer out of patience: the words miss it, the AI does not.
        conversation,_ = self.conversation('เรียนทีมงาน นี่เป็นครั้งที่สามที่ติดต่อมาเรื่องเดิม หวังว่าครั้งนี้จะได้คำตอบนะคะ','polite@example.com')
        self.assertEqual(self.listed(conversation)['mood_level'],CALM)
        seen = {}

        def provider(key, cfg, payload, mode):
            seen.update(mode=mode,payload=payload)
            return {'level':2,'urgent':False,'reason':'ติดต่อเรื่องเดิมเป็นครั้งที่สาม'},{'input_tokens':80,'output_tokens':20}
        with patch.object(OpenAI,'call_provider',side_effect=provider):
            AI.process_one(self.org)
        self.assertEqual(seen['mode'],'mood')
        # Only the words of the messages go to the AI: no names or contact details.
        self.assertEqual(set(seen['payload']),{'messages'})
        self.assertNotIn('polite@example.com',str(seen['payload']))
        mood = self.listed(conversation)
        self.assertEqual((mood['mood_level'],mood['mood_source'],mood['mood_reason']),(ANGRY,'ai','ติดต่อเรื่องเดิมเป็นครั้งที่สาม'))

    def test_the_owner_can_keep_the_ai_out_of_it_and_the_words_still_read(self):
        settings = self.ok(self.admin,'/api/ai/settings',{'api_key':FAKE_KEY,'drafts_enabled':False,'chatbot_enabled':False,'mood_enabled':False},'PATCH')
        self.assertFalse(settings['mood_enabled'])
        conversation,ticket = self.conversation('ช้ามาก รอนานแล้วค่ะ','switched.off@example.com')
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM ai_jobs WHERE mode='mood'").fetchone()[0],0)
        self.assertEqual((self.listed(conversation)['mood_level'],self.listed(conversation)['mood_source']),(UPSET,'words'))
        # The case page carries each conversation's reading.
        detail = self.ok(self.admin,f'/api/tickets/{ticket}')
        self.assertEqual(detail['conversations'][0]['mood']['level'],UPSET)
        # And it switches back on.
        self.ok(self.admin,'/api/ai/settings',{'mood_enabled':True},'PATCH')
        self.assertTrue(self.ok(self.admin,'/api/ai/settings')['mood_enabled'])

    def test_without_an_ai_no_job_is_queued(self):
        self.conversation('ห่วยมาก ช้ามาก','nokey@example.com')
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM ai_jobs WHERE mode='mood'").fetchone()[0],0)


# The setUp, the sign-ins and the helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(MoodQueueTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
