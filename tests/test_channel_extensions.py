"""OAuth, group isolation, file bearer links, and AI dispatch tested without providers."""
import base64
import datetime as dt
import hashlib
import io
import json
import time
import unittest
from unittest.mock import patch, MagicMock
from urllib.parse import parse_qs,urlsplit
import zipfile
import test_app as base
import test_channels as channels
import test_ai as ai
from test_app import app,D
from backend.extensions import channel_transport as T, openai_client as OpenAI
from backend.modules.ai import service as AI
from backend.modules.channels import service as C, email_oauth as O

class ExtensionTests(unittest.TestCase):
    setUp=base.IntegrationTests.setUp
    tearDown=base.IntegrationTests.tearDown
    ok=base.IntegrationTests.ok
    create_member=base.IntegrationTests.create_member
    configure=channels.ChannelTests.configure
    webhook=channels.ChannelTests.webhook
    event=channels.ChannelTests.event
    incoming_line=channels.ChannelTests.incoming_line
    incoming_email=channels.ChannelTests.incoming_email
    reply=channels.ChannelTests.reply
    job=channels.ChannelTests.job
    mail=channels.ChannelTests.mail
    poll=channels.ChannelTests.poll
    enable=ai.AITests.enable
    article=ai.AITests.article
    run_job=ai.AITests.run_job

    def oauth_setup(self,provider='google'):
        return self.configure('email',enabled=False,auth_mode=provider,oauth_client_id='test-client-id',oauth_client_secret='test-client-secret',oauth_redirect_uri=self.base+O.CALLBACK)

    def start(self):
        response=self.ok(self.admin,'/api/channels/email/oauth/start',{})
        return parse_qs(urlsplit(response['url']).query)

    def finish_oauth(self,state,provider='google',client=None):
        with patch.object(O,'token_request',return_value={'access_token':'secret-access','refresh_token':'secret-refresh','expires_at':time.time()+3600}),patch.object(T,'verify_email',return_value={'uidvalidity':'100','uidnext':5}) as verify:
            result=(client or self.admin).call('/api/channels/email/oauth/complete',{'state':state,'code':'one-use-code'})
        return result,verify

    def test_oauth_google_and_microsoft_pkce_scopes_state_and_redaction(self):
        for provider in ('google','microsoft'):
            self.oauth_setup(provider);query=self.start()
            self.assertEqual(query['code_challenge_method'],['S256']);self.assertIn(O.PROVIDERS[provider]['scope'],query['scope'])
            secret=C.read_secret(self.org,'email');pending=secret['oauth_pending']
            expected=base64.urlsafe_b64encode(hashlib.sha256(pending['verifier'].encode()).digest()).decode().rstrip('=')
            self.assertEqual(query['code_challenge'],[expected])
            response,verify=self.finish_oauth(query['state'][0]);self.assertEqual(response[0],200,response)
            self.assertEqual(verify.call_args.args[1],{'auth_token':'secret-access'})
            overview=json.dumps(self.ok(self.admin,'/api/channels'))
            for token in ('secret-access','secret-refresh','test-client-secret',pending['verifier']):self.assertNotIn(token,overview)
            response,_=self.finish_oauth(query['state'][0]);self.assertEqual(response[0],400)
            base.assert_sealed_backup(self,app.make_backup(),'secret-access','secret-refresh','test-client-secret')

    def test_oauth_wrong_session_tenant_generation_and_expiry(self):
        self.oauth_setup();state=self.start()['state'][0]
        other=base.Client(self.base);other.login('admin@example.com')
        response,_=self.finish_oauth(state,client=other);self.assertEqual(response[0],400)
        response,_=self.finish_oauth('x'*43);self.assertEqual(response[0],400)
        secret=C.read_secret(self.org,'email');secret['oauth_pending']['expires_at']=0;C.write_secret(self.org,'email',secret)
        response,_=self.finish_oauth(state);self.assertEqual(response[0],400)
        state=self.start()['state'][0]
        self.configure('email',enabled=False,auth_mode='google',oauth_client_id='test-client-id',oauth_redirect_uri=self.base+O.CALLBACK)
        response,_=self.finish_oauth(state);self.assertEqual(response[0],400)
        state=self.start()['state'][0]
        second=self.ok(self.owner,'/api/platform/tenants',{'name':'Second','slug':'second','email':'admin@example.com'})['id']
        self.admin.switch(second)
        response,_=self.finish_oauth(state);self.assertEqual(response[0],400)

    def test_oauth_refresh_rotation_and_fixed_provider_hosts(self):
        self.oauth_setup('microsoft');self.finish_oauth(self.start()['state'][0])
        secret=C.read_secret(self.org,'email');secret['oauth_tokens']['expires_at']=0;C.write_secret(self.org,'email',secret)
        with D.tenant(self.org) as db:cfg=C.setting(db,'email')['config']
        with patch.object(O,'token_request',return_value={'access_token':'rotated-access','refresh_token':'rotated-refresh','expires_at':time.time()+3600}) as request:
            self.assertEqual(O.access_secret(self.org,cfg),{'auth_token':'rotated-access'})
            self.assertEqual(request.call_args.args[0],'microsoft')
            self.assertEqual(request.call_args.args[1]['refresh_token'],'secret-refresh')
        self.assertEqual(C.read_secret(self.org,'email')['oauth_tokens']['refresh_token'],'rotated-refresh')
        with patch.object(O,'token_request') as request:O.access_secret(self.org,cfg);request.assert_not_called()
        self.assertEqual(cfg['imap_host'],'outlook.office365.com')
        secret=C.read_secret(self.org,'email');secret['oauth_tokens']['expires_at']=0;C.write_secret(self.org,'email',secret)
        with patch.object(O,'token_request',side_effect=T.ChannelError('oauth_expired')):
            with self.assertRaises(T.ChannelError):O.access_secret(self.org,cfg)

    def test_line_group_thread_shared_members_private_chat_separate_and_leave(self):
        cfg=self.configure(groups_enabled=True);group='C'+'c'*32
        for index,user in enumerate(('U'+'1'*32,'U'+'2'*32)):
            self.webhook(cfg['route_id'],[self.event('group-'+str(index),source={'type':'group','groupId':group,'userId':user})]);C.process_line(self.org,app.store_message)
        self.webhook(cfg['route_id'],[self.event('private',source={'type':'user','userId':'U'+'1'*32})]);C.process_line(self.org,app.store_message)
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM conversations WHERE channel='line'").fetchone()[0],2)
            thread=D.one(db,"SELECT * FROM line_threads WHERE source_type='group'");conv=D.one(db,'SELECT * FROM conversations WHERE id=?',(thread['conversation_id'],))
            self.assertEqual(db.execute('SELECT COUNT(*) FROM messages WHERE conversation_id=?',(conv['id'],)).fetchone()[0],2)
        mid=self.reply(conv)
        with patch.object(T,'send_line',return_value='accepted') as send:C.process_outbox(self.org);self.assertEqual(send.call_args.args[1],group)
        queued=self.reply(conv)
        self.webhook(cfg['route_id'],[self.event('leave',type='leave',source={'type':'group','groupId':group})]);C.process_line(self.org,app.store_message)
        self.assertEqual(self.job(queued)['status'],'failed')
        self.assertEqual(self.admin.call('/api/conversations/'+conv['id']+'/messages',{'body':'after leave'})[0],400)

    def test_line_files_native_image_document_link_expiry_revocation_and_notes(self):
        conv=self.incoming_line();self.configure(public_base_url='https://support.example.com')
        mid=self.reply(conv,attachments=[{'name':'guide.pdf','data':base64.b64encode(b'%PDF-1.4 content').decode()},{'name':'image.png','data':base64.b64encode(b'\x89PNG\r\n\x1a\ncontent').decode()}])
        with D.tenant(self.org) as db:payload=json.loads(D.one(db,'SELECT payload FROM channel_outbox_payload WHERE outbox_id=?',(self.job(mid)['id'],))['payload'])
        url=payload[1]['text'].split('\n')[-1];path=urlsplit(url).path
        self.assertEqual(payload[2]['type'],'image')
        self.assertEqual(base.Client(self.base).call(path)[0],404)
        with patch.object(T,'send_line',return_value='accepted') as send:C.process_outbox(self.org);self.assertEqual(send.call_args.args[2],payload)
        status,content=base.Client(self.base).call(path);self.assertEqual(status,200);self.assertEqual(content,b'%PDF-1.4 content')
        self.reply(conv,kind='note',attachments=[{'name':'private.txt','data':'cHJpdmF0ZQ=='}])
        with D.tenant(self.org) as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM channel_file_links').fetchone()[0],2)
        self.ok(self.admin,'/api/messages/'+mid+'/revoke-files',{})
        self.assertEqual(base.Client(self.base).call(path)[0],404)
        with D.tenant(self.org) as db:db.execute("UPDATE channel_file_links SET revoked=0,expires_at='2000-01-01'")
        self.assertEqual(base.Client(self.base).call(path)[0],404)

    def bot_line(self,group=False):
        self.enable(chatbot_enabled=False);self.article();self.article('internal')
        cfg=self.configure(chatbot_enabled=True,groups_enabled=group,group_chatbot_enabled=group)
        event=self.event('bot-message',message={'id':'123','type':'text','text':'/bookdose ดาวน์โหลดรายงานการอ่านอย่างไร' if group else 'ดาวน์โหลดรายงานการอ่านอย่างไร'})
        if group:event['source']={'type':'group','groupId':'C'+'c'*32,'userId':channels.SENDER}
        self.webhook(cfg['route_id'],[event]);C.process_line(self.org,app.store_message)
        with D.tenant(self.org) as db:return D.one(db,"SELECT * FROM conversations WHERE channel='line'")

    def test_line_bot_public_sources_dispatch_and_no_human_sla(self):
        conv=self.bot_line();ticket=self.ok(self.admin,'/api/conversations/'+conv['id']+'/ticket',{})
        self.reply(conv,kind='note',body='TOP-SECRET-NOTE')
        provider=self.run_job();self.assertNotIn('TOP-SECRET-NOTE',json.dumps(provider.call_args.args[2]))
        self.assertTrue(all(a['visibility']=='public' for a in provider.call_args.args[2]['articles']))
        with patch.object(T,'send_line',return_value='accepted') as send:
            C.process_outbox(self.org);self.assertIn('[Bookdose AI]',send.call_args.args[2]);self.assertNotIn('TOP-SECRET-NOTE',send.call_args.args[2])
        with D.tenant(self.org) as db:self.assertIsNone(D.one(db,'SELECT first_response_at FROM tickets WHERE id=?',(ticket['id'],))['first_response_at'])

    def test_human_reply_cancels_generated_bot_before_dispatch(self):
        conv=self.bot_line();self.run_job();mid=self.reply(conv,body='เจ้าหน้าที่รับช่วงแล้ว')
        with patch.object(T,'send_line',return_value='accepted') as send:
            for _ in range(3):C.process_outbox(self.org)
            self.assertEqual(send.call_count,1);self.assertEqual(send.call_args.args[2],'เจ้าหน้าที่รับช่วงแล้ว')
        with D.tenant(self.org) as db:
            job=D.one(db,"SELECT * FROM channel_outbox WHERE actor_id='@ai'");self.assertEqual(job['status'],'failed')
        self.assertEqual(self.admin.call('/api/messages/'+job['message_id']+'/retry',{})[0],400)

    def test_unpublish_after_generation_blocks_bot_dispatch(self):
        conv=self.bot_line();self.run_job()
        with D.tenant(self.org) as db:db.execute("UPDATE knowledge_articles SET visibility='internal'")
        with patch.object(T,'send_line') as send:C.process_outbox(self.org);send.assert_not_called()

    def test_group_bot_only_called_message_context_and_no_chatter_trigger(self):
        conv=self.bot_line(group=True)
        provider=self.run_job();self.assertEqual(len(provider.call_args.args[2]['messages']),1)
        with patch.object(T,'send_line',return_value='accepted') as send:C.process_outbox(self.org);self.assertEqual(send.call_args.args[1],'C'+'c'*32)
        with D.tenant(self.org) as db:route=C.setting(db,'line')['route_id']
        self.webhook(route,[self.event('chatter',source={'type':'group','groupId':'C'+'c'*32,'userId':'U'+'d'*32},message={'type':'text','text':'PRIVATE CHATTER'})]);C.process_line(self.org,app.store_message)
        with patch.object(OpenAI,'call_provider') as provider:AI.process_one(self.org);provider.assert_not_called()
        self.webhook(route,[self.event('called',source={'type':'group','groupId':'C'+'c'*32,'userId':'U'+'d'*32},message={'type':'text','text':'/bookdose ดาวน์โหลดรายงานการอ่านอย่างไร'})]);C.process_line(self.org,app.store_message)
        provider=self.run_job();self.assertNotIn('PRIVATE CHATTER',json.dumps(provider.call_args.args[2]))

    def test_group_can_call_bot_after_initial_chatter_and_stale_reply_is_blocked(self):
        self.enable(chatbot_enabled=False);self.article()
        cfg=self.configure(chatbot_enabled=True,groups_enabled=True,group_chatbot_enabled=True)
        source={'type':'group','groupId':'C'+'c'*32,'userId':channels.SENDER}
        self.webhook(cfg['route_id'],[self.event('first-chatter',source=source,message={'type':'text','text':'สวัสดีสมาชิกกลุ่ม'})]);C.process_line(self.org,app.store_message)
        with patch.object(OpenAI,'call_provider') as provider:AI.process_one(self.org);provider.assert_not_called()
        self.webhook(cfg['route_id'],[self.event('call-after-chatter',source=source,message={'type':'text','text':'/bookdose ดาวน์โหลดรายงานการอ่านอย่างไร'})]);C.process_line(self.org,app.store_message)
        self.assertEqual(self.run_job().call_count,1)
        self.webhook(cfg['route_id'],[self.event('new-chatter',source=source,message={'type':'text','text':'มีข้อมูลเพิ่มเติม'})]);C.process_line(self.org,app.store_message)
        with patch.object(T,'send_line') as send:C.process_outbox(self.org);send.assert_not_called()

    def test_email_bot_and_handoff_with_no_auto_reply_loop(self):
        self.enable(chatbot_enabled=False);self.article();self.configure('email',chatbot_enabled=True)
        self.poll([(5,self.mail())]);self.run_job()
        with D.tenant(self.org) as db:conv=D.one(db,"SELECT * FROM conversations WHERE channel='email'")
        with patch.object(T,'send_email',side_effect=lambda cfg,secret,recipient,mail:str(mail['Message-ID'])) as send:
            C.process_outbox(self.org);self.assertEqual(send.call_count,1);self.assertEqual(send.call_args.args[3]['Auto-Submitted'],'auto-generated')
            raw=send.call_args.args[3].as_bytes()
        with self.assertRaises(T.ChannelError):T.parse_email(raw,'support@example.com')
        self.ok(self.admin,'/api/conversations/'+conv['id']+'/ai-mode',{'mode':'human'})
        with D.tenant(self.org) as db:self.assertEqual(AI.conversation_state(db,conv['id'])['mode'],'human')

class OAuthTransportTests(unittest.TestCase):
    def test_xoauth2_sasl_and_tls_readonly(self):
        cfg={'auth_mode':'google','username':'test@gmail.com','smtp_port':465,'smtp_host':'smtp.gmail.com','imap_host':'imap.gmail.com'}
        with patch.object(T,'SafeSMTPSSL') as smtp:
            with T.smtp_session(cfg,{'auth_token':'token'}) as client:
                handler=client.auth.call_args.args[1];self.assertEqual(handler(),'user=test@gmail.com\x01auth=Bearer token\x01\x01');self.assertEqual(handler(b'error'),'')
            smtp.return_value.login.assert_not_called()
        with patch.object(T,'SafeIMAP') as imap:
            imap.return_value.select.return_value=('OK',[])
            with T.imap_session(cfg,{'auth_token':'token'}) as client:
                handler=client.authenticate.call_args.args[1];self.assertEqual(handler(b''),b'user=test@gmail.com\x01auth=Bearer token\x01\x01');self.assertEqual(handler(b'error'),b'')
            imap.return_value.select.assert_called_once_with('INBOX',readonly=True)
