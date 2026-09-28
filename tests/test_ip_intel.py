"""The IP database (security/ip_intel.py) and what reads it: countries and networks from small stand-ins of DB-IP's free
files (nothing is downloaded), clouds and VPNs told apart, a failed update that keeps the one in use, the monthly turn,
the console's card and the addresses it lists, a guest's smaller day from a cloud address, and a platform admin's
sign-in read for another country too soon, a time zone of another country, and proxy headers."""
import gzip
import re
import time
import unittest
import urllib.error
from unittest.mock import patch

import test_app as base
from test_app import Client, D, rate_limit
from backend.modules.guest import blocks as guest_blocks
from backend.modules.security import events, ip_intel, sign_in_alerts
from backend.utils.dates import after

PASSWORD = 'Test-password-123!'
COUNTRY = '\n'.join(['0.0.0.0,8.8.7.255,ZZ','8.8.8.0,8.8.8.255,US','34.0.0.0,34.255.255.255,US','49.228.0.0,49.231.255.255,TH',
                     '185.0.0.0,185.0.0.255,DE','2001:4860::,2001:4860:ffff:ffff:ffff:ffff:ffff:ffff,US'])+'\n'
ASN = '\n'.join(['8.8.8.0,8.8.8.255,15169,"Google LLC"','34.0.0.0,34.255.255.255,396982,"Google LLC"',
                 '49.228.0.0,49.231.255.255,133481,"AIS Fibre"','185.0.0.0,185.0.0.255,64500,"Example Hosting GmbH"',
                 '2001:4860::,2001:4860:ffff:ffff:ffff:ffff:ffff:ffff,15169,"Google LLC"'])+'\n'
THAI,CLOUD = '49.229.1.2','34.1.2.3'


def fake_download(url):
    return gzip.compress((COUNTRY if '-country-' in url else ASN).encode())


class IpIntelTests(unittest.TestCase):
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    enable_registration_mail = base.IntegrationTests.enable_registration_mail

    def setUp(self):
        base.IntegrationTests.setUp(self)
        ip_intel._forget_cache()
        self.addCleanup(ip_intel._forget_cache)
        for target in (patch.object(ip_intel,'MIN_ROWS',1),patch.object(ip_intel,'_download',side_effect=fake_download)):
            target.start()
            self.addCleanup(target.stop)

    def sign_in(self, ip, zone='Asia/Bangkok', proxy=''):
        client = Client(self.base)
        rate_limit.RATES.clear()
        headers = {'X-Forwarded-Host':f'127.0.0.1:{self.server.server_port}','X-Bookdose-Client-IP':ip,'X-Bookdose-Timezone':zone,
                   'User-Agent':'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0'}
        if proxy:
            headers['X-Bookdose-Client-Proxy'] = proxy
        status,data = client.call('/api/login',{'email':'admin@example.com','password':PASSWORD},headers=headers)
        self.assertEqual(status,200,data)
        client.boot()
        return client

    def test_nothing_is_known_until_it_is_downloaded(self):
        self.assertIsNone(ip_intel.lookup(CLOUD))
        self.assertFalse(ip_intel.status()['enabled'])
        with D.control() as cd:
            self.assertFalse(ip_intel.due(cd))

    def test_download_build_and_look_up(self):
        answer = ip_intel.update()
        self.assertTrue(answer['ok'],answer)
        self.assertEqual((answer['countries'],answer['networks'],answer['month']),(6,5,ip_intel._month()))
        self.assertEqual(ip_intel.lookup(THAI),{'country':'TH','asn':133481,'org':'AIS Fibre','hosting':False})
        self.assertEqual(ip_intel.lookup(CLOUD),{'country':'US','asn':396982,'org':'Google LLC','hosting':True})
        self.assertTrue(ip_intel.lookup('185.0.0.9')['hosting'])        # by the words of its name
        self.assertEqual(ip_intel.lookup('2001:4860::8888')['country'],'US')
        for unknown in ('10.0.0.1','127.0.0.1','203.0.113.5','99.0.0.1','not an address',''):
            self.assertIsNone(ip_intel.lookup(unknown),unknown)
        self.assertEqual(set(ip_intel.describe([THAI,CLOUD,'10.0.0.1'])),{THAI,CLOUD})
        with D.control() as cd:
            self.assertFalse(ip_intel.due(cd))
        # A failed update keeps the one in use and says so; it is tried again hours later.
        ip_intel._download.side_effect = urllib.error.HTTPError('u',500,'down',{},None)
        failed = ip_intel.update()
        self.assertFalse(failed['ok'])
        self.assertIn('ยังใช้ฉบับเดิมอยู่',failed['error'])
        ip_intel._forget_cache()
        self.assertEqual(ip_intel.lookup(THAI)['country'],'TH')
        # Early in a month, before its files are out: last month's.
        calls = []

        def early(url):
            calls.append(url)
            if ip_intel._month() in url:
                raise urllib.error.HTTPError(url,404,'not yet',{},None)
            return fake_download(url)
        ip_intel._download.side_effect = early
        self.assertEqual(ip_intel.update()['month'],ip_intel._month(1))
        self.assertEqual(len([u for u in calls if ip_intel._month(1) in u]),2)
        with D.control() as cd:
            cd.execute("UPDATE platform_settings SET value=json_set(value,'$.last_try',?) WHERE key='ip_intel'",(after(hours=-7),))
            cd.commit()
            self.assertTrue(ip_intel.due(cd))
        # Stopped: nothing is known, the files go.
        ip_intel.stop_using('ทดสอบ')
        self.assertIsNone(ip_intel.lookup(THAI))
        self.assertEqual(list((D.DATA/'ip-intel').glob('*.sqlite3')),[])

    def test_the_console_card_and_the_addresses_it_lists(self):
        self.assertFalse(self.ok(self.owner,'/api/platform/security/ip-data')['enabled'])
        started = self.owner.call('/api/platform/security/ip-data',{})
        self.assertEqual(started[0],202)
        for _ in range(100):
            state = self.ok(self.owner,'/api/platform/security/ip-data')
            if not state['running'] and state['month']:
                break
            time.sleep(0.1)
        self.assertEqual((state['ok'],state['credit']),(True,'IP Geolocation by DB-IP'))
        self.assertEqual(self.admin.call('/api/platform/security/ip-data')[0],403)
        events.record('login_failed',actor='staff',subject='x@example.com',ip=CLOUD)
        page = self.ok(self.owner,'/api/platform/security/events?limit=20')
        self.assertEqual(page['ip_info'][CLOUD]['org'],'Google LLC')
        self.assertIn(CLOUD,self.ok(self.owner,'/api/platform/security/overview?range=24h')['ip_info'])
        self.ok(self.owner,'/api/platform/security/ip-blocks',{'ip':CLOUD,'reason':'ทดสอบ','duration':'1h'})
        self.assertTrue(self.ok(self.owner,'/api/platform/security/ip-blocks')['ip_info'][CLOUD]['hosting'])
        self.assertFalse(self.owner.call('/api/platform/security/ip-data',None,'DELETE')[1]['enabled'])

    def test_a_cloud_address_starts_fewer_guest_chats_a_day(self):
        ip_intel.update()
        with D.tenant(self.org) as db:
            db.executemany('INSERT INTO guest_conversations(conversation_id,visitor_id,created_at,ip) VALUES(?,?,?,?)',
                           [(f'c{n}-{ip}','v',after(hours=-1),ip) for n in range(5) for ip in (CLOUD,THAI)])
            with self.assertRaises(Exception) as caught:
                guest_blocks.check_start(db,None,CLOUD)
            self.assertEqual(caught.exception.status,429)
            guest_blocks.check_start(db,None,THAI)

    def test_a_sign_in_from_another_country_too_soon(self):
        ip_intel.update()
        self.enable_registration_mail()
        # The mail goes at once here, not on its own thread.
        patch.object(sign_in_alerts,'_deliver',side_effect=sign_in_alerts.send).start()
        self.sign_in(THAI)
        mail = self.mailer.call_args_list[-1].args[3]
        text = mail.get_content()
        self.assertIn('ประเทศ: ไทย',text)
        self.assertIn('ผู้ให้บริการเครือข่าย: AIS Fibre',text)
        self.assertNotIn('ข้อสังเกต',text)
        # Minutes later from a cloud in the United States, the browser still on Bangkok's time.
        self.sign_in(CLOUD,proxy='via')
        mail = self.mailer.call_args_list[-1].args[3]
        text = mail.get_content()
        self.assertEqual(mail['Subject'],'พบการเข้าสู่ระบบบัญชีผู้ดูแลแพลตฟอร์มของคุณที่น่าสงสัย')
        self.assertIn('จากสหรัฐอเมริกา หลังจากเข้าสู่ระบบจากไทย ไม่ถึง 2 ชั่วโมง',text)
        self.assertIn('(เครือข่ายของผู้ให้บริการคลาวด์หรือ VPN)',text)
        self.assertIn('เขตเวลาของเบราว์เซอร์ (Asia/Bangkok) ไม่ตรงกับประเทศของ IP',text)
        self.assertNotIn('via',text)
        event = next(e for e in self.ok(self.owner,'/api/platform/security/events?limit=50')['events']
                     if e['kind']=='sign_in_new_place' and e['ip']==CLOUD)
        self.assertEqual(event['severity'],'warning')
        self.assertEqual({k:event['detail'][k] for k in ('country','previous_country','hosting','impossible_travel','timezone_mismatch','proxy')},
                         {'country':'US','previous_country':'TH','hosting':True,'impossible_travel':True,'timezone_mismatch':True,'proxy':'via'})
        self.assertIn('impossible_travel',[a['rule'] for a in self.ok(self.owner,'/api/platform/security/alerts')['alerts']])
        # The not-me page names the country and network too.
        token = re.search(r'/not-me#t=([A-Za-z0-9_-]{43})',text)[1]
        about = self.ok(Client(self.base),'/api/sign-in-alerts/check',{'token':token})
        self.assertEqual((about['country'],about['network'],about['hosting']),('US','Google LLC',True))
        # Back at a known place: that switch of country was told already (with the sign-in that made it).
        before = len(self.mailer.call_args_list)
        self.sign_in(THAI)
        self.assertEqual(len(self.mailer.call_args_list),before)


if __name__ == '__main__':
    unittest.main()
