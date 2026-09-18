"""An organization's n8n workflow as its AI: settings, the request the workflow receives, and what happens to its answer.
The workflow is a local stub server; nothing leaves this computer."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
import unittest
from unittest.mock import patch

import test_ai
import test_app as base
import app
from config import settings
from backend.extensions import openai_client as OpenAI
from backend.modules.ai import service as AI, repository as AIR

SECRET = 'n8n-shared-secret-0123456789'


class Workflow(BaseHTTPRequestHandler):
    """Answers like the Bookdose AI workflow (integrations/n8n): {"result", "usage"}, or 403 without the secret."""
    received = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        Workflow.received.append((dict(self.headers),body))
        if self.headers.get('X-Bookdose-Secret')!=SECRET:
            self.send_response(403);self.end_headers();return
        if self.path.endswith('/broken'):
            self.send_response(500);self.end_headers();return
        payload = json.loads(body['input'])
        if body['mode']=='test':
            result = {'answer':'เชื่อมต่อ AI สำเร็จ','summary':'','needs_human':False,'citations':[]}
        else:
            article = payload['articles'][0]
            result = {'answer':'เปิดเมนูรายงาน แล้วเลือกดาวน์โหลดได้เลยค่ะ','summary':'ถามเรื่องรายงาน','needs_human':False,
                      'citations':[{'article_id':article['id'],'quote':article['text'][:40]}]}
        # n8n's "Respond to Webhook" with all items answers a list.
        answer = json.dumps([{'result':result,'usage':{'input_tokens':321,'output_tokens':45}}]).encode()
        self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(answer)

    def log_message(self, *args):
        pass


class AIWebhookTests(unittest.TestCase):
    setUp_base = base.IntegrationTests.setUp
    tearDown_base = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    create_member = base.IntegrationTests.create_member
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    customer = base.IntegrationTests.customer
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD
    article = test_ai.AITests.article
    visitor = test_ai.AITests.visitor

    def setUp(self):
        self.setUp_base()
        Workflow.received = []
        self.workflow = ThreadingHTTPServer(('127.0.0.1',0),Workflow)
        threading.Thread(target=self.workflow.serve_forever,daemon=True).start()
        self.url = f'http://localhost:{self.workflow.server_port}/webhook/bookdose-ai'

    def tearDown(self):
        self.workflow.shutdown();self.workflow.server_close()
        self.tearDown_base()

    def connect(self, **extra):
        return self.ok(self.admin,'/api/ai/settings',{'webhook_url':self.url,'webhook_secret':SECRET,
                                                     'drafts_enabled':True,'chatbot_enabled':True,**extra},'PATCH')

    def test_settings_keep_the_webhook_secret(self):
        self.assertEqual(self.admin.call('/api/ai/settings',{'webhook_url':self.url,'drafts_enabled':True},'PATCH')[0],400)
        saved = self.connect()
        self.assertTrue(saved['key_configured']);self.assertFalse(saved['openai_key'])
        self.assertEqual(saved['provider'],'n8n');self.assertEqual(saved['webhook_host'],f'localhost:{self.workflow.server_port}')
        # The owner sees the URL and the secret's last characters; members' workspace data has neither.
        self.assertEqual((saved['webhook_url'],saved['webhook_secret_end']),(self.url,SECRET[-4:]))
        self.assertNotIn(SECRET,json.dumps(saved))
        workspace = json.dumps(self.ok(self.admin,'/api/workspace'))
        self.assertNotIn(SECRET,workspace);self.assertNotIn('/webhook/bookdose-ai',workspace)
        self.assertIn(f'secrets/{self.org}.ai-webhook.json',base.assert_sealed_backup(self,app.make_backup(),SECRET))
        # Saving other settings keeps the webhook and its secret.
        self.ok(self.admin,'/api/ai/settings',{'daily_limit':50},'PATCH')
        self.assertEqual(AIR.read_webhook(self.org),{'url':self.url,'secret':SECRET})
        # A new secret with the URL box left empty changes only the secret.
        self.ok(self.admin,'/api/ai/settings',{'webhook_url':'','webhook_secret':'a-new-secret-0123456789'},'PATCH')
        self.assertEqual(AIR.read_webhook(self.org),{'url':self.url,'secret':'a-new-secret-0123456789'})
        self.ok(self.admin,'/api/ai/settings',{'webhook_url':'','webhook_secret':SECRET},'PATCH')
        agent,_ = self.create_member()
        self.assertEqual(agent.call('/api/ai/settings',{'webhook_url':self.url,'webhook_secret':SECRET},'PATCH')[0],403)
        # Removing the only connection while AI is on is refused; with AI off it is removed.
        self.assertEqual(self.admin.call('/api/ai/settings',{'remove_webhook':True},'PATCH')[0],400)
        removed = self.ok(self.admin,'/api/ai/settings',{'remove_webhook':True,'drafts_enabled':False,'chatbot_enabled':False},'PATCH')
        self.assertFalse(removed['key_configured']);self.assertEqual(removed['provider'],'openai')
        self.assertFalse(AIR.webhook_path(self.org).exists())

    def test_webhook_addresses(self):
        for url in ('http://n8n.example.com/webhook/x','https://10.0.0.5/webhook/x','https://intranet/webhook/x',
                    'https://user:pass@n8n.example.com/webhook/x','ftp://n8n.example.com/x'):
            self.assertEqual(self.admin.call('/api/ai/settings',{'webhook_url':url,'webhook_secret':SECRET},'PATCH')[0],400,url)
        self.ok(self.admin,'/api/ai/settings',{'webhook_url':'https://n8n.example.com/webhook/bookdose-ai','webhook_secret':SECRET},'PATCH')
        # n8n on this computer only while the server itself is reachable from this computer alone.
        with patch.object(settings,'HOST','0.0.0.0'):
            self.assertEqual(self.admin.call('/api/ai/settings',{'webhook_url':self.url,'webhook_secret':SECRET},'PATCH')[0],400)

    def test_chatbot_answers_through_the_workflow(self):
        self.connect();public_id = self.article()
        visitor,conv = self.visitor()
        with patch.object(OpenAI,'call_provider') as openai:
            AI.process_one(self.org)
        self.assertFalse(openai.called)
        headers,body = Workflow.received[-1]
        self.assertEqual((headers['X-Bookdose-Secret'],headers['Authorization']),(SECRET,SECRET))
        self.assertEqual((body['mode'],body['feature']),('bot','chatbot'))
        self.assertEqual(body['schema'],OpenAI.OUTPUT_SCHEMA);self.assertTrue(body['instructions'])
        self.assertNotIn('customer@example.com',body['input'])
        ai = [m for m in self.ok(visitor,'/api/public/alpha/session')['messages'] if m['source']=='ai']
        self.assertEqual(len(ai),1);self.assertEqual(ai[0]['citations'][0]['article_id'],public_id)
        usage = self.ok(self.admin,'/api/ai/settings')['usage']
        self.assertEqual((usage['input_tokens'],usage['output_tokens']),(321,45))

    def test_connection_test_and_a_wrong_secret(self):
        self.connect()
        job = self.ok(self.admin,'/api/ai/test',{})['id']
        AI.process_one(self.org)
        self.assertEqual(self.ok(self.admin,'/api/ai/jobs/'+job)['status'],'done')
        self.assertEqual(Workflow.received[-1][1]['feature'],'assist')
        # A workflow that stops at a node says where to look.
        AIR.write_webhook(self.org,{'url':self.url.replace('bookdose-ai','broken'),'secret':SECRET})
        job = self.ok(self.admin,'/api/ai/test',{})['id']
        AI.process_one(self.org)
        self.assertIn('Executions',self.ok(self.admin,'/api/ai/jobs/'+job)['error'])
        # The workflow refuses another secret: the job fails, and a chatbot conversation goes to the team.
        AIR.write_webhook(self.org,{'url':self.url,'secret':'another-secret-0123456789'})
        self.article()
        visitor,conv = self.visitor()
        AI.process_one(self.org)
        session = self.ok(visitor,'/api/public/alpha/session')
        self.assertEqual(session['ai']['mode'],'human');self.assertFalse([m for m in session['messages'] if m['source']=='ai'])


if __name__=='__main__':
    unittest.main()
