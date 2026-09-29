"""Three helpers of the AI for the team (ai/polish.py, ai/triage.py, ai/gather.py): a reply polished before it is sent,
the tags / priority / team proposed for a new case, and the chatbot asking for the case fields while the customer
waits for a person. Each test uses a disposable database; the provider is mocked and what it was sent is checked."""
import json
import unittest
from unittest.mock import patch

import test_ai
import test_app as base
from backend.database import db as D
from backend.extensions import openai_client as OpenAI
from backend.modules.ai import service as AI

FIELDS = '/api/settings/fields'


class AIHelperTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    create_member = base.IntegrationTests.create_member
    customer = base.IntegrationTests.customer
    customer_mail = base.IntegrationTests.customer_mail
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    mail_link = base.IntegrationTests.mail_link
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD
    enable = test_ai.AITests.enable
    article = test_ai.AITests.article
    visitor = test_ai.AITests.visitor

    def answer(self, result):
        """Run the next job with the provider answering `result`; returns what it was sent as (mode, payload)."""
        sent = []

        def provider(key, cfg, payload, mode):
            sent.append((mode,payload))
            return (result(payload) if callable(result) else result),{'input_tokens':10,'output_tokens':5}
        with patch.object(OpenAI,'call_provider',side_effect=provider):
            AI.process_one(self.org)
        return sent

    def jobs(self, mode):
        with D.tenant(self.org) as db:
            return [dict(r) for r in db.execute('SELECT * FROM ai_jobs WHERE mode=? ORDER BY created_at,rowid',(mode,))]

    # เกลาข้อความ
    def test_a_polished_reply_keeps_its_contact_details_and_never_sends_them(self):
        self.enable(chatbot_enabled=False)
        agent,_ = self.create_member()
        text = 'รบกวนติดต่อ help@example.com หรือ 081-234-5678 นะครับ'
        job = self.ok(agent,'/api/ai/polish',{'style':'polite','text':text})['id']
        sent = self.answer(lambda p:{'text':'รบกวนติดต่อที่ [[1]] หรือโทร [[2]] ได้เลยนะครับ ขอบคุณครับ'})
        self.assertEqual(sent[0][0],'polish')
        self.assertEqual(sent[0][1]['style'],'polite')
        self.assertNotIn('help@example.com',json.dumps(sent[0][1],ensure_ascii=False))
        self.assertNotIn('081-234-5678',json.dumps(sent[0][1],ensure_ascii=False))
        self.assertNotIn('_slots',sent[0][1])
        view = self.ok(agent,f'/api/ai/jobs/{job}')
        self.assertEqual(view['status'],'done')
        self.assertEqual(view['result']['text'],'รบกวนติดต่อที่ help@example.com หรือโทร 081-234-5678 ได้เลยนะครับ ขอบคุณครับ')
        # A placeholder lost (or made up) is refused rather than shown with a contact detail gone.
        job = self.ok(agent,'/api/ai/polish',{'style':'short','text':text})['id']
        self.answer({'text':'ติดต่อ [[1]] ครับ'})
        self.assertEqual(self.ok(agent,f'/api/ai/jobs/{job}')['status'],'failed')
        # Somebody else's polish is not theirs to read.
        other,_ = self.create_member(email='other@example.com')
        self.assertEqual(other.call(f'/api/ai/jobs/{job}')[0],404)

    def test_asking_again_replaces_the_waiting_polish_and_it_needs_staff_help_on(self):
        agent,_ = self.create_member()
        self.enable(drafts_enabled=False,chatbot_enabled=False)
        self.assertGreaterEqual(agent.call('/api/ai/polish',{'style':'fix','text':'สวัสดีครับบ'})[0],400)
        self.enable(chatbot_enabled=False)
        for bad in ({'style':'loud','text':'สวัสดี'},{'style':'fix','text':'  '},{'style':'fix','text':'ก'*3001}):
            self.assertEqual(agent.call('/api/ai/polish',bad)[0],400,bad)
        first = self.ok(agent,'/api/ai/polish',{'style':'fix','text':'สวัสดีครับบ'})['id']
        second = self.ok(agent,'/api/ai/polish',{'style':'fix','text':'สวัสดีครับบบ'})['id']
        self.assertEqual(self.ok(agent,f'/api/ai/jobs/{first}')['status'],'cancelled')
        self.assertEqual(self.ok(agent,f'/api/ai/jobs/{second}')['status'],'pending')
        # Not a row in the activity log each time a member tidies a reply.
        with D.tenant(self.org) as db:
            self.assertFalse(db.execute("SELECT 1 FROM audit_logs WHERE action='ai.queued' AND detail='polish'").fetchone())

    # เสนอป้ายและความเร่งด่วน
    def triage_setup(self):
        self.enable(chatbot_enabled=False,triage_enabled=True)
        tags = self.ok(self.admin,'/api/settings/tags',{'tags':[{'name':'เข้าระบบไม่ได้'},{'name':'ขอคืนสินค้า'}]})['tags']
        _,conversation = self.visitor(body='เข้าระบบไม่ได้เลยค่ะ ต้องใช้ส่งงานวันนี้')
        ticket = self.ok(self.admin,f'/api/conversations/{conversation}/ticket',{})['id']
        return {t['name']:t['id'] for t in tags},ticket

    def test_a_new_case_gets_a_proposal_that_a_member_uses(self):
        tags,ticket = self.triage_setup()
        sent = self.answer(lambda p:{'priority':'high','team':'','tags':[t['ref'] for t in p['tags'] if t['name']=='เข้าระบบไม่ได้']+['g99'],
                                     'reason':'ลูกค้าเข้าระบบไม่ได้และต้องส่งงานวันนี้'})
        self.assertEqual(sent[0][0],'triage')
        payload = sent[0][1]
        self.assertEqual(payload['messages'],['เข้าระบบไม่ได้เลยค่ะ ต้องใช้ส่งงานวันนี้'])
        self.assertNotIn('_refs',payload)
        self.assertNotIn('customer@example.com',json.dumps(payload,ensure_ascii=False))
        proposal = self.ok(self.admin,f'/api/tickets/{ticket}')['ticket']['triage']
        # The made-up tag ref is dropped; the one it was shown stays.
        self.assertEqual((proposal['priority'],proposal['tags'],proposal['team_id']),('high',[tags['เข้าระบบไม่ได้']],''))
        agent,_ = self.create_member()
        self.ok(agent,f'/api/tickets/{ticket}/triage',{'use':['priority','tags']})
        detail = self.ok(self.admin,f'/api/tickets/{ticket}')
        self.assertEqual((detail['ticket']['priority'],detail['ticket']['tags'],detail['ticket']['triage']),('high',[tags['เข้าระบบไม่ได้']],None))
        self.assertEqual(agent.call(f'/api/tickets/{ticket}/triage',{'use':[]})[0],409)

    def test_a_proposal_set_aside_or_changing_nothing_is_not_shown(self):
        _,ticket = self.triage_setup()
        # Already so: the case is normal and the AI says normal with nothing else - nothing to show.
        self.answer({'priority':'normal','team':'','tags':[],'reason':''})
        self.assertIsNone(self.ok(self.admin,f'/api/tickets/{ticket}')['ticket']['triage'])
        _,conversation = self.visitor(body='ขอคืนสินค้าค่ะ')
        other = self.ok(self.admin,f'/api/conversations/{conversation}/ticket',{})['id']
        self.answer(lambda p:{'priority':'low','team':'','tags':[],'reason':'ขอคืนสินค้า รอได้'})
        self.assertEqual(self.ok(self.admin,f'/api/tickets/{other}')['ticket']['triage']['priority'],'low')
        self.ok(self.admin,f'/api/tickets/{other}/triage',{'use':[]})
        detail = self.ok(self.admin,f'/api/tickets/{other}')
        self.assertEqual((detail['ticket']['triage'],detail['ticket']['priority']),(None,'normal'))

    def test_without_the_switch_no_case_is_read(self):
        self.enable(chatbot_enabled=False)
        _,conversation = self.visitor(body='เข้าระบบไม่ได้ค่ะ')
        self.ok(self.admin,f'/api/conversations/{conversation}/ticket',{})
        self.assertEqual(self.jobs('triage'),[])

    # Chatbot ถามข้อมูลก่อนถึงเจ้าหน้าที่
    def gather_setup(self):
        self.enable()
        self.article()
        saved = self.ok(self.admin,FIELDS,{'fields':[{'name':'เลขสมาชิก','kind':'text','ask':True},
                                                     {'name':'อุปกรณ์ที่ใช้','kind':'select','options':['มือถือ','คอมพิวเตอร์'],'ask':True},
                                                     {'name':'หมายเหตุภายใน','kind':'text'}]})['fields']
        return {f['name']:f['id'] for f in saved}

    def messages(self, visitor):
        return self.ok(visitor,'/api/public/alpha/session')['messages']

    def test_the_chatbot_asks_for_what_is_missing_and_fills_in_the_answers(self):
        ids = self.gather_setup()
        visitor,conversation = self.visitor(body='เลขสมาชิก 12345 ค่ะ ขอคุยกับเจ้าหน้าที่')
        # The handoff happened at once; the reading of what the customer already wrote is queued.
        session = self.ok(visitor,'/api/public/alpha/session')
        self.assertEqual(session['ai']['mode'],'human')
        ticket = session['ticket']['id']
        sent = self.answer(lambda p:{'values':[{'field':p['fields'][0]['ref'],'value':'12345'}]})
        self.assertEqual(sent[0][0],'gather')
        self.assertEqual([f['name'] for f in sent[0][1]['fields']],['เลขสมาชิก','อุปกรณ์ที่ใช้'])
        self.assertEqual(sent[0][1]['messages'],['เลขสมาชิก 12345 ค่ะ ขอคุยกับเจ้าหน้าที่'])
        values = self.ok(self.admin,f'/api/tickets/{ticket}')['ticket']['fields']
        self.assertEqual(values,{ids['เลขสมาชิก']:'12345'})
        # Asked only for what is still missing, in words the system wrote.
        asked = self.messages(visitor)[-1]['body']
        self.assertIn('อุปกรณ์ที่ใช้ (มือถือ, คอมพิวเตอร์)',asked)
        self.assertNotIn('เลขสมาชิก',asked)
        self.ok(visitor,'/api/public/alpha/messages',{'body':'ใช้บนมือถือค่ะ'})
        sent = self.answer(lambda p:{'values':[{'field':p['fields'][0]['ref'],'value':'มือถือ'}]})
        self.assertEqual(sent[0][1]['messages'],['ใช้บนมือถือค่ะ'])
        values = self.ok(self.admin,f'/api/tickets/{ticket}')['ticket']['fields']
        self.assertEqual(values,{ids['เลขสมาชิก']:'12345',ids['อุปกรณ์ที่ใช้']:'มือถือ'})
        self.assertIn('ได้รับข้อมูลแล้ว',self.messages(visitor)[-1]['body'])
        # Nothing more is read once it is all there.
        self.ok(visitor,'/api/public/alpha/messages',{'body':'ขอบคุณค่ะ'})
        self.assertEqual(len(self.jobs('gather')),2)

    def test_it_stops_when_the_team_writes_and_never_overwrites_the_team(self):
        ids = self.gather_setup()
        visitor,conversation = self.visitor(body='ขอคุยกับเจ้าหน้าที่')
        ticket = self.ok(visitor,'/api/public/alpha/session')['ticket']['id']
        # Nothing to read in "ขอคุยกับเจ้าหน้าที่"? It is read all the same, and nothing is filled.
        self.answer({'values':[]})
        self.assertIn('เลขสมาชิก',self.messages(visitor)[-1]['body'])
        self.ok(self.admin,f'/api/tickets/{ticket}/fields',{'values':{ids['เลขสมาชิก']:'999'}})
        self.ok(visitor,'/api/public/alpha/messages',{'body':'เลขสมาชิก 12345 ใช้คอมพิวเตอร์'})
        self.answer(lambda p:{'values':[{'field':f['ref'],'value':'12345' if f['name']=='เลขสมาชิก' else 'คอมพิวเตอร์'} for f in p['fields']]})
        values = self.ok(self.admin,f'/api/tickets/{ticket}')['ticket']['fields']
        self.assertEqual(values,{ids['เลขสมาชิก']:'999',ids['อุปกรณ์ที่ใช้']:'คอมพิวเตอร์'})
        # A member writing to the customer ends it: the next message is not read.
        _,conversation2 = self.visitor(body='ขอคุยกับเจ้าหน้าที่ด่วน')
        self.answer({'values':[]})
        self.ok(self.admin,f'/api/conversations/{conversation2}/messages',{'kind':'reply','body':'สวัสดีครับ ขอเลขสมาชิกด้วยครับ'})
        before = len(self.jobs('gather'))
        with D.tenant(self.org) as db:
            AI.gather.on_customer_message(db,self.org,conversation2)
            db.commit()
        self.assertEqual(len(self.jobs('gather')),before)

    def test_without_marked_fields_nothing_is_asked(self):
        self.enable()
        self.article()
        visitor,_ = self.visitor(body='ขอคุยกับเจ้าหน้าที่')
        self.assertEqual(self.jobs('gather'),[])
        self.assertFalse(any('ระหว่างรอเจ้าหน้าที่' in m['body'] for m in self.messages(visitor)))


if __name__ == '__main__':
    unittest.main()
