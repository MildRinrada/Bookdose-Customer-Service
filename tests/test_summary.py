"""สรุปบทสนทนา: a conversation in a few points for whoever takes it over - and never the whole of it sent to the AI
twice. What is held to: a kept summary answers again without a call; an update sends the kept summary and only the
messages since; what is sent is capped; and a case given to someone else has its summary written ahead."""
import json
import unittest
from unittest.mock import patch

import test_app as base
from backend.database import db as D
from backend.extensions import openai_client as OpenAI
from backend.modules.ai import service as AI, summary as S

FAKE_KEY = 'sk-unit-test-not-a-real-key-0123456789'
POINTS = {'wants':['ต้องการดาวน์โหลดรายงานการอ่าน'],'tried':['ทีมส่งลิงก์คู่มือให้แล้ว'],'pending':['รอลูกค้าลองอีกครั้ง']}


class SummaryTests(unittest.TestCase):
    def enable(self):
        self.ok(self.admin,'/api/ai/settings',{'api_key':FAKE_KEY,'drafts_enabled':True,'chatbot_enabled':False,'mood_enabled':False},'PATCH')

    def summary_jobs(self):
        with D.tenant(self.org) as db:
            return [dict(r) for r in db.execute("SELECT * FROM ai_jobs WHERE mode='summary' ORDER BY created_at,rowid")]

    def run_summary(self, result=POINTS):
        sent = []

        def provider(key, cfg, payload, mode):
            sent.append((mode,payload))
            return result,{'input_tokens':100,'output_tokens':40}
        with patch.object(OpenAI,'call_provider',side_effect=provider):
            AI.process_one(self.org)
        return sent

    def test_the_summary_is_kept_and_only_new_messages_are_sent_again(self):
        self.enable()
        visitor,conversation = self.visitor(body='ดาวน์โหลดรายงานการอ่านไม่ได้ค่ะ')
        path = f'/api/conversations/{conversation}/summary'
        self.assertIsNone(self.ok(self.admin,path)['summary'])
        self.assertTrue(self.ok(self.admin,path,{})['working'])
        sent = self.run_summary()
        self.assertEqual(sent[0][0],'summary')
        self.assertNotIn('previous_summary',sent[0][1])
        state = self.ok(self.admin,path)
        self.assertEqual((state['summary']['wants'],state['new_messages'],state['working']),(POINTS['wants'],0,False))
        # Nothing new written: asked again, the kept summary is the answer and no job is queued.
        again = self.ok(self.admin,path,{})
        self.assertEqual((again['working'],len(self.summary_jobs())),(False,1))
        # One new message: the update carries the kept summary and that one message only.
        self.ok(visitor,'/api/public/alpha/messages',{'body':'ลองแล้วยังไม่ได้ค่ะ ขึ้นว่า Error 403'})
        self.assertEqual(self.ok(self.admin,path)['new_messages'],1)
        self.ok(self.admin,path,{})
        sent = self.run_summary({**POINTS,'pending':['ลูกค้าเจอ Error 403 ต้องตรวจสิทธิ์']})
        self.assertEqual(sent[0][1]['previous_summary'],POINTS)
        self.assertEqual([m['text'] for m in sent[0][1]['messages']],['ลองแล้วยังไม่ได้ค่ะ ขึ้นว่า Error 403'])
        self.assertEqual(self.ok(self.admin,path)['summary']['pending'],['ลูกค้าเจอ Error 403 ต้องตรวจสิทธิ์'])

    def test_what_is_sent_is_capped(self):
        _,conversation = self.visitor(body='x'*5000)
        for n in range(S.MAX_MESSAGES+10):
            self.ok(self.admin,f'/api/conversations/{conversation}/messages',{'kind':'note','body':f'บันทึก {n} '+'ย'*400})
        with D.tenant(self.org) as db:
            body,found = S.payload(db,conversation)
        self.assertEqual(found,S.MAX_MESSAGES+11)
        self.assertLessEqual(len(body['messages']),S.MAX_MESSAGES)
        self.assertLessEqual(sum(len(m['text']) for m in body['messages']),S.MAX_TOTAL_CHARS)
        self.assertEqual(body['left_out'],found-len(body['messages']))
        # The newest are the ones kept, and the notes are marked as the team's own.
        self.assertTrue(body['messages'][-1]['text'].startswith(f'บันทึก {S.MAX_MESSAGES+9} '))
        self.assertEqual(body['messages'][-1]['from'],'internal_note')
        self.assertNotIn('visitor@example.com',json.dumps(body,ensure_ascii=False))

    def test_a_case_given_to_someone_else_has_its_summary_written_ahead(self):
        self.enable()
        _,conversation = self.visitor(body='เปิดหนังสือไม่ได้ค่ะ')
        for n in range(S.AHEAD_MIN_MESSAGES):
            self.ok(self.admin,f'/api/conversations/{conversation}/messages',{'kind':'note','body':f'ตรวจแล้วรอบที่ {n}'})
        ticket = self.ok(self.admin,f'/api/conversations/{conversation}/ticket',{})['id']
        _,colleague = self.create_member(role='admin',email='colleague@example.com')
        self.ok(self.admin,f'/api/tickets/{ticket}',{'assignee_id':colleague},'PATCH')
        jobs = self.summary_jobs()
        self.assertEqual(len(jobs),1)
        self.assertIsNone(jobs[0]['requested_by'])   # nobody asked: written ahead

    def test_without_ai_for_staff_help_it_is_refused(self):
        _,conversation = self.visitor(body='เปิดหนังสือไม่ได้ค่ะ')
        status,_ = self.admin.call(f'/api/conversations/{conversation}/summary',{})
        self.assertGreaterEqual(status,400)
        self.assertEqual(self.summary_jobs(),[])


# The setUp, the sign-ins and the helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(SummaryTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
