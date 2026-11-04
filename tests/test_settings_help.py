"""ถาม AI on the settings pages (ai/settings_help.py, ai/settings_guides.py): a question asked from one carries that page's
guide and what it holds now, never a secret; without an AI the guide itself is what the หัวหน้าทีม reads."""
import json
import unittest

import test_ai as ai_tests
import test_channels as channel_tests
from backend.extensions import openai_client as OpenAI
from backend.modules.ai import settings_help
from backend.modules.ai.settings_guides import GUIDES
from test_app import D

HELP = '/api/ai/settings-help/'


class SettingsHelpTests(unittest.TestCase):
    setUp = ai_tests.AITests.setUp
    tearDown = ai_tests.AITests.tearDown
    ok = ai_tests.AITests.ok
    enable = ai_tests.AITests.enable
    create_member = ai_tests.AITests.create_member
    configure = channel_tests.ChannelTests.configure

    def payload_of(self, job_id):
        with D.tenant(self.org) as db:
            return json.loads(db.execute('SELECT payload FROM ai_jobs WHERE id=?',(job_id,)).fetchone()[0])

    def test_every_page_has_its_guide_and_questions(self):
        self.assertEqual(set(GUIDES),set(settings_help.SECTIONS))
        for section in settings_help.SECTIONS:
            found = self.ok(self.admin,HELP+section)
            self.assertTrue(found['title'] and found['guide'] and found['questions'],section)
            self.assertNotIn('—',found['guide']+found['reference'],section)
        self.assertEqual(self.admin.call(HELP+'profile')[0],404)
        # The settings pages are the หัวหน้าทีม's.
        agent,_ = self.create_member()
        self.assertEqual(agent.call(HELP+'line')[0],403)
        self.assertIn('settings_page',OpenAI.ASK_INSTRUCTIONS)

    def test_a_question_from_a_settings_page_carries_its_guide_and_state_and_no_secret(self):
        self.enable()
        self.configure('line')
        asked = self.ok(self.admin,'/api/ai/assistant',{'question':'ทำไม LINE ไม่เข้า','page':{'settings':'line'}})
        self.assertEqual(asked['gathered']['settings'],GUIDES['line']['title'])
        page = self.payload_of(asked['id'])['settings_page']
        self.assertEqual((page['page'],page['guide']),(GUIDES['line']['title'],GUIDES['line']['guide']))
        self.assertEqual((page['state']['on'],page['state']['credentials_set']),(True,True))
        sent = json.dumps(self.payload_of(asked['id']),ensure_ascii=False)
        for secret in ('secret-for-tests','token-for-tests'):
            self.assertNotIn(secret,sent)
        # Every page's state reads without failing, and none holds a key of the AI either.
        with D.control() as cd, D.tenant(self.org) as db:
            ctx = {'tenant_id':self.org,'role':'admin','team_id':self.team}
            for section in settings_help.SECTIONS:
                state = json.dumps(settings_help.state(cd,db,ctx,section),ensure_ascii=False)
                self.assertNotIn(ai_tests.FAKE_KEY,state,section)

    def test_only_a_settings_page_and_only_its_lead_add_a_guide(self):
        self.enable()
        plain = self.ok(self.admin,'/api/ai/assistant',{'question':'เคสไหนค้างนานที่สุด'})
        self.assertNotIn('settings_page',self.payload_of(plain['id']))
        unknown = self.ok(self.admin,'/api/ai/assistant',{'question':'อันนี้คืออะไร','page':{'settings':'profile'}})
        self.assertNotIn('settings_page',self.payload_of(unknown['id']))
        agent,_ = self.create_member()
        theirs = self.ok(agent,'/api/ai/assistant',{'question':'ตั้งค่า LINE ยังไง','page':{'settings':'line'}})
        self.assertNotIn('settings_page',self.payload_of(theirs['id']))


if __name__=='__main__':
    unittest.main()
