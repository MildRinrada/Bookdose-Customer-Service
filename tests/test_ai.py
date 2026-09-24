"""AI integration tests use a mocked provider and never transmit customer data."""
from concurrent.futures import ThreadPoolExecutor
import base64
import io
import json
from pathlib import Path
import stat
import unittest
from unittest.mock import patch
import urllib.error
import zipfile

import test_app as base
import app
from backend.database import db as D
from backend.extensions import openai_client as OpenAI
from backend.modules.ai import service as AI, repository as AIR

FAKE_KEY = 'sk-unit-test-not-a-real-key-0123456789'


def fake_provider(key,cfg,payload,mode):
    if mode=='test':
        return {'answer':'เชื่อมต่อ AI สำเร็จ','summary':'','needs_human':False,'citations':[]},{'input_tokens':10,'output_tokens':10}
    article = payload['articles'][0]
    return {'answer':'เปิดเมนูรายงาน แล้วเลือกดาวน์โหลดรายงานการอ่านได้เลยค่ะ',
            'summary':'ลูกค้าต้องการดาวน์โหลดรายงานการอ่าน','needs_human':False,
            'citations':[{'article_id':article['id'],'quote':article['text'][:40]}]}, {'input_tokens':250,'output_tokens':90}


def answered(mock):
    """The provider was asked for an answer or a draft - not only to read a customer's mood (ai/mood.py), which runs on
    every customer message of an organization with an AI."""
    return any(call.args[3]!='mood' for call in mock.call_args_list)


class AITests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    create_member = base.IntegrationTests.create_member
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    customer = base.IntegrationTests.customer
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD

    def enable(self,client=None,**extra):
        return self.ok(client or self.admin,'/api/ai/settings',{'api_key':FAKE_KEY,'drafts_enabled':True,'chatbot_enabled':True,**extra},'PATCH')

    def article(self,visibility='public',client=None):
        return self.ok(client or self.admin,'/api/articles',{'title':'วิธีดาวน์โหลดรายงานการอ่าน','category':'รายงาน',
            'body':'เปิดเมนูรายงาน แล้วเลือกดาวน์โหลดรายงานการอ่านประจำเดือน เลือกช่วงเวลาและกดส่งออก CSV',
            'visibility':visibility})['id']

    def visitor(self,slug='alpha',body='ดาวน์โหลดรายงานการอ่านอย่างไร'):
        return base.IntegrationTests.visitor(self,slug,'customer@example.com','ดาวน์โหลดรายงานการอ่าน',body)

    def run_job(self,tenant=None,provider=fake_provider):
        with patch.object(OpenAI,'call_provider',side_effect=provider) as mock:
            AI.process_one(tenant or self.org)
            return mock

    def test_migration_idempotent_defaults_and_key_protection(self):
        D.init();D.init()
        self.assertEqual(len(self.ok(self.admin,'/api/tickets')['tickets']),5)
        before=self.ok(self.admin,'/api/ai/settings')
        self.assertFalse(before['drafts_enabled']);self.assertFalse(before['key_configured'])
        enabled=self.enable()
        self.assertTrue(enabled['key_configured'])
        self.assertNotIn(FAKE_KEY,json.dumps(enabled))
        self.assertNotIn(FAKE_KEY,json.dumps(self.ok(self.admin,'/api/workspace')))
        self.assertEqual(stat.S_IMODE(AIR.key_path(self.org).stat().st_mode),0o600)
        self.assertIn(f'secrets/{self.org}.openai-key',base.assert_sealed_backup(self,app.make_backup(),FAKE_KEY))
        agent,_=self.create_member()
        self.assertEqual(agent.call('/api/ai/settings')[0],403)
        self.assertEqual(agent.call('/api/ai/settings',{'api_key':FAKE_KEY},'PATCH')[0],403)
        self.assertEqual(agent.call('/api/ai/test',{})[0],403)
        self.assertEqual(self.admin.call('/api/ai/settings',{'remove_key':True},'PATCH')[0],400)
        # An Anthropic key is refused before it is ever sent to OpenAI.
        status,body = self.admin.call('/api/ai/settings',{'api_key':'sk-ant-api03-'+'a'*40},'PATCH')
        self.assertEqual(status,400);self.assertIn('Anthropic',body['error'])
        self.ok(self.admin,'/api/ai/settings',{'remove_key':True,'drafts_enabled':False,'chatbot_enabled':False},'PATCH')
        self.assertFalse(AIR.key_path(self.org).exists())

    def test_bot_uses_only_public_knowledge_and_no_private_notes(self):
        self.enable();public_id=self.article();private_id=self.article('internal')
        visitor,conv=self.visitor()
        self.ok(self.admin,f'/api/conversations/{conv}/messages',{'kind':'note','body':'INTERNAL-NOTE-SECRET'})
        captured=[]
        def provider(*args):
            captured.append(args[2]);return fake_provider(*args)
        self.run_job(provider=provider)
        prompt=json.dumps(captured,ensure_ascii=False)
        self.assertIn(public_id,prompt);self.assertNotIn(private_id,prompt);self.assertNotIn('INTERNAL-NOTE-SECRET',prompt)
        self.assertNotIn('customer@example.com',prompt)
        result=self.ok(visitor,'/api/public/alpha/session')
        ai=[m for m in result['messages'] if m['source']=='ai']
        self.assertEqual(len(ai),1);self.assertEqual(ai[0]['citations'][0]['article_id'],public_id)
        self.run_job()
        self.assertEqual(len([m for m in self.ok(visitor,'/api/public/alpha/session')['messages'] if m['source']=='ai']),1)
        ticket=self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']
        self.assertIsNone(self.ok(self.admin,'/api/tickets/'+ticket)['ticket']['first_response_at'])

    def test_draft_private_result_never_sent_and_stale_draft_rejected(self):
        self.enable(chatbot_enabled=False);self.article('internal')
        visitor,conv=self.visitor()
        queued=self.ok(self.admin,f'/api/conversations/{conv}/ai-draft',{})['id']
        duplicate=self.ok(self.admin,f'/api/conversations/{conv}/ai-draft',{})['id']
        self.assertEqual(queued,duplicate)
        self.run_job()
        job=self.ok(self.admin,'/api/ai/jobs/'+queued)
        self.assertEqual(job['status'],'done');self.assertTrue(job['result']['answer'])
        self.assertNotIn('_context_hash',job['result'])
        self.assertEqual(job['result']['citations'][0]['visibility'],'internal')
        self.assertEqual(len(self.ok(visitor,'/api/public/alpha/session')['messages']),1)
        other,_=self.create_member()
        self.assertEqual(other.call('/api/ai/jobs/'+queued)[0],404)
        self.ok(visitor,'/api/public/alpha/messages',{'body':'ขอรายงานเพิ่มของเดือนก่อนด้วย'})
        self.assertEqual(self.ok(self.admin,'/api/ai/jobs/'+queued)['status'],'cancelled')

    def test_unknown_answer_and_provider_failure_handoff_without_losing_message(self):
        self.enable()
        visitor,conv=self.visitor(body='quantum-unrelated-zebra')
        called=self.run_job()
        self.assertFalse(called.called)
        result=self.ok(visitor,'/api/public/alpha/session')
        self.assertEqual(result['ai']['mode'],'human');self.assertIsNotNone(result['ticket'])
        self.assertEqual(result['messages'][0]['body'],'quantum-unrelated-zebra')
        self.article()
        second,c2=self.visitor()
        def failure(*args):raise AI.AIError('rate_limit')
        self.run_job(provider=failure)
        result=self.ok(second,'/api/public/alpha/session')
        self.assertEqual(result['ai']['mode'],'human')
        self.assertEqual(len([m for m in result['messages'] if m['source']=='system']),1)
        self.ok(second,'/api/public/alpha/handoff',{})
        self.assertEqual(len([m for m in self.ok(second,'/api/public/alpha/session')['messages'] if m['source']=='system']),1)

    def test_customer_handoff_cancels_inflight_reply(self):
        self.enable();self.article();visitor,conv=self.visitor()
        def provider(*args):
            self.ok(visitor,'/api/public/alpha/handoff',{})
            return fake_provider(*args)
        self.run_job(provider=provider)
        result=self.ok(visitor,'/api/public/alpha/session')
        self.assertEqual(result['ai']['mode'],'human');self.assertIsNotNone(result['ticket'])
        self.assertFalse(any(m['source']=='ai' for m in result['messages']))
        self.ok(visitor,'/api/public/alpha/messages',{'body':'ดาวน์โหลดรายงานการอ่าน'})
        self.assertFalse(answered(self.run_job()))

    def test_staff_reply_takes_over_and_new_message_supersedes_old_job(self):
        self.enable();self.article();visitor,conv=self.visitor()
        def reply(*args):
            self.ok(self.admin,f'/api/conversations/{conv}/messages',{'kind':'reply','body':'เจ้าหน้าที่รับช่วงแล้ว'})
            return fake_provider(*args)
        self.run_job(provider=reply)
        self.assertFalse(any(m['source']=='ai' for m in self.ok(visitor,'/api/public/alpha/session')['messages']))
        self.ok(self.admin,f'/api/conversations/{conv}/ai-mode',{'mode':'bot'})
        self.ok(visitor,'/api/public/alpha/messages',{'body':'ดาวน์โหลดรายงานการอ่าน'})
        def another(*args):
            self.ok(visitor,'/api/public/alpha/messages',{'body':'ดาวน์โหลดรายงานการอ่านปีนี้'})
            return fake_provider(*args)
        self.run_job(provider=another)
        self.assertFalse(any(m['source']=='ai' for m in self.ok(visitor,'/api/public/alpha/session')['messages']))
        self.run_job()
        self.assertEqual(len([m for m in self.ok(visitor,'/api/public/alpha/session')['messages'] if m['source']=='ai']),1)

    def test_per_tenant_knowledge_credentials_and_job_authorization(self):
        self.enable();article=self.article()
        second=self.ok(self.owner,'/api/platform/tenants',{'name':'องค์กร B','slug':'beta','email':'orgadmin@example.com'})['id']
        self.admin.switch(second)
        self.assertFalse(self.ok(self.admin,'/api/ai/settings')['key_configured'])
        self.enable()
        visitor,conv=self.visitor('beta')
        called=self.run_job(second)
        self.assertFalse(called.called)
        self.assertNotIn(article,json.dumps(self.ok(visitor,'/api/public/beta/session')))
        self.admin.switch(self.org)
        self.assertEqual(self.admin.call(f'/api/conversations/{conv}/ai-draft',{})[0],404)

    def test_team_permission_and_revocation_during_draft(self):
        self.enable(chatbot_enabled=False);self.article();visitor,conv=self.visitor()
        other_team=self.ok(self.admin,'/api/teams',{'name':'Other team'})['id']
        outsider,_=self.create_member(other_team,email='outside@example.com')
        self.assertEqual(outsider.call(f'/api/conversations/{conv}/ai-draft',{})[0],404)
        agent,user_id=self.create_member()
        job=self.ok(agent,f'/api/conversations/{conv}/ai-draft',{})['id']
        def revoked(*args):
            self.ok(self.admin,'/api/members/'+user_id,{'team_id':self.team,'role':'agent','active':False},'PATCH')
            return fake_provider(*args)
        self.run_job(provider=revoked)
        self.assertEqual(agent.call('/api/ai/jobs/'+job)[0],403)
        with D.tenant(self.org) as db:
            self.assertEqual(D.one(db,'SELECT status FROM ai_jobs WHERE id=?',(job,))['status'],'cancelled')

    def test_unpublishing_knowledge_prevents_inflight_answer(self):
        self.enable();article=self.article();visitor,conv=self.visitor()
        def unpublish(*args):
            self.ok(self.admin,'/api/articles/'+article,{'title':'วิธีดาวน์โหลดรายงานการอ่าน','category':'รายงาน','body':'เปิดเมนูรายงาน แล้วเลือกดาวน์โหลดรายงานการอ่านประจำเดือน เลือกช่วงเวลาและกดส่งออก CSV','visibility':'internal'},'PATCH')
            return fake_provider(*args)
        self.run_job(provider=unpublish)
        result=self.ok(visitor,'/api/public/alpha/session')
        self.assertEqual(result['ai']['mode'],'human');self.assertFalse(any(m['source']=='ai' for m in result['messages']))

    def test_limits_are_atomic_and_handoff_has_no_model_cost(self):
        self.enable(daily_limit=1);self.article()
        # The customers sign up first; only the two questions arrive at the same moment.
        customers=[self.customer(email=f'limit{n}@example.com') for n in range(2)]
        def ask(client):
            client.conversation=self.ok(client,'/api/public/alpha/conversations',{'subject':'ดาวน์โหลดรายงานการอ่าน','body':'ดาวน์โหลดรายงานการอ่านอย่างไร'})['id']
            return client,client.conversation
        with ThreadPoolExecutor(max_workers=2) as pool:
            visitors=list(pool.map(ask,customers))
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM ai_jobs WHERE mode!='mood'").fetchone()[0],1)
        self.assertEqual(sum(self.ok(v,'/api/public/alpha/session')['ai']['mode']=='human' for v,_ in visitors),1)
        self.run_job()
        # The one answer, and one mood reading: mood readings have a daily limit of their own, the same 1.
        self.assertEqual(self.ok(self.admin,'/api/ai/settings')['usage']['requests'],1+1)
        human,c=self.visitor(body='ขอคุยกับเจ้าหน้าที่')
        self.assertEqual(self.ok(human,'/api/public/alpha/session')['ai']['mode'],'human')
        self.assertFalse(answered(self.run_job()))

    def test_malformed_and_fabricated_citations_are_not_published(self):
        self.enable();self.article();visitor,conv=self.visitor()
        def fabricated(*args):
            result,usage=fake_provider(*args);result['citations'][0]['article_id']='0'*32
            return result,usage
        self.run_job(provider=fabricated)
        result=self.ok(visitor,'/api/public/alpha/session')
        self.assertFalse(any(m['source']=='ai' for m in result['messages']))
        self.assertEqual(result['ai']['mode'],'human')

    def test_connection_job_sends_no_customer_content_and_counts_usage(self):
        self.enable()
        queued=self.ok(self.admin,'/api/ai/test',{})['id']
        captured=[]
        def check(*args):captured.append(args[2]);return fake_provider(*args)
        self.run_job(provider=check)
        self.assertEqual(captured,[{'test':'Bookdose connection check'}])
        self.assertEqual(self.ok(self.admin,'/api/ai/jobs/'+queued)['status'],'done')
        self.assertEqual(self.ok(self.admin,'/api/ai/settings')['usage']['input_tokens'],10)

    def test_provider_http_contract_and_redacted_errors(self):
        class Response(io.BytesIO):
            def __enter__(self):return self
            def __exit__(self,*args):self.close()
        output={'answer':'เชื่อมต่อสำเร็จ','summary':'','needs_human':False,'citations':[]}
        captured=[]
        class Opener:
            def open(self,request,timeout):
                captured.append(request)
                return Response(json.dumps({'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(output)}]}],
                    'usage':{'input_tokens':12,'output_tokens':8}}).encode())
        cfg={'model':AI.DEFAULT_MODEL,'max_output_tokens':1000}
        with patch.object(OpenAI.urllib.request,'build_opener',return_value=Opener()):
            result,usage=OpenAI.call_provider(FAKE_KEY,cfg,{'test':'only'},'test')
        self.assertEqual(result,output)
        payload=json.loads(captured[0].data)
        self.assertEqual(captured[0].full_url,'https://api.openai.com/v1/responses')
        self.assertFalse(payload['store']);self.assertTrue(payload['text']['format']['strict'])
        self.assertNotIn(FAKE_KEY,captured[0].data.decode())
        with patch.object(OpenAI.urllib.request,'build_opener') as opener:
            opener.return_value.open.side_effect=urllib.error.HTTPError('https://api.openai.com',401,'PRIVATE PROVIDER DETAIL',{},None)
            with self.assertRaises(AI.AIError) as error:OpenAI.call_provider(FAKE_KEY,cfg,{},'test')
        self.assertNotIn('PRIVATE',str(error.exception));self.assertEqual(error.exception.code,'unauthorized')

    def test_expired_running_job_handoffs_without_reissuing_request(self):
        self.enable();self.article();visitor,conv=self.visitor()
        with D.tenant(self.org) as db:
            db.execute("UPDATE ai_jobs SET status='running',updated_at='2000-01-01T00:00:00+00:00'")
        self.assertFalse(answered(self.run_job()))
        self.assertEqual(self.ok(visitor,'/api/public/alpha/session')['ai']['mode'],'human')

    def test_attachment_handoff_keeps_file_and_does_not_send_it_to_ai(self):
        self.enable();self.article();visitor,conv=self.visitor()
        self.ok(visitor,'/api/public/alpha/messages',{'body':'ดาวน์โหลดรายงานการอ่านแล้วติดปัญหาตามไฟล์',
            'attachments':[{'name':'problem.txt','data':base64.b64encode(b'private attachment').decode()}]})
        self.assertFalse(answered(self.run_job()))
        result=self.ok(visitor,'/api/public/alpha/session')
        self.assertEqual(result['ai']['mode'],'human')
        self.assertEqual(result['messages'][1]['attachments'][0]['name'],'problem.txt')

    def test_disable_during_generation_prevents_publishing(self):
        self.enable();self.article();visitor,conv=self.visitor()
        def disable(*args):
            self.ok(self.admin,'/api/ai/settings',{'chatbot_enabled':False},'PATCH')
            return fake_provider(*args)
        self.run_job(provider=disable)
        result=self.ok(visitor,'/api/public/alpha/session')
        self.assertEqual(result['ai']['mode'],'human')
        self.assertFalse(any(m['source']=='ai' for m in result['messages']))

    def test_suspend_during_generation_cancels_without_publishing(self):
        self.enable();self.article();visitor,conv=self.visitor()
        # The platform's own organization cannot be suspended on screen; what matters here is the state itself.
        def suspend(*args):
            with D.control() as cd:
                cd.execute("UPDATE tenants SET status='suspended' WHERE id=?",(self.org,))
                cd.commit()
            return fake_provider(*args)
        self.run_job(provider=suspend)
        self.ok(self.owner,'/api/platform/tenants/'+self.org,{'status':'active'},'PATCH')
        self.assertFalse(any(m['source']=='ai' for m in self.ok(visitor,'/api/public/alpha/session')['messages']))

    def test_conversation_limit_falls_back_after_one_bot_reply(self):
        self.enable(conversation_limit=1);self.article();visitor,conv=self.visitor()
        self.run_job()
        self.ok(visitor,'/api/public/alpha/messages',{'body':'ดาวน์โหลดรายงานการอ่านอีกเดือน'})
        self.assertFalse(answered(self.run_job()))
        result=self.ok(visitor,'/api/public/alpha/session')
        self.assertEqual(result['ai']['mode'],'human')
        self.assertEqual(len([m for m in result['messages'] if m['source']=='ai']),1)


if __name__=='__main__':
    unittest.main(verbosity=2)
