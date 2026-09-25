"""ตรวจสุขภาพความปลอดภัย: the platform console checks its own settings - the site's security headers and HTTPS
certificate (read from the site, as a visitor), the encryption key kept apart from the data folder, Turnstile, and
organizations without an admin or a storage quota."""
import ssl
import time
import unittest
from unittest.mock import patch

import test_app as base
from test_app import D
from backend.modules.security import checkup

CHECKUP = '/api/platform/security/checkup'
GOOD = {'content-security-policy':"default-src 'self'; frame-ancestors 'none'",'x-content-type-options':'nosniff',
        'referrer-policy':'no-referrer','x-frame-options':'DENY','strict-transport-security':'max-age=31536000'}


def cert(days):
    return {'notAfter':time.strftime('%b %d %H:%M:%S %Y GMT',time.gmtime(time.time()+days*86400+3600)),
            'issuer':((('organizationName',"Let's Encrypt"),),)}


class SecurityCheckupTests(unittest.TestCase):
    def checks(self):
        return {c['key']:c for c in self.ok(self.owner,CHECKUP)['checks']}

    def test_everything_checked_and_explained(self):
        self.enable_registration_mail()     # https://bookdose.example.com
        self.ok(self.owner,f'/api/platform/tenants/{self.org}/quota',{'quota_mb':0},'PATCH')
        with patch.object(checkup,'fetch',return_value=(200,GOOD,cert(60))) as fetched:
            found = self.checks()
        fetched.assert_called_once_with('https://bookdose.example.com')
        self.assertEqual(found['headers']['level'],'ok')
        self.assertEqual(len(found['headers']['items']),5)
        self.assertEqual((found['https']['level'],found['https']['title']),('ok','ใบรับรอง HTTPS เหลือ 60 วัน'))
        # The test server keeps its key in the data folder; no Turnstile yet.
        self.assertEqual(found['key']['level'],'warning')
        self.assertEqual(found['turnstile']['level'],'warning')
        self.assertEqual(found['turnstile']['action']['href'],'/platform/settings#turnstile')
        # The demo organization has its admin; its quota was taken off.
        self.assertEqual(found['admins']['level'],'ok')
        self.assertEqual(found['quota']['level'],'warning')
        self.assertEqual(found['quota']['items'][0]['href'],f'/platform/organizations/{self.org}')

        # A header gone, a certificate about to end, an organization nobody runs, the quota set, the key moved out.
        weak = {k:v for k,v in GOOD.items() if k!='strict-transport-security'}
        self.ok(self.owner,f'/api/platform/tenants/{self.org}/quota',{'quota_mb':1024},'PATCH')
        with D.control() as cd:
            cd.execute("UPDATE memberships SET active=0 WHERE tenant_id=? AND role='admin'",(self.org,))
            cd.commit()
        with patch.object(checkup,'fetch',return_value=(200,weak,cert(5))), \
             patch('backend.utils.secret_box.key_source',return_value='environment'):
            found = self.checks()
        self.assertEqual(found['headers']['level'],'warning')
        self.assertEqual([i['label'] for i in found['headers']['items'] if not i['ok']],['Strict-Transport-Security'])
        self.assertEqual((found['https']['level'],found['https']['title']),('critical','ใบรับรอง HTTPS เหลือ 5 วัน'))
        self.assertEqual(found['key']['level'],'ok')
        self.assertEqual(found['admins']['level'],'critical')
        self.assertEqual(found['admins']['items'][0]['href'],f'/platform/organizations?admin={self.org}')
        self.assertEqual(found['quota']['level'],'ok')

        # A certificate the site's visitors would be warned about.
        failure = ssl.SSLCertVerificationError('certificate verify failed')
        failure.verify_message = 'certificate has expired'
        with patch.object(checkup,'fetch',side_effect=failure):
            found = self.checks()
        self.assertEqual(found['https']['level'],'critical')
        self.assertIn('certificate has expired',found['https']['detail'])

        # Only the platform's admins.
        self.assertEqual(self.admin.call(CHECKUP)[0],403)

    def test_a_local_copy_is_checked_where_it_is_opened(self):
        # No public address: this machine's own, never anywhere a Host header names.
        with patch.object(checkup,'fetch',return_value=(200,GOOD,None)) as fetched, D.control() as cd:
            found = {c['key']:c for c in checkup.run(cd,'http://localhost:3000')['checks']}
        fetched.assert_called_once_with('http://localhost:3000')
        self.assertEqual(found['https']['level'],'info')
        self.assertEqual(len(found['headers']['items']),4)     # HSTS only means something over HTTPS
        with D.control() as cd:
            found = {c['key']:c for c in checkup.run(cd)['checks']}
        self.assertEqual(found['headers']['action']['href'],'/platform/settings#email')


# The setUp, the sign-ins and the helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(SecurityCheckupTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
