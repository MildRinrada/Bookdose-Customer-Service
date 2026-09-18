"""Isolated HTTP + channel-worker tests. Providers are mocked; no external messages."""
import base64
import datetime as dt
from email.message import EmailMessage
import hashlib
import hmac
import io
import json
import socket
import smtplib
import unittest
from unittest.mock import patch, MagicMock
import urllib.error
import zipfile
import test_app as base
from test_app import app, D
from backend.extensions import channel_transport as T
from backend.modules.channels import service as C

BOT='U'+'a'*32
SENDER='U'+'b'*32

class ChannelTests(unittest.TestCase):
    setUp=base.IntegrationTests.setUp
    tearDown=base.IntegrationTests.tearDown
    ok=base.IntegrationTests.ok
    create_member=base.IntegrationTests.create_member

    def configure(self,kind='line',client=None,**changes):
        data={'team_id':self.team,'enabled':True}
        if kind=='line':data.update(channel_secret='secret-for-tests',access_token='token-for-tests')
        else:data.update(address='support@example.com',username='support@example.com',password='mail-password',imap_host='imap.example.com',smtp_host='smtp.example.com',smtp_port=465,poll_seconds=60)
        data.update(changes)
        with patch.object(T,'verify_line',return_value={'identity':BOT,'display_name':'Test OA'}),patch.object(T,'verify_email',return_value={'uidvalidity':'100','uidnext':5}):
            result=self.ok(client or self.admin,'/api/channels/'+kind,data,'PATCH')
        return next(c for c in result if c['kind']==kind)

    def webhook(self,route,events=None,signature=None,destination=BOT):
        payload={'destination':destination,'events':events if events is not None else [self.event()]}
        raw=json.dumps(payload).encode()
        sig=signature if signature is not None else base64.b64encode(hmac.new(b'secret-for-tests',raw,hashlib.sha256).digest()).decode()
        return self.admin.call('/api/webhooks/line/'+route,payload,headers={'X-Line-Signature':sig,'X-CSRF-Token':''})

    def event(self,key='event-1',**changes):
        event={'webhookEventId':key,'type':'message','timestamp':int(dt.datetime.now(dt.timezone.utc).timestamp()*1000),'source':{'type':'user','userId':SENDER},'message':{'id':'123','type':'text','text':'ขอความช่วยเหลือ'}}
        event.update(changes);return event

    def incoming_line(self):
        cfg=self.configure();self.assertEqual(self.webhook(cfg['route_id'])[0],200)
        self.assertTrue(C.process_line(self.org,app.store_message))
        with D.tenant(self.org) as db:return D.one(db,"SELECT * FROM conversations WHERE channel='line'")

    def reply(self,conv,**extra):
        return self.ok(self.admin,'/api/conversations/'+conv['id']+'/messages',{'body':'ตอบกลับที่ตรวจแล้ว','kind':'reply',**extra})['id']

    def job(self,mid):
        with D.tenant(self.org) as db:return D.one(db,'SELECT * FROM channel_outbox WHERE message_id=?',(mid,))

    def mail(self,sender='Customer <customer@example.net>',reference=None,mid='<incoming@example.net>',html=False):
        mail=EmailMessage();mail['From']=sender;mail['To']='support@example.com';mail['Subject']='ช่วยตรวจรายงาน';mail['Message-ID']=mid
        mail['Reply-To']='attacker@example.net'
        if reference:mail['In-Reply-To']=reference
        mail.set_content('<p>ช่วยตรวจข้อมูล</p><script>hidden</script>' if html else 'ช่วยตรวจข้อมูล',subtype='html' if html else 'plain')
        mail.add_attachment(b'%PDF-1.4 test',maintype='application',subtype='pdf',filename='test.pdf')
        return mail.as_bytes()

    def poll(self,messages,**extra):
        with D.tenant(self.org) as db:db.execute("UPDATE channel_settings SET next_poll=NULL WHERE kind='email'")
        with patch.object(T,'fetch_email',return_value={'uidvalidity':'100','uidnext':20,'reset':False,'messages':messages,**extra}):
            self.assertTrue(C.poll_email(self.org,app.store_message))

    def incoming_email(self):
        self.configure('email');self.poll([(5,self.mail())])
        with D.tenant(self.org) as db:return D.one(db,"SELECT * FROM conversations WHERE channel='email'")

    def test_signature_destination_dedup_and_group(self):
        cfg=self.configure();route=cfg['route_id']
        self.assertEqual(self.webhook(route,signature='invalid')[0],403)
        self.assertEqual(self.webhook(route,destination='U'+'c'*32)[0],400)
        self.assertEqual(self.webhook(route,events=[])[0],200)
        for _ in range(2):self.assertEqual(self.webhook(route)[0],200)
        C.process_line(self.org,app.store_message)
        self.assertFalse(C.process_line(self.org,app.store_message))
        self.assertEqual(self.webhook(route,[self.event('group',source={'type':'group','userId':SENDER})])[0],200)
        C.process_line(self.org,app.store_message)
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM conversations WHERE channel='line'").fetchone()[0],1)
            self.assertEqual(D.one(db,"SELECT status FROM channel_inbox WHERE event_key='group'")['status'],'ignored')

    def test_line_queue_accept_sla_and_notes_private(self):
        conv=self.incoming_line()
        ticket=self.ok(self.admin,'/api/conversations/'+conv['id']+'/ticket',{})
        mid=self.reply(conv)
        self.assertEqual(self.job(mid)['status'],'queued')
        with D.tenant(self.org) as db:self.assertIsNone(D.one(db,'SELECT first_response_at FROM tickets WHERE id=?',(ticket['id'],))['first_response_at'])
        self.reply(conv,kind='note',body='PRIVATE-DO-NOT-SEND')
        with patch.object(T,'send_line',return_value='provider-id') as send:
            C.process_outbox(self.org);self.assertEqual(send.call_count,1)
            self.assertEqual(send.call_args.args[1:3],(SENDER,'ตอบกลับที่ตรวจแล้ว'))
            self.assertFalse(C.process_outbox(self.org))
        self.assertEqual(self.job(mid)['status'],'accepted')
        with D.tenant(self.org) as db:self.assertIsNotNone(D.one(db,'SELECT first_response_at FROM tickets WHERE id=?',(ticket['id'],))['first_response_at'])
        data=self.ok(self.admin,'/api/conversations/'+conv['id'])
        self.assertIsNotNone(next(m for m in data['messages'] if m['id']==mid)['channel_delivery'])

    def test_line_text_limits_and_media(self):
        conv=self.incoming_line()
        path='/api/conversations/'+conv['id']+'/messages'
        for data in ({'body':'😀'*2501},{'body':'text','attachments':[{'name':'a.txt','data':'YQ=='}]}):
            self.assertEqual(self.admin.call(path,{'kind':'reply',**data})[0],400)
        cfg=next(c for c in self.ok(self.admin,'/api/channels') if c['kind']=='line')
        self.webhook(cfg['route_id'],[self.event('image',message={'id':'124','type':'image'})])
        with patch.object(T,'line_media',return_value=T.valid_attachment('pic.png',b'\x89PNG\r\n\x1a\nDATA')):
            C.process_line(self.org,app.store_message)
        data=self.ok(self.admin,'/api/conversations/'+conv['id'])
        self.assertEqual(len(data['messages'][-1]['attachments']),1)
        self.webhook(cfg['route_id'],[self.event('video',message={'id':'125','type':'video'})])
        content=b'\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom'
        with patch.object(T,'line_request',return_value=(content,'video/mp4',None)):
            C.process_line(self.org,app.store_message)
        media=self.ok(self.admin,'/api/conversations/'+conv['id'])['messages'][-1]['attachments'][0]
        self.assertEqual((media['name'],media['mime']),('video.mp4','video/mp4'))

    def test_line_late_event_does_not_reopen(self):
        conv=self.incoming_line();self.ok(self.admin,'/api/conversations/'+conv['id'],{'status':'closed'},'PATCH')
        cfg=next(c for c in self.ok(self.admin,'/api/channels') if c['kind']=='line')
        self.webhook(cfg['route_id'],[self.event('late',timestamp=1000000000000)])
        C.process_line(self.org,app.store_message)
        self.assertEqual(self.ok(self.admin,'/api/conversations/'+conv['id'])['conversation']['status'],'closed')

    def test_retry_uses_same_line_key_and_expires(self):
        conv=self.incoming_line();mid=self.reply(conv)
        with patch.object(T,'send_line',side_effect=T.ChannelError('network',retryable=True)) as send:
            C.process_outbox(self.org);first=send.call_args.args[-1]
        self.assertEqual(self.job(mid)['status'],'queued')
        with D.tenant(self.org) as db:db.execute('UPDATE channel_outbox SET next_attempt_at=NULL')
        with patch.object(T,'send_line',return_value='accepted') as send:
            C.process_outbox(self.org);self.assertEqual(first,send.call_args.args[-1])
        self.assertEqual(self.admin.call('/api/messages/'+mid+'/retry',{})[0],400)
        mid=self.reply(conv)
        with D.tenant(self.org) as db:db.execute('UPDATE channel_outbox SET first_attempt_at=? WHERE message_id=?',((dt.datetime.now(dt.timezone.utc)-dt.timedelta(hours=24)).isoformat(),mid))
        with patch.object(T,'send_line') as send:C.process_outbox(self.org);send.assert_not_called()
        self.assertEqual(self.job(mid)['status'],'unknown')

    def test_config_change_cancels_queue_and_revocation_blocks_send(self):
        conv=self.incoming_line();mid=self.reply(conv)
        self.configure(enabled=False)
        self.assertEqual(self.job(mid)['status'],'failed')
        self.assertEqual(self.admin.call('/api/conversations/'+conv['id']+'/messages',{'body':'x'})[0],503)
        self.configure()
        self.ok(self.admin,'/api/messages/'+mid+'/retry',{})
        with D.control() as db:db.execute('UPDATE memberships SET active=0 WHERE user_id=?',(self.boot['user']['id'],))
        with patch.object(T,'send_line') as send:C.process_outbox(self.org);send.assert_not_called()
        self.assertEqual(self.job(mid)['status'],'failed')

    def test_secrets_permissions_and_backup(self):
        self.configure();self.configure('email')
        result=json.dumps(self.ok(self.admin,'/api/channels'))
        for value in ('secret-for-tests','token-for-tests','mail-password'):self.assertNotIn(value,result)
        for file in (D.DATA/'secrets').iterdir():self.assertEqual(file.stat().st_mode&0o777,0o600)
        base.assert_sealed_backup(self,app.make_backup(),'secret-for-tests','token-for-tests','mail-password')
        member=self.create_member(team=self.team,email='limited@example.com')
        client=base.Client(self.base);client.login('limited@example.com')
        self.assertEqual(client.call('/api/channels')[0],403)
        self.assertEqual(client.call('/api/channels/line',{'enabled':False},'PATCH')[0],403)

    def test_tenant_routes_account_binding_and_suspend(self):
        conv=self.incoming_line();mid=self.reply(conv)
        original=self.org
        route=next(c for c in self.ok(self.admin,'/api/channels') if c['kind']=='line')['route_id']
        second=self.ok(self.admin,'/api/platform/tenants',{'name':'Second','slug':'second','email':'admin@example.com'})['id']
        self.admin.switch(second)
        self.assertEqual(self.admin.call('/api/conversations/'+conv['id'])[0],404)
        self.assertEqual(self.admin.call('/api/messages/'+mid+'/retry',{})[0],404)
        team=self.ok(self.admin,'/api/workspace')['team_id']
        with patch.object(T,'verify_line',return_value={'identity':BOT,'display_name':'Test OA'}):
            self.assertEqual(self.admin.call('/api/channels/line',{'enabled':True,'team_id':team,'channel_secret':'secret-for-tests','access_token':'token'},'PATCH')[0],400)
        for row in self.ok(self.admin,'/api/channels'):self.assertFalse(row['credentials_configured'])
        self.admin.switch(original)
        # The platform's own organization cannot be suspended on screen; what matters here is the state itself.
        with D.control() as cd:
            cd.execute("UPDATE tenants SET status='suspended' WHERE id=?",(original,))
            cd.commit()
        self.assertEqual(self.webhook(route)[0],503)
        with patch.object(T,'send_line') as send:C.process_outbox(original);send.assert_not_called()
        self.assertEqual(self.job(mid)['status'],'failed')

    def test_mail_baseline_dedup_and_safe_html(self):
        self.configure('email')
        with D.tenant(self.org) as db:self.assertEqual(C.setting(db,'email')['last_uid'],4)
        raw=self.mail(html=True);self.poll([(5,raw),(6,raw),(7,None)])
        with D.tenant(self.org) as db:
            conv=D.one(db,"SELECT * FROM conversations WHERE channel='email'")
            self.assertEqual(db.execute("SELECT COUNT(*) FROM conversations WHERE channel='email'").fetchone()[0],1)
            message=D.one(db,'SELECT * FROM messages WHERE conversation_id=?',(conv['id'],))
            self.assertNotIn('hidden',message['body']);self.assertIn('ช่วยตรวจข้อมูล',message['body'])
            self.assertEqual(C.setting(db,'email')['last_uid'],7)
        self.poll([],reset=True,uidvalidity='101',uidnext=50)
        with D.tenant(self.org) as db:self.assertEqual(C.setting(db,'email')['last_uid'],49)

    def test_email_reply_only_authored_content_and_recipient(self):
        conv=self.incoming_email();self.reply(conv,kind='note',body='PRIVATE-CUSTOMER-NOTES')
        mid=self.reply(conv,attachments=[{'name':'reply.txt','data':base64.b64encode(b'reply attachment').decode()}])
        with patch.object(T,'send_email',return_value=self.job(mid)['provider_id']) as send:
            C.process_outbox(self.org);args=send.call_args.args
            self.assertEqual(args[2],'customer@example.net')
            mail=args[3];self.assertNotIn('PRIVATE-CUSTOMER-NOTES',mail.as_string())
            self.assertEqual(str(mail['To']),'customer@example.net')
            self.assertIsNone(mail['Cc']);self.assertIsNone(mail['Bcc']);self.assertIsNone(mail['Reply-To'])
            self.assertEqual(len(list(mail.iter_attachments())),1)
        self.assertEqual(self.job(mid)['status'],'accepted')

    def test_email_threads_require_opaque_reference_and_same_sender(self):
        conv=self.incoming_email();mid=self.reply(conv);ref=self.job(mid)['provider_id']
        self.poll([(6,self.mail(reference=ref,mid='<second@customer.net>'))])
        self.poll([(7,self.mail(sender='other@example.net',reference=ref,mid='<third@customer.net>'))])
        self.poll([(8,self.mail(mid='<fourth@customer.net>'))])
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM conversations WHERE channel='email'").fetchone()[0],3)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM messages WHERE conversation_id=? AND kind='customer'",(conv['id'],)).fetchone()[0],2)

    def test_smtp_unknown_never_auto_or_manual_retry(self):
        conv=self.incoming_email();mid=self.reply(conv)
        with patch.object(T,'send_email',side_effect=T.ChannelError('unknown',uncertain=True)) as send:
            C.process_outbox(self.org);self.assertFalse(C.process_outbox(self.org));self.assertEqual(send.call_count,1)
        self.assertEqual(self.job(mid)['status'],'unknown')
        self.assertEqual(self.admin.call('/api/messages/'+mid+'/retry',{})[0],400)
        stale=self.reply(conv)
        with D.tenant(self.org) as db:db.execute("UPDATE channel_outbox SET status='sending',updated_at='2000-01-01T00:00:00+00:00' WHERE message_id=?",(stale,))
        with patch.object(T,'send_email') as send:C.process_outbox(self.org);send.assert_not_called()
        self.assertEqual(self.job(stale)['status'],'unknown')

class TransportTests(unittest.TestCase):
    def test_public_hosts_only(self):
        for address in ('127.0.0.1','10.0.0.1','169.254.169.254','::1'):
            with patch.object(socket,'getaddrinfo',return_value=[(socket.AF_INET,socket.SOCK_STREAM,6,'',(address,465))]),patch.object(socket,'socket') as sock:
                with self.assertRaises(T.ChannelError) as raised:T.public_socket('host',465)
                self.assertEqual(raised.exception.code,'host');sock.assert_not_called()

    def test_line_409_accepted_and_retry_header(self):
        error=urllib.error.HTTPError('https://api.line.me',409,'duplicate',{'x-line-accepted-request-id':'accepted-id'},io.BytesIO(b'{}'))
        opener=MagicMock();opener.open.side_effect=error
        with patch.object(T.urllib.request,'build_opener',return_value=opener):
            self.assertEqual(T.send_line({'access_token':'private'},SENDER,'hello','stable-uuid'),'accepted-id')
        request=opener.open.call_args.args[0]
        self.assertEqual(request.get_header('X-line-retry-key'),'stable-uuid')
        self.assertEqual(json.loads(request.data)['to'],SENDER)

    def test_smtp_negative_ack_vs_lost_ack(self):
        cfg={'address':'support@example.com'}
        for error,uncertain,retryable in ((smtplib.SMTPDataError(451,b'try again'),False,True),(smtplib.SMTPDataError(550,b'no'),False,False),(smtplib.SMTPServerDisconnected(),True,False)):
            client=MagicMock();client.send_message.side_effect=error
            context=MagicMock();context.__enter__.return_value=client
            with patch.object(T,'smtp_session',return_value=context):
                with self.assertRaises(T.ChannelError) as raised:T.send_email(cfg,{},'recipient@example.com',EmailMessage())
            self.assertEqual(raised.exception.uncertain,uncertain);self.assertEqual(raised.exception.retryable,retryable)

    def test_imap_uses_uid_and_peek_skips_old_and_oversize(self):
        client=MagicMock();client.status.return_value=('OK',[b'INBOX (UIDVALIDITY 100 UIDNEXT 8)'])
        client.uid.side_effect=[('OK',[b'4 5 6']),('OK',[b'1 (UID 5 RFC822.SIZE 12)']),('OK',[(b'BODY[]',b'example mail')]),('OK',[b'2 (UID 6 RFC822.SIZE 999999999)'])]
        context=MagicMock();context.__enter__.return_value=client
        with patch.object(T,'imap_session',return_value=context):batch=T.fetch_email({}, {}, {'last_uid':4,'uidvalidity':'100'})
        self.assertEqual(batch['messages'],[(5,b'example mail'),(6,None)])
        self.assertEqual(client.uid.call_args_list[0].args,('search',None,'UID 5:*'))
        self.assertEqual(client.uid.call_args_list[2].args,('fetch','5','(BODY.PEEK[])'))

    def test_auto_responses_ignored(self):
        for header,value in (('Auto-Submitted','auto-replied'),('Precedence','bulk')):
            mail=EmailMessage();mail['From']='customer@example.net';mail[header]=value;mail.set_content('auto')
            with self.assertRaises(T.ChannelError):T.parse_email(mail.as_bytes(),'support@example.com')
