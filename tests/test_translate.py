"""แปลภาษาอัตโนมัติสองทาง: a customer writes English, the team reads Thai; the team answers in Thai, the customer gets
English - and never the Thai while it is being translated, and never nothing when the translation does not come."""
import unittest
from unittest.mock import patch

import test_app as base
from backend.database import db as D
from backend.extensions import openai_client as OpenAI
from backend.modules.ai import service as AI, translate

FAKE_KEY = 'sk-unit-test-not-a-real-key-0123456789'


class LettersTests(unittest.TestCase):
    def test_what_counts_as_thai(self):
        self.assertGreater(translate.thai_share('สั่งซื้อ iPhone 15 แล้วยังไม่ได้รับค่ะ'),translate.THAI_SHARE)
        self.assertEqual(translate.thai_share('I still have not received my order'),0)
        # Too few letters to tell: an "ok", a number, a link.
        self.assertIsNone(translate.thai_share('555'))
        self.assertIsNone(translate.thai_share('https://example.com/a/b'))


class TranslateTests(unittest.TestCase):
    def switch_on(self, **extra):
        return self.ok(self.admin,'/api/ai/settings',{'api_key':FAKE_KEY,'drafts_enabled':False,'chatbot_enabled':False,
                                                     'mood_enabled':False,'translate_enabled':True,**extra},'PATCH')

    def run_jobs(self, answer):
        """Run the queue with a provider that answers translations with answer(payload); returns what it was sent."""
        sent = []

        def provider(key, cfg, payload, mode):
            sent.append((mode,payload))
            return answer(payload),{'input_tokens':30,'output_tokens':20}
        with patch.object(OpenAI,'call_provider',side_effect=provider):
            while AI.process_one(self.org):
                pass
        return sent

    def staff_messages(self, conversation):
        return self.ok(self.admin,f'/api/conversations/{conversation}')['messages']

    def test_both_ways(self):
        self.assertTrue(self.switch_on()['translate_enabled'])
        visitor,conversation = self.visitor('alpha','foreign@example.com','Order','I still have not received my order #A-1042')
        sent = self.run_jobs(lambda p: {'language':'en','text':'ฉันยังไม่ได้รับคำสั่งซื้อ #A-1042'})
        # Only the text goes to the AI: no name or email.
        self.assertEqual(sent,[('translate',{'direction':'to_thai','text':'I still have not received my order #A-1042'})])
        first = self.staff_messages(conversation)[-1]
        self.assertEqual(first['body'],'I still have not received my order #A-1042')   # the customer's own words stay
        self.assertEqual((first['translation']['thai'],first['translation']['language']),('ฉันยังไม่ได้รับคำสั่งซื้อ #A-1042','en'))
        detail = self.ok(self.admin,f'/api/conversations/{conversation}')['conversation']
        self.assertEqual(detail['translation'],{'enabled':True,'language':'en'})

        # The team answers in Thai: held from the customer until it is translated.
        self.ok(self.admin,f'/api/conversations/{conversation}/messages',{'kind':'reply','body':'ขออภัยค่ะ กำลังตรวจสอบคำสั่งซื้อให้นะคะ'})
        self.assertNotIn('กำลังตรวจสอบ',str(self.ok(visitor,'/api/public/alpha/session')['messages']))
        self.assertEqual(self.staff_messages(conversation)[-1]['translation']['status'],'pending')
        sent = self.run_jobs(lambda p: {'language':'en','text':'Sorry, we are checking your order now.'})
        self.assertEqual(sent[0][1]['direction'],'from_thai')
        self.assertEqual(sent[0][1]['target_language'],'en')
        public = self.ok(visitor,'/api/public/alpha/session')['messages']
        self.assertEqual(public[-1]['body'],'Sorry, we are checking your order now.')
        self.assertNotIn('translation',public[-1])
        reply = self.staff_messages(conversation)[-1]
        self.assertEqual((reply['translation']['thai'],reply['translation']['status']),('ขออภัยค่ะ กำลังตรวจสอบคำสั่งซื้อให้นะคะ','done'))

        # Written in English already, or asked to go as typed: out at once, nothing queued.
        self.ok(self.admin,f'/api/conversations/{conversation}/messages',{'kind':'reply','body':'Your tracking number is TH123.'})
        self.ok(self.admin,f'/api/conversations/{conversation}/messages',{'kind':'reply','body':'ขอบคุณค่ะ','translate':False})
        self.assertEqual([m['body'] for m in self.ok(visitor,'/api/public/alpha/session')['messages'][-2:]],
                         ['Your tracking number is TH123.','ขอบคุณค่ะ'])
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM ai_jobs WHERE mode='translate'").fetchone()[0],2)
            # Translation is background work: no activity-log row per message.
            self.assertEqual(db.execute("SELECT COUNT(*) FROM audit_logs WHERE action='ai.queued' AND detail='translate'").fetchone()[0],0)

        # The customer switches to Thai: replies stay Thai from then on.
        self.ok(visitor,'/api/public/alpha/messages',{'body':'พูดไทยได้ค่ะ'})
        self.assertEqual(self.ok(self.admin,f'/api/conversations/{conversation}')['conversation']['translation']['language'],'th')

    def test_a_failed_translation_still_sends_the_reply_as_written(self):
        self.switch_on()
        visitor,conversation = self.visitor('alpha','fails@example.com','Help','Can you help me please?')
        self.run_jobs(lambda p: {'language':'en','text':'ช่วยหน่อยได้ไหม'})
        self.ok(self.admin,f'/api/conversations/{conversation}/messages',{'kind':'reply','body':'ได้เลยค่ะ'})
        self.run_jobs(lambda p: {'language':'en','text':''})   # an empty answer does not pass
        self.assertEqual(self.ok(visitor,'/api/public/alpha/session')['messages'][-1]['body'],'ได้เลยค่ะ')
        self.assertEqual(self.staff_messages(conversation)[-1]['translation']['status'],'failed')

    def test_a_translation_that_never_comes_releases_the_reply(self):
        self.switch_on()
        visitor,conversation = self.visitor('alpha','late@example.com','Help','Where is my refund?')
        self.run_jobs(lambda p: {'language':'en','text':'เงินคืนของฉันอยู่ไหน'})
        self.ok(self.admin,f'/api/conversations/{conversation}/messages',{'kind':'reply','body':'กำลังดำเนินการค่ะ'})
        # The owner changes the AI settings meanwhile: the queued translation is cancelled and the reply goes as written.
        self.ok(self.admin,'/api/ai/settings',{'daily_limit':50},'PATCH')
        self.assertEqual(self.ok(visitor,'/api/public/alpha/session')['messages'][-1]['body'],'กำลังดำเนินการค่ะ')

    def test_switched_off_nothing_is_translated(self):
        self.ok(self.admin,'/api/ai/settings',{'api_key':FAKE_KEY,'drafts_enabled':False,'chatbot_enabled':False},'PATCH')
        self.assertFalse(self.ok(self.admin,'/api/ai/settings')['translate_enabled'])
        visitor,conversation = self.visitor('alpha','off@example.com','Order','Where is my order?')
        self.ok(self.admin,f'/api/conversations/{conversation}/messages',{'kind':'reply','body':'กำลังตรวจสอบค่ะ'})
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM ai_jobs WHERE mode='translate'").fetchone()[0],0)
        self.assertEqual(self.ok(visitor,'/api/public/alpha/session')['messages'][-1]['body'],'กำลังตรวจสอบค่ะ')


# The setUp, the sign-ins and the helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(TranslateTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
