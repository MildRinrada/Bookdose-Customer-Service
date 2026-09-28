"""Guest web chat: chatting with an organization without an account. The browser's cookie (reuse, forget, remembered
or not, the form inside another website's frame), CSRF, ownership, spam limits, follow links by email and SMS (sent,
opened on a second device, revoked, used up, expired), LINE codes, reply notices only to proven channels once per
unread spell, moving the history into an account (a claim, or on its own by a verified email), the switches and
widget settings, the staff side, and organizations kept apart. Email, SMS and LINE are mocked; nothing leaves."""
import json
import re
import time
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

import test_app as base
import test_channels as channel_tests
from test_app import app, Client, D, rate_limit
from backend.extensions import channel_transport as T, sms
from backend.modules.channels import service as C
from backend.modules.guest import schema, service as guest

ORG = '/api/public/alpha'
GUEST = ORG+'/guest'
SENDER = channel_tests.SENDER
PASSWORD = 'Customer-pass-123'


class GuestClient(Client):
    """A browser on the public chat page: the guest cookie lives in the jar, the CSRF token in guest_csrf."""
    def __init__(self, base_url):
        super().__init__(base_url)
        self.guest_csrf = ''

    def raw(self, path, body=None, method=None, headers=None):
        """(status, data, response headers)."""
        hs = {'X-Conversation-ID':self.conversation,'X-Guest-CSRF':self.guest_csrf,'X-Customer-CSRF':self.customer_csrf}
        if body is not None:
            hs['Content-Type'] = 'application/json'
        hs.update(headers or {})
        request = urllib.request.Request(self.base+path,data=None if body is None else json.dumps(body).encode(),headers=hs,
                                         method=method or ('GET' if body is None else 'POST'))
        try:
            response = self.opener.open(request,timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            data = response.read()
            payload = json.loads(data) if 'application/json' in response.headers.get('Content-Type','') else data
            return response.status,payload,response.headers

    def call(self, path, body=None, method=None, headers=None):
        return self.raw(path,body,method,headers)[:2]

    def cookie(self, name='g_alpha'):
        return next((c.value for c in self.jar if c.name==name),None)


class GuestChatTests(unittest.TestCase):
    tearDown = base.IntegrationTests.tearDown
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    customer = base.IntegrationTests.customer
    create_member = base.IntegrationTests.create_member
    CUSTOMER_PASSWORD = PASSWORD
    configure = channel_tests.ChannelTests.configure
    webhook = channel_tests.ChannelTests.webhook
    event = channel_tests.ChannelTests.event

    def setUp(self):
        base.IntegrationTests.setUp(self)
        self.line = patch.object(T,'send_line',return_value='line-request-id').start()
        self.addCleanup(patch.stopall)
        self.events = 0

    # Helpers
    def ok(self, client, path, body=None, method=None):
        rate_limit.RATES.clear()
        return base.IntegrationTests.ok(self,client,path,body,method)

    def status(self, client, path, body=None, method=None, headers=None):
        rate_limit.RATES.clear()
        return client.call(path,body,method,headers)[0]

    def browser(self):
        return GuestClient(self.base)

    def start(self, client, clear=True, **changes):
        """POST a new chat from the public page; on success the client follows it. (status, data, headers)."""
        if clear:
            rate_limit.RATES.clear()
        form = {'body':'สอบถามเวลาทำการค่ะ','subject':'','category':'','name':'','remember':True,'website':'',
                'started_ms':int(time.time()*1000)-5000,'attachments':[],**changes}
        status,data,headers = client.raw(GUEST+'/conversations',form)
        if status==201:
            client.guest_csrf,client.conversation = data['csrf'],data['id']
        return status,data,headers

    def started(self, client, **changes):
        status,data,_ = self.start(client,**changes)
        self.assertEqual(status,201,data)
        return data['id']

    def reply(self, conv, text='ตอบแล้วค่ะ'):
        self.ok(self.admin,f'/api/conversations/{conv}/messages',{'kind':'reply','body':text})

    def overview(self, client):
        return self.ok(client,GUEST)

    def notices(self):
        with D.tenant(self.org) as db:
            return D.rows(db,'SELECT * FROM guest_notifications ORDER BY rowid')

    def age_notices(self):
        with D.tenant(self.org) as db:
            db.execute("UPDATE guest_notifications SET created_at='2000-01-01T00:00:00+00:00' WHERE sent_at IS NULL")
            db.execute("UPDATE guest_seen SET seen_at='1999-01-01T00:00:00+00:00'")

    def unseen(self):
        """Timestamps have one-second precision: what the guest read counts as read before the next reply."""
        with D.tenant(self.org) as db:
            db.execute("UPDATE guest_seen SET seen_at='1999-01-01T00:00:00+00:00'")

    def send_link(self, client, via='email', to='somsri@example.com'):
        rate_limit.RATES.clear()
        status,data = client.call(GUEST+'/link',{'via':via,'to':to})
        self.assertEqual(status,202,data)
        return data

    def emailed_token(self, index=-1):
        return re.search(r'/support/alpha/resume#t=([A-Za-z0-9_-]{43})',self.mailer.call_args_list[index].args[3].get_content())[1]

    def resume(self, token, client=None, **body):
        """Open a follow link, as the resume page does: a browser that already holds a guest cookie reads its CSRF
        token from GET /guest first, because opening a link may change what this browser follows."""
        client = client or self.browser()
        rate_limit.RATES.clear()
        if len(client.jar):
            known = self.ok(client,GUEST)
            client.guest_csrf = (known.get('guest') or {}).get('csrf') or client.guest_csrf
        return client,client.call(GUEST+'/resume',{'token':token,**body})

    def say(self, text, sender=SENDER):
        self.events += 1
        source = {'type':'user','userId':sender}
        self.assertEqual(self.webhook(self.route,[self.event(f'event-{self.events}',source=source,
                                                             message={'id':str(self.events),'type':'text','text':text})])[0],200)
        self.assertTrue(C.process_line(self.org,app.store_message))

    # Tests
    def test_start_with_addresses_and_a_reference(self):
        page = self.browser()
        # Not remembered and nowhere to send the link: the chat would be lost, so it is refused.
        status,data,_ = self.start(page,remember=False)
        self.assertEqual(status,400);self.assertIn('จำแชท',data['error'])
        # An address the platform cannot send to yet is refused too (the page hides that field).
        self.assertEqual(self.start(page,email='somsri@example.com')[0],409)
        self.assertEqual(self.start(page,phone='0812345678')[0],409)
        self.customer_mail()
        self.ok(self.owner,'/api/platform/sms',{'provider':'log'})
        for bad in ({'email':'not-an-email'},{'phone':'12'},{'reference':'x'*61},{'email':5}):
            self.assertEqual(self.start(page,**bad)[0],400,bad)
        # Both given: the follow link goes both ways; the reference reaches the team.
        with patch.object(sms,'_log') as logged:
            status,data,_ = self.start(page,remember=False,email='Somsri@Example.com',phone='081-234-5678',reference='BD-1001')
        self.assertEqual(status,201,data)
        self.assertEqual([(l['via'],l['sent']) for l in data['links']],[('email',True),('sms',True)])
        self.assertEqual(self.mailer.call_args.args[2],'somsri@example.com')
        self.assertIn('/support/alpha/resume#t=',logged.call_args.args[0])
        self.assertEqual(self.ok(self.admin,f"/api/conversations/{data['id']}")['conversation']['reference'],'BD-1001')
        other,(status,_) = self.resume(self.emailed_token())
        self.assertEqual(status,200)
        self.assertEqual([c['id'] for c in self.overview(other)['conversations']],[data['id']])
        # Without an address the chat is remembered as before, and no link is sent.
        status,data,_ = self.start(self.browser())
        self.assertEqual((status,data['links']),(201,[]))
        # Which organizations take chats is never listed to the public: a visitor comes in by the organization's link.
        self.assertIn(self.status(self.browser(),'/api/customer/guest-orgs'),(401,404))

    def test_start_without_an_account_then_follow_in_this_browser_and_forget(self):
        page = self.browser()
        first = self.overview(page)
        self.assertIsNone(first['guest'])
        self.assertEqual((first['conversations'],first['organization']),([],{'name':'องค์กร A','slug':'alpha','logo':''}))
        self.assertEqual(first['follow'],{'email_ready':False,'sms_ready':False,'line_ready':False,'line_oa_name':'','line_add_url':''})
        self.assertIn('สอบถามบริการ',first['categories'])
        status,data,headers = self.start(page,name='สมศรี',category='สอบถามบริการ')
        self.assertEqual(status,201,data)
        cookie = headers['Set-Cookie']
        self.assertRegex(cookie,r'^g_alpha=[A-Za-z0-9_-]{43}; HttpOnly; Path=/api/; SameSite=Lax; Max-Age=34560000$')
        conv = data['id']
        me = self.overview(page)
        self.assertEqual((me['guest']['name'],me['guest']['csrf'],me['guest']['remember'],me['guest']['email_masked']),('สมศรี',data['csrf'],True,''))
        self.assertEqual([(c['id'],c['unread'],c['survey_pending']) for c in me['conversations']],[(conv,False,False)])
        session = self.ok(page,GUEST+'/session')
        self.assertEqual((session['conversation']['subject'],session['messages'][0]['body']),('สอบถามเวลาทำการค่ะ','สอบถามเวลาทำการค่ะ'))
        self.ok(page,GUEST+'/messages',{'body':'ขอเบอร์ติดต่อด้วยค่ะ'})
        self.ok(page,GUEST+'/handoff',{})
        # The team sees a guest: its own contact, a badge and how a reply can reach it.
        detail = self.ok(self.admin,f'/api/conversations/{conv}')
        self.assertEqual((detail['contact']['created_by'],detail['contact']['name'],detail['conversation']['category']),('guest','สมศรี','สอบถามบริการ'))
        self.assertEqual((detail['conversation']['guest'],detail['contact']['guest']),({'follow':['browser']},{'follow':['browser']}))
        row = next(c for c in self.ok(self.admin,'/api/conversations')['conversations'] if c['id']==conv)
        self.assertEqual(row['guest'],{'follow':['browser']})
        contact = next(c for c in self.ok(self.admin,'/api/contacts')['contacts'] if c['id']==detail['contact']['id'])
        self.assertEqual(contact['guest'],{'follow':['browser']})
        self.assertTrue(any(c['guest'] is None for c in self.ok(self.admin,'/api/contacts')['contacts']))
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM audit_logs WHERE action='guest.started' AND entity=?",(conv,)).fetchone()[0],1)
        # The same browser starts a second chat as the same guest (no new cookie); a reply shows as unread until read.
        status,second,headers = self.start(page)
        self.assertEqual((status,headers.get('Set-Cookie')),(201,None))
        self.assertEqual(second['csrf'],data['csrf'])
        self.unseen()
        self.reply(conv)
        listed = {c['id']:c for c in self.overview(page)['conversations']}
        self.assertEqual((set(listed),listed[conv]['unread'],listed[second['id']]['unread']),({conv,second['id']},True,False))
        page.conversation = conv
        self.ok(page,GUEST+'/session')
        self.assertFalse({c['id']:c for c in self.overview(page)['conversations']}[conv]['unread'])
        # Forgetting this browser: the cookie is cleared and the chats are no longer reachable from it.
        status,_,headers = page.raw(GUEST+'/forget',{})
        self.assertEqual(status,200)
        self.assertIn('Max-Age=0',headers['Set-Cookie'])
        self.assertIsNone(page.cookie())
        self.assertIsNone(self.overview(page)['guest'])
        self.assertEqual(self.status(page,GUEST+'/session'),401)
        self.assertEqual(self.ok(self.admin,f'/api/conversations/{conv}')['conversation']['guest'],{'follow':[]})

    def test_remember_switch_embed_cookie_refresh_and_unknown_cookie(self):
        page = self.browser()
        # Not remembered: a follow link must go somewhere (test_start_with_addresses_…).
        self.customer_mail()
        status,data,headers = self.start(page,remember=False,email='somsri@example.com')
        self.assertEqual(status,201)
        self.assertNotIn('Max-Age',headers['Set-Cookie'])
        self.assertFalse(self.overview(page)['guest']['remember'])
        status,answer,headers = page.raw(GUEST+'/remember',{'remember':True})
        self.assertEqual((status,answer),(200,{'ok':True,'remember':True}))
        self.assertIn('Max-Age=34560000',headers['Set-Cookie'])
        self.assertTrue(self.overview(page)['guest']['remember'])
        self.assertEqual(self.status(page,GUEST+'/remember',{'remember':'yes'}),400)
        status,_,headers = page.raw(GUEST+'/remember',{'remember':False})
        self.assertNotIn('Max-Age',headers['Set-Cookie'])
        # Inside the widget's frame on another website (HTTPS): SameSite=None; Secure; Partitioned.
        self.server.secure_cookies = True
        embed = self.browser()
        rate_limit.RATES.clear()
        form = {'body':'จากปุ่มแชทบนเว็บ','website':'','started_ms':int(time.time()*1000)-5000}
        status,_,headers = embed.raw(GUEST+'/conversations',form,headers={'X-Embed':'1'})
        self.assertEqual(status,201)
        self.assertRegex(headers['Set-Cookie'],r'^g_alpha=[A-Za-z0-9_-]{43}; HttpOnly; Path=/api/; SameSite=None; Secure; Partitioned; Max-Age=34560000$')
        rate_limit.RATES.clear()
        status,_,headers = self.browser().raw(GUEST+'/conversations',form)
        self.assertIn('SameSite=Lax; Secure;',headers['Set-Cookie'])
        self.server.secure_cookies = False
        # A remembered cookie is sent again once a day while it is used.
        self.ok(page,GUEST+'/remember',{'remember':True})
        _,_,headers = page.raw(GUEST)
        self.assertIsNone(headers.get('Set-Cookie'))
        with D.tenant(self.org) as db:
            db.execute("UPDATE guest_devices SET last_seen_at='2000-01-01T00:00:00+00:00'")
        _,_,headers = page.raw(GUEST)
        self.assertIn('Max-Age=34560000',headers['Set-Cookie'])
        _,_,headers = page.raw(GUEST)
        self.assertIsNone(headers.get('Set-Cookie'))
        # An unknown or malformed cookie is no guest, and the answer clears it.
        for value in ('A'*43,'not-a-token'):
            stranger = self.browser()
            status,data,headers = stranger.raw(GUEST,headers={'Cookie':f'g_alpha={value}'})
            self.assertEqual((status,data['guest']),(200,None))
            self.assertIn('g_alpha=; HttpOnly; Path=/api/; SameSite=Lax; Max-Age=0',headers['Set-Cookie'])
            status,_,headers = stranger.raw(GUEST+'/session',headers={'Cookie':f'g_alpha={value}'})
            self.assertEqual(status,401)
            self.assertIn('Max-Age=0',headers['Set-Cookie'])

    def test_changes_need_the_guest_csrf_token(self):
        page = self.browser()
        conv = self.started(page)
        csrf,page.guest_csrf = page.guest_csrf,''
        self.assertEqual(self.status(page,GUEST+'/messages',{'body':'ไม่มีโทเคน'}),403)
        self.assertEqual(self.status(page,GUEST+'/messages',{'body':'โทเคนผิด'},headers={'X-Guest-CSRF':'x'*32}),403)
        self.assertEqual(self.status(page,GUEST+'/forget',{}),403)
        # A new chat without the token must not replace this browser's guest (its chats would be lost).
        status,_,headers = self.start(page)
        self.assertEqual((status,headers.get('Set-Cookie')),(403,None))
        # Reading needs no token; with the token changes go through, and the cookie is still the same guest.
        self.assertEqual(self.ok(page,GUEST+'/session')['conversation']['id'],conv)
        page.guest_csrf = csrf
        self.ok(page,GUEST+'/messages',{'body':'มีโทเคนแล้ว'})
        self.assertEqual(len(self.overview(page)['conversations']),1)
        # Another website's page cannot send it either (the Origin check stays).
        self.assertEqual(self.status(page,GUEST+'/messages',{'body':'x'},headers={'Origin':'https://evil.example'}),403)

    def test_another_visitors_conversation_is_not_found(self):
        owner,other = self.browser(),self.browser()
        conv = self.started(owner,attachments=[{'name':'note.txt','data':'SGVsbG8='}])
        self.started(other)
        file_id = self.ok(owner,GUEST+'/session')['messages'][0]['attachments'][0]['id']
        self.assertEqual(self.ok(owner,GUEST+f'/attachments/{file_id}'),b'Hello')
        case = self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']
        self.assertEqual(self.ok(owner,GUEST+f'/cases/{case}')['conversations'][0]['id'],conv)
        other.conversation = conv
        for path,body in ((GUEST+'/session',None),(GUEST+'/messages',{'body':'แอบส่ง'}),(GUEST+'/csat',{'rating':5}),
                          (GUEST+'/handoff',{}),(GUEST+f'/attachments/{file_id}',None),(GUEST+f'/cases/{case}',None)):
            self.assertEqual(self.status(other,path,body),404,path)
        other.conversation = 'not-an-id'
        self.assertEqual(self.status(other,GUEST+'/session'),404)
        # A signed-in customer's chat is not a guest's, and a guest's chat is not the customer's.
        customer = self.customer()
        customer.conversation = self.ok(customer,ORG+'/conversations',{'subject':'บัญชี','body':'ของสมาชิก'})['id']
        other.conversation = customer.conversation
        self.assertEqual(self.status(other,GUEST+'/session'),404)
        customer.conversation = conv
        self.assertEqual(self.status(customer,ORG+'/session'),404)
        self.assertNotIn(conv,[c['id'] for c in self.ok(customer,'/api/customer/overview')['conversations']])

    def test_honeypot_timing_and_rate_limits(self):
        page = self.browser()
        for changes in ({'website':'http://spam.example'},{'started_ms':int(time.time()*1000)},{'started_ms':None},{'started_ms':'5'}):
            status,data,headers = self.start(page,**changes)
            self.assertEqual((status,data['error'],headers.get('Set-Cookie')),(400,'ส่งข้อความไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',None),changes)
        self.assertEqual(self.start(page,body='')[0],400)
        self.assertEqual(self.start(page,category='ไม่มีหมวดนี้')[0],400)
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM guest_visitors').fetchone()[0],0)
        # 5 new chats an hour from one address.
        rate_limit.RATES.clear()
        for n in range(5):
            self.assertEqual(self.start(self.browser(),clear=False)[0],201,n)
        self.assertEqual(self.start(self.browser(),clear=False)[0],429)
        # 10 a day per guest, whatever the address.
        for n in range(9):
            self.assertEqual(self.start(page)[0],201,n)
        self.assertEqual(self.start(page)[0],201)
        self.assertEqual(self.start(page)[0],429)
        # Messages in a chat use the support page's limits (30 changes a minute per address).
        rate_limit.RATES.clear()
        statuses = [page.call(GUEST+'/messages',{'body':f'ข้อความ {n}'})[0] for n in range(31)]
        self.assertEqual((statuses.count(201),statuses[-1]),(30,429))

    def test_email_link_opened_on_a_second_device_proves_the_email(self):
        page = self.browser()
        conv = self.started(page,body='ลืมรหัสผ่านค่ะ')
        self.assertEqual(self.status(page,GUEST+'/link',{'via':'email','to':'somsri@example.com'}),409)   # no mailbox yet
        self.customer_mail()
        self.assertTrue(self.overview(page)['follow']['email_ready'])
        self.assertEqual(self.status(page,GUEST+'/link',{'via':'email','to':'not-an-email'}),400)
        self.assertEqual(self.status(page,GUEST+'/link',{'via':'fax','to':'x'}),400)
        self.assertEqual(self.send_link(page),{'sent':True,'to_masked':'s***@example.com'})
        mail = self.mailer.call_args.args[3]
        self.assertEqual(self.mailer.call_args.args[2],'somsri@example.com')
        text = mail.get_content()
        self.assertIn('องค์กร A',mail['Subject']+text)
        self.assertNotIn('ลืมรหัสผ่านค่ะ',text)
        self.assertNotRegex(text,r'\?[^\n]*t=')
        token = self.emailed_token()
        # Sent, not proven yet: the page shows where it went.
        me = self.overview(page)['guest']
        self.assertEqual((me['email_masked'],me['email_verified']),('s***@example.com',False))
        # Opened on a phone: a new browser follows the same chats, remembered, and the email is proven.
        phone,(status,answer) = self.resume(token)
        self.assertEqual((status,answer),(200,{'ok':True,'conversation_id':conv}))
        self.assertTrue(phone.cookie())
        self.assertNotEqual(phone.cookie(),page.cookie())
        other = self.overview(phone)
        self.assertEqual(([c['id'] for c in other['conversations']],other['guest']['email_verified'],other['guest']['remember']),([conv],True,True))
        phone.guest_csrf,phone.conversation = other['guest']['csrf'],conv
        self.ok(phone,GUEST+'/messages',{'body':'ส่งจากมือถือ'})
        self.assertEqual(len(self.ok(page,GUEST+'/session')['messages']),2)
        self.assertEqual(self.ok(self.admin,f'/api/conversations/{conv}')['conversation']['guest'],{'follow':['browser','email']})
        with D.tenant(self.org) as db:
            logged = ' '.join(f"{r[0]} {r[1]}" for r in db.execute("SELECT action,detail FROM audit_logs WHERE action LIKE 'guest.%'"))
        self.assertIn('guest.link_sent email s***@example.com',logged)
        self.assertIn('guest.resumed email s***@example.com',logged)
        self.assertNotIn(token,logged)
        with D.control() as cd:
            self.assertEqual(cd.execute('SELECT email FROM guest_verified_emails').fetchall()[0][0],'somsri@example.com')
        # A malformed token is refused; one that does not exist is gone.
        self.assertEqual(self.resume('short')[1][0],400)
        self.assertEqual(self.resume('A'*43)[1],(410,{'error':'ลิงก์หมดอายุ ขอลิงก์ใหม่จากแชทเดิม หรือเริ่มแชทใหม่'}))

    def test_sms_is_hidden_while_off_and_the_log_provider_sends(self):
        page = self.browser()
        self.started(page)
        self.assertFalse(self.overview(page)['follow']['sms_ready'])
        self.assertEqual(self.status(page,GUEST+'/link',{'via':'sms','to':'081-234-5678'}),409)
        agent,_ = self.create_member()
        self.assertEqual(self.status(agent,'/api/platform/sms'),403)
        self.assertEqual(self.ok(self.owner,'/api/platform/sms')['provider'],'off')
        self.assertEqual(self.status(self.owner,'/api/platform/sms',{'provider':'twilio'}),400)
        self.assertEqual(self.ok(self.owner,'/api/platform/sms',{'provider':'log'})['provider'],'log')
        self.assertTrue(self.overview(page)['follow']['sms_ready'])
        for bad in ('call me','12345','+660812345678','02-12'):
            self.assertEqual(self.status(page,GUEST+'/link',{'via':'sms','to':bad}),400,bad)
        with patch.object(sms,'_log') as logged:
            self.assertEqual(self.send_link(page,'sms','081-234-5678'),{'sent':True,'to_masked':'+66*****5678'})
        line = logged.call_args.args[0]
        self.assertIn('+66812345678',line)
        self.assertIn('องค์กร A',line)
        token = re.search(r'/support/alpha/resume#t=([A-Za-z0-9_-]{43})',line)[1]
        phone,(status,_) = self.resume(token)
        self.assertEqual(status,200)
        me = self.overview(phone)['guest']
        self.assertEqual((me['phone_masked'],me['phone_verified'],me['email_verified']),('+66*****5678',True,False))
        # Switched off again, the option disappears.
        self.ok(self.owner,'/api/platform/sms',{'provider':'off'})
        self.assertFalse(self.overview(page)['follow']['sms_ready'])

    def test_links_are_revoked_by_a_newer_one_and_end_after_20_uses_or_30_days(self):
        self.customer_mail()
        page = self.browser()
        self.started(page)
        self.send_link(page)
        older = self.emailed_token()
        self.send_link(page,to='other@example.com')
        newer = self.emailed_token()
        self.assertEqual(self.resume(older)[1][0],410)
        client,(status,_) = self.resume(newer)
        self.assertEqual(status,200)
        # The same browser opening its link again stays one device.
        self.assertEqual(self.resume(newer,client)[1][0],200)
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM guest_devices').fetchone()[0],2)
            self.assertEqual(db.execute("SELECT expires_at>datetime('now','+29 days') FROM guest_links WHERE revoked_at IS NULL").fetchone()[0],1)
            db.execute('UPDATE guest_links SET uses=19 WHERE revoked_at IS NULL')
        self.assertEqual(self.resume(newer)[1][0],200)        # the 20th use
        self.assertEqual(self.resume(newer)[1][0],410)
        self.send_link(page,to='third@example.com')
        latest = self.emailed_token()
        with D.tenant(self.org) as db:
            db.execute("UPDATE guest_links SET expires_at='2000-01-01T00:00:00+00:00' WHERE revoked_at IS NULL")
        self.assertEqual(self.resume(latest)[1][0],410)
        # A failed email leaves no working link behind and the older one keeps working.
        self.send_link(page,to='fourth@example.com')
        kept = self.emailed_token()
        from backend.exceptions.errors import ChannelError
        self.mailer.side_effect = ChannelError('network',retryable=True)
        rate_limit.RATES.clear()
        self.assertEqual(page.call(GUEST+'/link',{'via':'email','to':'fifth@example.com'})[0],503)
        self.mailer.side_effect = None
        self.assertEqual(self.resume(kept)[1][0],200)
        # Link requests: 3 an hour per guest, per address, and 10 per network address.
        rate_limit.RATES.clear()
        statuses = [page.call(GUEST+'/link',{'via':'email','to':f'n{n}@example.com'})[0] for n in range(4)]
        self.assertEqual(statuses,[202,202,202,429])
        rate_limit.RATES.clear()
        pages = [self.browser() for _ in range(4)]
        for other in pages:
            self.started(other)
        rate_limit.RATES.clear()
        statuses = [p.call(GUEST+'/link',{'via':'email','to':'same@example.com'})[0] for p in pages]
        self.assertEqual(statuses,[202,202,202,429])
        cleanup = guest.cleanup
        with D.tenant(self.org) as db:
            db.execute("UPDATE guest_devices SET last_seen_at='2000-01-01T00:00:00+00:00' WHERE rowid=1")
            before = db.execute('SELECT COUNT(*) FROM guest_devices').fetchone()[0]
        cleanup(self.org,force=True)
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM guest_devices').fetchone()[0],before-1)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM guest_links WHERE revoked_at IS NOT NULL OR expires_at<datetime('now') OR uses>=20").fetchone()[0],0)

    def test_line_code_links_a_guest(self):
        page = self.browser()
        conv = self.started(page)
        self.assertEqual(self.status(page,GUEST+'/line-code',{}),409)
        self.route = self.configure()['route_id']
        with D.tenant(self.org) as db:
            config = json.loads(db.execute("SELECT config FROM channel_settings WHERE kind='line'").fetchone()[0])
            db.execute("UPDATE channel_settings SET config=? WHERE kind='line'",(json.dumps({**config,'basic_id':'@bookdose'}),))
        follow = self.overview(page)['follow']
        self.assertEqual((follow['line_ready'],follow['line_oa_name'],follow['line_add_url']),(True,'Test OA','https://line.me/R/ti/p/%40bookdose'))
        answer = self.ok(page,GUEST+'/line-code',{})
        self.assertRegex(answer['code'],r'^[0-9]{6}$')
        self.assertEqual((answer['oa_name'],answer['add_url']),('Test OA','https://line.me/R/ti/p/%40bookdose'))
        wrong = f"{(int(answer['code'])+1)%10**6:06d}"
        self.say(wrong)
        self.assertFalse(self.overview(page)['guest']['line_linked'])
        self.say(answer['code'])
        self.assertTrue(self.overview(page)['guest']['line_linked'])
        with D.tenant(self.org) as db:
            bodies = [r[0] for r in db.execute("SELECT m.body FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.channel='line'")]
            self.assertEqual(db.execute("SELECT COUNT(*) FROM audit_logs WHERE action='guest.line_linked'").fetchone()[0],1)
        self.assertEqual(bodies,[wrong])
        self.assertEqual(guest.send_notices(self.org),1)
        self.assertEqual(self.line.call_args.args[1],SENDER)
        self.assertIn('เชื่อม LINE',self.line.call_args.args[2])
        self.assertEqual(self.ok(self.admin,f'/api/conversations/{conv}')['conversation']['guest'],{'follow':['browser','line']})
        # A team reply unread past the delay is told on LINE with a fresh link, never the message.
        self.line.reset_mock()
        self.reply(conv,'รายละเอียดลับ')
        self.age_notices()
        self.assertEqual(guest.send_notices(self.org),1)
        text = self.line.call_args.args[2]
        self.assertNotIn('รายละเอียดลับ',text)
        token = re.search(r'/support/alpha/resume#t=([A-Za-z0-9_-]{43})',text)[1]
        self.assertEqual(self.resume(token)[1][0],200)
        # A used code is gone; unlinking ends the link.
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM guest_line_codes').fetchone()[0],0)
        self.ok(page,GUEST+'/line',None,'DELETE')
        self.assertFalse(self.overview(page)['guest']['line_linked'])

    def test_notices_go_only_to_proven_channels_once_per_unread_spell(self):
        page = self.browser()
        conv = self.started(page)
        self.reply(conv)
        self.assertEqual(self.notices(),[])                       # nothing proven: never notified
        self.customer_mail()
        self.send_link(page)
        token = self.emailed_token()
        self.reply(conv)
        self.assertEqual(self.notices(),[])                       # sent but not opened: still not proven
        self.resume(token)
        self.ok(self.owner,'/api/platform/sms',{'provider':'log'})
        with patch.object(sms,'_log') as logged:
            self.send_link(page,'sms','0812345678')
        self.resume(re.search(r'#t=([A-Za-z0-9_-]{43})',logged.call_args.args[0])[1])
        self.reply(conv,'รายละเอียดลับหนึ่ง')
        self.reply(conv,'รายละเอียดลับสอง')
        self.assertEqual(sorted(n['channel'] for n in self.notices()),['email','sms'])
        sent = self.mailer.call_count
        with patch.object(sms,'_log') as logged:
            self.assertEqual(guest.send_notices(self.org),0)           # waits the same couple of minutes first
            self.age_notices()
            self.assertEqual(guest.send_notices(self.org),2)
        self.assertEqual(self.mailer.call_count,sent+1)
        mail = self.mailer.call_args.args[3]
        self.assertEqual(self.mailer.call_args.args[2],'somsri@example.com')
        self.assertIn('/support/alpha/resume#t=',mail.get_content())
        self.assertNotIn('รายละเอียดลับ',mail.get_content()+mail['Subject'])
        self.assertIn('/support/alpha/resume#t=',logged.call_args.args[0])
        self.assertNotIn('รายละเอียดลับ',logged.call_args.args[0])
        # The fresh link works; still unread, a further reply is not told again.
        self.assertEqual(self.resume(self.emailed_token())[1][0],200)
        self.reply(conv,'รายละเอียดลับสาม')
        self.age_notices()
        self.assertEqual((guest.send_notices(self.org),len(self.notices())),(0,2))
        # Once read, the next reply starts a new unread spell; read within the delay, it is not told.
        page.conversation = conv
        self.ok(page,GUEST+'/session')
        self.reply(conv,'รายละเอียดลับสี่')
        self.assertEqual(len(self.notices()),4)
        self.age_notices()
        with D.tenant(self.org) as db:
            db.execute("UPDATE guest_notifications SET created_at='2000-01-01T00:00:00+00:00' WHERE sent_at IS NULL")
        self.ok(page,GUEST+'/session')
        with patch.object(sms,'_log') as logged:
            self.assertEqual(guest.send_notices(self.org),0)
        logged.assert_not_called()
        self.assertEqual(self.mailer.call_count,sent+1)
        self.assertEqual([n['error'] for n in self.notices()[2:]],['seen','seen'])

    def signed_up(self, client, email, name='สมศรี มีสุข'):
        """Sign up and confirm the email in this browser (so it keeps its guest cookie)."""
        rate_limit.RATES.clear()
        self.assertEqual(client.call('/api/customer/register',{'name':name,'email':email,'password':PASSWORD,'consent':True,'org':'alpha'})[0],202)
        self.ok(client,'/api/customer/verify',{'token':self.mail_link('verify'),'password':PASSWORD})
        client.customer_csrf = self.ok(client,'/api/customer/account')['csrf']

    def test_claim_moves_the_chats_and_ends_old_cookies_and_links(self):
        self.customer_mail()
        page = self.browser()
        first = self.started(page)
        second = self.started(page)
        self.send_link(page,to='unproven@example.com')
        token,old_cookie = self.emailed_token(),page.cookie()
        self.signed_up(page,'member@example.com')
        # Signing in on this browser moves nothing by itself (the email differs; a device needs the explicit claim).
        self.assertEqual(self.ok(page,'/api/customer/overview')['conversations'],[])
        self.assertEqual(self.ok(page,'/api/customer/guest-claims'),{'claims':[{'org_slug':'alpha','org_name':'องค์กร A','conversations':2}]})
        self.assertEqual(self.status(page,'/api/customer/guest-claims',{'org':'beta'}),404)
        self.assertEqual(self.status(self.browser(),'/api/customer/guest-claims'),401)
        status,answer,headers = page.raw('/api/customer/guest-claims',{'org':'alpha'})
        self.assertEqual((status,answer),(200,{'moved':2}))
        self.assertIn('g_alpha=; HttpOnly; Path=/api/; SameSite=Lax; Max-Age=0',headers['Set-Cookie'])
        self.assertEqual({c['id'] for c in self.ok(page,'/api/customer/overview')['conversations']},{first,second})
        page.conversation = first
        self.ok(page,ORG+'/messages',{'body':'ตอนนี้เป็นสมาชิกแล้ว'})
        self.assertEqual(self.ok(page,'/api/customer/guest-claims'),{'claims':[]})
        # The old cookie and the old link no longer reach the chats.
        stranger = self.browser()
        status,data,_ = stranger.raw(GUEST,headers={'Cookie':f'g_alpha={old_cookie}'})
        self.assertIsNone(data['guest'])
        self.assertEqual(self.resume(token)[1][0],410)
        self.assertEqual(self.status(page,'/api/customer/guest-claims',{'org':'alpha'}),404)
        detail = self.ok(self.admin,f'/api/conversations/{first}')
        self.assertIsNone(detail['conversation']['guest'])
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute("SELECT detail FROM audit_logs WHERE action='guest.claimed'").fetchone()[0],'2 เรื่อง')

    def test_automatic_merge_by_verified_email(self):
        self.customer_mail()
        proven,unproven = self.browser(),self.browser()
        conv = self.started(proven)
        other = self.started(unproven)
        self.send_link(proven,to='Somsri@Example.com')
        self.resume(self.emailed_token())
        self.send_link(unproven,to='nobody@example.com')
        # An account confirming the same email takes the proven guest's chats; the unproven one stays a guest.
        self.signed_up(self.browser(),'somsri@example.com')
        rate_limit.RATES.clear()
        client = Client(self.base)
        self.ok(client,'/api/customer/login',{'email':'somsri@example.com','password':PASSWORD})
        self.assertEqual([c['id'] for c in self.ok(client,'/api/customer/overview')['conversations']],[conv])
        self.assertIsNone(self.overview(proven)['guest'])
        self.signed_up(self.browser(),'nobody@example.com')
        self.assertTrue(self.overview(unproven)['guest'])
        with D.control() as cd:
            self.assertEqual(cd.execute('SELECT COUNT(*) FROM guest_verified_emails').fetchone()[0],0)
        self.assertNotIn(other,[c['id'] for c in self.ok(client,'/api/customer/overview')['conversations']])
        # Proven later: the account's next sign-in picks it up.
        self.send_link(unproven,to='somsri@example.com')
        self.resume(self.emailed_token())
        self.assertTrue(self.overview(unproven)['guest'])
        rate_limit.RATES.clear()
        self.ok(Client(self.base),'/api/customer/login',{'email':'somsri@example.com','password':PASSWORD})
        self.assertEqual({c['id'] for c in self.ok(client,'/api/customer/overview')['conversations']},{conv,other})

    def test_switched_off_guest_chat_answers_403(self):
        page = self.browser()
        self.started(page)
        agent,_ = self.create_member()
        self.assertEqual(self.status(agent,'/api/settings/guest-chat',{'guest_chat':{'enabled':False}}),403)
        self.ok(self.admin,'/api/settings/guest-chat',{'guest_chat':{'enabled':False}})
        for path,body in ((GUEST,None),(GUEST+'/conversations',{'body':'x','started_ms':0}),(GUEST+'/session',None),
                          (GUEST+'/messages',{'body':'x'}),(GUEST+'/resume',{'token':'A'*43})):
            status,data = page.call(path,body)
            self.assertEqual((status,data['error']),(403,'องค์กรนี้ให้เริ่มแชทได้เฉพาะสมาชิกที่เข้าสู่ระบบ'),path)
        self.assertEqual(self.ok(page,ORG+'/widget')['guest_chat'],False)
        self.ok(self.admin,'/api/settings/guest-chat',{'guest_chat':{'enabled':True}})
        self.assertTrue(self.overview(page)['guest'])

    def test_widget_settings_are_admin_only_and_origins_are_checked(self):
        agent,_ = self.create_member()
        self.assertEqual(self.status(agent,'/api/settings/guest-chat'),403)
        self.assertEqual(self.status(Client(self.base),'/api/settings/guest-chat'),401)
        current = self.ok(self.admin,'/api/settings/guest-chat')
        self.assertEqual((current['guest_chat'],current['widget']),({'enabled':True},{'enabled':False,'origins':[],'position':'right','theme':'charcoal','title':''}))
        self.assertTrue(current['chat_url'].endswith('/support/alpha/tickets/new'))
        self.assertTrue(current['chat_qr'].startswith('data:image/svg+xml'))
        self.assertEqual(self.ok(Client(self.base),ORG+'/widget'),
                         {'enabled':False,'guest_chat':True,'position':'right','theme':'charcoal','title':'','origins':[]})
        for bad in ({'origins':['http://example.com']},{'origins':['https://example.com/path']},{'origins':['ftp://example.com']},
                    {'origins':['https://user@example.com']},{'origins':['https://exa mple.com']},{'origins':'https://example.com'},
                    {'origins':[f'https://s{n}.example.com' for n in range(11)]},{'theme':'pink'},{'position':'top'},
                    {'title':'x'*61},{'enabled':'yes'}):
            self.assertEqual(self.status(self.admin,'/api/settings/guest-chat',{'widget':bad}),400,bad)
        saved = self.ok(self.admin,'/api/settings/guest-chat',{'widget':{'enabled':True,'origins':['https://WWW.Example.com/','https://www.example.com',
                        'https://shop.example.co.th:8443','http://localhost:5173'],'position':'left','theme':'charcoal','title':'คุยกับเรา'}})
        self.assertEqual(saved['widget'],{'enabled':True,'origins':['https://www.example.com','https://shop.example.co.th:8443','http://localhost:5173'],
                                          'position':'left','theme':'charcoal','title':'คุยกับเรา'})
        self.assertEqual(self.ok(Client(self.base),ORG+'/widget'),{'enabled':True,'guest_chat':True,'position':'left','theme':'charcoal',
                                                                   'title':'คุยกับเรา','origins':saved['widget']['origins']})

    def test_another_organizations_guest_is_never_visible(self):
        self.ok(self.owner,'/api/platform/tenants',{'name':'องค์กร B','slug':'beta','email':'owner@example.com',
                                                    'admin_name':'ผู้ดูแล B','password':'Test-password-123!'})
        page = self.browser()
        conv = self.started(page)
        beta = '/api/public/beta/guest'
        self.assertIsNone(self.ok(page,beta)['guest'])
        self.assertEqual(self.status(page,beta+'/session'),401)
        # alpha's cookie value presented as beta's is unknown there.
        status,data,headers = self.browser().raw(beta,headers={'Cookie':f'g_beta={page.cookie()}'})
        self.assertEqual((status,data['guest']),(200,None))
        self.assertIn('g_beta=; ',headers['Set-Cookie'])
        # A guest of beta cannot open alpha's chat, and beta's team does not see it.
        rate_limit.RATES.clear()
        form = {'body':'สวัสดีองค์กร B','website':'','started_ms':int(time.time()*1000)-5000}
        status,answer = page.call(beta+'/conversations',form)
        self.assertEqual(status,201)
        page.conversation,page.guest_csrf = conv,answer['csrf']
        self.assertEqual(self.status(page,beta+'/session'),404)
        self.assertEqual(len(self.overview(page)['conversations']),1)
        owner = Client(self.base)
        owner.login('owner@example.com')
        self.assertEqual([c['id'] for c in self.ok(owner,'/api/conversations')['conversations']],[answer['id']])

    def test_staff_contact_merge_and_delete_keep_guests_consistent(self):
        page = self.browser()
        conv = self.started(page)
        contact = self.ok(self.admin,f'/api/conversations/{conv}')['contact']['id']
        target = self.ok(self.admin,'/api/contacts',{'first_name':'สมศรี','email':'somsri@example.com'})['id']
        self.ok(self.admin,f'/api/contacts/{target}/merge',{'contact_ids':[contact]})
        self.assertEqual(self.ok(self.admin,f'/api/conversations/{conv}')['contact']['guest'],{'follow':['browser']})
        self.ok(page,GUEST+'/messages',{'body':'ยังคุยต่อได้หลังรวมรายชื่อ'})
        # A new chat of the guest goes to the merged contact; the guest still sees only its own chats.
        other = self.ok(self.admin,'/api/contacts',{'first_name':'คนอื่น'})['id']
        self.assertEqual(self.ok(self.admin,f'/api/conversations/{self.started(page)}')['contact']['id'],target)
        self.assertEqual(len(self.overview(page)['conversations']),2)
        self.assertNotEqual(other,target)

    def test_a_link_sent_to_someone_elses_address_takes_over_nothing(self):
        """A visitor may ask for a follow link to any address, so the link must not hand that browser's chats to the
        sender, throw away the chats it already follows, or make the address a proven address of the sender."""
        self.customer_mail()
        sender = self.browser()
        self.started(sender)
        self.send_link(sender,to='victim@example.com')
        token = self.emailed_token()
        victim = self.browser()
        victim_conv = self.started(victim)
        # The browser already follows its own chats: the link is refused until the person says to open it.
        status,data = self.resume(token,victim)[1]
        self.assertEqual((status,data.get('code')),(409,'guest_other_chats'))
        # Its own chats still work, and the address did not become the sender's proven address.
        self.assertEqual(self.ok(victim,GUEST+'/session')['conversation']['id'],victim_conv)
        with D.tenant(self.org) as db:
            rows = D.rows(db,'SELECT email,email_verified_at FROM guest_visitors ORDER BY rowid')
        self.assertEqual([(r['email'],r['email_verified_at']) for r in rows],[('victim@example.com',None),('',None)])
        with D.control() as cd:
            self.assertEqual(D.rows(cd,'SELECT * FROM guest_verified_emails'),[])
        # Saying so opens the link, and the chats this browser followed before are still reachable from their own link.
        self.assertEqual(self.resume(token,victim,replace=True)[1][0],200)
        self.assertEqual(self.ok(victim,GUEST)['conversations'][0]['id'] != victim_conv,True)

    def test_one_recipient_is_one_follow_link_budget_however_the_number_is_typed(self):
        """The per-recipient limit counts the address the message is sent to, not the characters that were typed."""
        key = lambda value: schema.link_target('sms',value)
        self.assertEqual({key('0812345678'),key('081-234-5678'),key('081 234 5678'),key('(081)234-5678'),
                          key('+66812345678'),key('0066812345678'),key('66812345678')},{'+66812345678'})
        self.assertEqual(schema.link_target('email','  Somsri@Example.COM '),'somsri@example.com')

    def test_the_list_reads_each_chat_by_its_case_like_the_open_chat(self):
        """Every row of the guest's list carries the status of its case, so a chat reads the same whether it is the one
        open (its session) or not (the list)."""
        page = self.browser()
        conv = self.started(page)
        other = self.started(page,body='อีกเรื่องหนึ่งค่ะ')
        rows = {c['id']:c for c in self.overview(page)['conversations']}
        self.assertEqual((rows[conv]['ticket_status'],rows[other]['ticket_status']),(None,None))
        case = self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']
        self.ok(self.admin,f'/api/tickets/{case}',{'status':'open'},'PATCH')
        rows = {c['id']:c for c in self.overview(page)['conversations']}
        page.conversation = conv
        self.assertEqual(rows[conv]['ticket_status'],self.ok(page,GUEST+'/session')['ticket']['status'])
        self.assertEqual((rows[conv]['ticket_status'],rows[other]['ticket_status']),('open',None))

    def test_existing_databases_upgrade_cleanly(self):
        with D.tenant(self.org) as db:
            for table in ('guest_visitors','guest_devices','guest_conversations','guest_seen','guest_links','guest_line_codes',
                          'guest_line_links','guest_notifications'):
                db.execute(f'DROP TABLE {table}')
            db.execute("DELETE FROM settings WHERE key IN ('guest_chat','widget')")
        with D.control() as cd:
            cd.execute('DROP TABLE guest_verified_emails')
        D.init()
        D.init()
        self.assertEqual(self.started(self.browser()) is not None,True)
        self.assertEqual(self.ok(Client(self.base),ORG+'/widget')['guest_chat'],True)


if __name__=='__main__':
    unittest.main()
