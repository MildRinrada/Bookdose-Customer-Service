"""Real SMS for the follow links and notices of guest web chat (backend/extensions/sms.py): the platform admin chooses
ThaiBulkSMS or Twilio, the credentials are sealed on disk and never come back in an answer, a test message checks the
setup, and the provider's refusals become the usual channel errors. The providers' HTTPS endpoints are mocked; nothing
leaves the machine."""
import base64
import io
import json
import re
import unittest
import urllib.error
import urllib.parse
from unittest.mock import patch

import test_app as base
import test_guest_chat as guest_tests
from test_app import D
from backend.extensions import sms
from backend.modules.guest import service as guest

SMS = '/api/platform/sms'
THAI = {'provider':'thaibulksms','sender':'BOOKDOSE','key':'tbs-key-1234567890','secret':'tbs-secret-abcdefghij'}
TWILIO = {'provider':'twilio','account':'AC'+'1'*32,'sender':'+15551234567','secret':'a'*32}


class FakeResponse:
    def __init__(self, status, body):
        self.status,self.body = status,json.dumps(body).encode()

    def read(self, _limit=None):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class Provider:
    """Stands in for the provider's HTTPS endpoint: records each request and answers what the test says."""
    def __init__(self, status=201, body=None, error=None):
        self.status,self.body,self.error,self.requests = status,body if body is not None else {},error,[]

    def __call__(self, request, timeout):
        self.requests.append(request)
        if self.error:
            raise self.error
        if self.status>=400:
            raise urllib.error.HTTPError(request.full_url,self.status,'refused',{},io.BytesIO(json.dumps(self.body).encode()))
        return FakeResponse(self.status,self.body)

    def form(self, index=-1):
        return dict(urllib.parse.parse_qsl(self.requests[index].data.decode()))


class SmsSettingsTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    create_member = base.IntegrationTests.create_member

    def test_thaibulksms_credentials_are_sealed_and_never_come_back(self):
        answer = self.ok(self.owner,SMS,THAI)
        self.assertEqual((answer['provider'],answer['sender'],answer['configured']['thaibulksms']),('thaibulksms','BOOKDOSE',True))
        text = json.dumps(answer)+json.dumps(self.ok(self.owner,SMS))
        self.assertNotIn(THAI['key'],text)
        self.assertNotIn(THAI['secret'],text)
        on_disk = (D.DATA/'secrets'/'sms.json').read_text()
        self.assertTrue(on_disk.startswith('bdsec1.'))
        self.assertNotIn(THAI['secret'],on_disk)
        with D.control() as cd:
            self.assertNotIn(THAI['secret'],json.dumps([list(r) for r in cd.execute('SELECT * FROM platform_settings')]))
        # Saving again without the credentials keeps them; switching to Twilio and back does not lose them either.
        self.ok(self.owner,SMS,{'provider':'thaibulksms','sender':'NEWNAME'})
        self.ok(self.owner,SMS,TWILIO)
        again = self.ok(self.owner,SMS,{'provider':'thaibulksms','sender':'NEWNAME'})
        self.assertEqual(again['configured'],{'thaibulksms':True,'twilio':True})
        self.assertEqual(sms.read_secret()['thaibulksms']['secret'],THAI['secret'])
        # Only a platform admin sees or changes it.
        agent,_ = self.create_member()
        self.assertEqual(agent.call(SMS)[0],403)
        self.assertEqual(agent.call(SMS,THAI)[0],403)

    def test_a_provider_is_not_switched_on_without_what_it_needs(self):
        for body in ({'provider':'thaibulksms','sender':'BOOKDOSE'},
                     {**THAI,'sender':'ชื่อภาษาไทย'},
                     {'provider':'twilio','account':'AC123','sender':'+15551234567','secret':'a'*32},
                     {**TWILIO,'sender':'0812345678'},
                     {**TWILIO,'secret':'short'},
                     {'provider':'carrier-pigeon'}):
            self.assertEqual(self.owner.call(SMS,body)[0],400,body)
        self.assertEqual(self.ok(self.owner,SMS)['provider'],'off')

    def test_the_test_message_goes_to_thaibulksms_the_way_it_expects(self):
        self.ok(self.owner,SMS,THAI)
        provider = Provider(201,{'remaining_credit':99,'phone_number_list':[{'number':'0812345678'}],'bad_phone_number_list':[]})
        with patch.object(sms,'open_without_redirects',provider):
            answer = self.ok(self.owner,SMS+'/test',{'to':'081-234-5678'})
        self.assertEqual(answer,{'sent':True,'to_masked':'+66*****5678'})
        request = provider.requests[0]
        self.assertEqual(request.full_url,'https://api-v2.thaibulksms.com/sms')
        self.assertEqual(request.get_header('Authorization'),'Basic '+base64.b64encode(f"{THAI['key']}:{THAI['secret']}".encode()).decode())
        form = provider.form()
        self.assertEqual((form['msisdn'],form['sender']),('0812345678','BOOKDOSE'))
        self.assertIn('ทดสอบ',form['message'])

    def test_the_test_message_goes_to_twilio_the_way_it_expects(self):
        self.ok(self.owner,SMS,TWILIO)
        provider = Provider(201,{'sid':'SM'+'0'*32,'status':'queued'})
        with patch.object(sms,'open_without_redirects',provider):
            self.ok(self.owner,SMS+'/test',{'to':'+447700900123'})
        request = provider.requests[0]
        self.assertEqual(request.full_url,f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO['account']}/Messages.json")
        form = provider.form()
        self.assertEqual((form['To'],form['From']),('+447700900123','+15551234567'))
        # A Messaging Service sends instead of one number.
        self.ok(self.owner,SMS,{**TWILIO,'sender':'MG'+'2'*32,'secret':''})
        with patch.object(sms,'open_without_redirects',provider):
            self.ok(self.owner,SMS+'/test',{'to':'0812345678'})
        self.assertEqual(provider.form()['MessagingServiceSid'],'MG'+'2'*32)
        self.assertNotIn('From',provider.form())

    def test_a_refusal_says_what_went_wrong(self):
        self.ok(self.owner,SMS,THAI)
        cases = [(Provider(401,{'error':{'name':'UNAUTHORIZED'}}),'ข้อมูลบัญชี'),
                 (Provider(400,{'error':{'name':'NOT_ENOUGH_CREDIT','description':'Credit is not enough'}}),'เครดิต'),
                 (Provider(201,{'bad_phone_number_list':[{'number':'0812345678'}]}),'ปฏิเสธ'),
                 (Provider(error=TimeoutError()),'ไม่ทราบผล')]
        for provider,words in cases:
            with patch.object(sms,'open_without_redirects',provider):
                status,answer = self.owner.call(SMS+'/test',{'to':'0812345678'})
            self.assertEqual(status,502)
            self.assertIn(words,answer['error'])
            base.rate_limit.RATES.clear()
        # A number outside Thailand never reaches ThaiBulkSMS.
        provider = Provider()
        with patch.object(sms,'open_without_redirects',provider):
            self.assertEqual(self.owner.call(SMS+'/test',{'to':'+447700900123'})[0],502)
        self.assertEqual(provider.requests,[])

    def test_nothing_is_sent_while_off(self):
        self.assertEqual(self.owner.call(SMS+'/test',{'to':'0812345678'})[0],409)


class GuestSmsTests(guest_tests.GuestChatTests):
    """A guest without email follows the chat from another device by SMS, through the real provider."""

    def test_a_guest_gets_the_follow_link_and_a_reply_notice_by_real_sms(self):
        self.ok(self.owner,SMS,THAI)
        page = self.browser()
        conv = self.started(page)
        self.assertTrue(self.overview(page)['follow']['sms_ready'])
        provider = Provider(201,{'phone_number_list':[{'number':'0812345678'}],'bad_phone_number_list':[]})
        with patch.object(sms,'open_without_redirects',provider):
            self.assertEqual(self.send_link(page,'sms','081-234-5678'),{'sent':True,'to_masked':'+66*****5678'})
        form = provider.form()
        self.assertEqual(form['msisdn'],'0812345678')
        token = re.search(r'/support/alpha/resume#t=([A-Za-z0-9_-]{43})',form['message'])[1]
        phone,(status,_) = self.resume(token)
        self.assertEqual(status,200)
        self.assertTrue(self.overview(phone)['guest']['phone_verified'])
        # A team reply unread past the delay is told by SMS too, with a fresh link and never the message.
        self.reply(conv,'รายละเอียดลับ')
        self.age_notices()
        with patch.object(sms,'open_without_redirects',provider):
            self.assertEqual(guest.send_notices(self.org),1)
        message = provider.form()['message']
        self.assertNotIn('รายละเอียดลับ',message)
        self.assertIn('ทีมงานตอบกลับ',message)
        # A provider that is down now is tried again later; one that refused the number is not.
        page.conversation = conv
        self.ok(page,guest_tests.GUEST+'/session')              # read: the next reply starts a new unread spell
        self.reply(conv,'อีกครั้ง')
        self.age_notices()
        with patch.object(sms,'open_without_redirects',Provider(503,{})):
            self.assertEqual(guest.send_notices(self.org),0)
        waiting = [n for n in self.notices() if n['channel']=='sms' and not n['sent_at']]
        self.assertEqual(len(waiting),1)


for _name in [n for n in dir(guest_tests.GuestChatTests) if n.startswith('test_')]:
    setattr(GuestSmsTests,_name,None)


if __name__=='__main__':
    unittest.main()
