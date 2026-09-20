"""The bot check on the public support form (backend/extensions/turnstile.py): the platform admin saves the Cloudflare
Turnstile keys, the secret one is sealed on disk and never comes back, the start form then has to carry a token that
is verified once, and Cloudflare's own troubles never shut a real customer out. Cloudflare's endpoint is mocked;
nothing leaves the machine."""
import json
import unittest
from unittest.mock import patch

import test_app as base
import test_guest_chat as guest_tests
from test_app import D
from test_sms import Provider
from backend.extensions import turnstile

TURNSTILE = '/api/platform/turnstile'
SITE_KEY = '0x4AAAAAAABkMYinukE8nzY'
SECRET = '0x4AAAAAAABkMYinukE8nzYzabcdefghij'
KEYS = {'enabled':True,'site_key':SITE_KEY,'secret':SECRET}
TOKEN = 'dummy.turnstile.token-'+'a'*40


def passed(action=turnstile.START_ACTION):
    return Provider(200,{'success':True,'action':action,'hostname':'localhost','challenge_ts':'2026-01-01T00:00:00Z'})


def refused(*codes):
    return Provider(200,{'success':False,'error-codes':list(codes)})


class TurnstileSettingsTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    create_member = base.IntegrationTests.create_member

    def test_the_secret_key_is_sealed_and_never_comes_back(self):
        answer = self.ok(self.owner,TURNSTILE,KEYS)
        self.assertEqual(answer,{'enabled':True,'site_key':SITE_KEY,'configured':True})
        text = json.dumps(answer)+json.dumps(self.ok(self.owner,TURNSTILE))
        self.assertNotIn(SECRET,text)
        on_disk = (D.DATA/'secrets'/'turnstile.json').read_text()
        self.assertTrue(on_disk.startswith('bdsec1.'))
        self.assertNotIn(SECRET,on_disk)
        with D.control() as cd:
            self.assertNotIn(SECRET,json.dumps([list(r) for r in cd.execute('SELECT * FROM platform_settings')]))
        # Saving again without the secret keeps it, and switching off does not lose it either.
        self.ok(self.owner,TURNSTILE,{'enabled':False,'site_key':SITE_KEY,'secret':''})
        again = self.ok(self.owner,TURNSTILE,{'enabled':True,'site_key':SITE_KEY,'secret':''})
        self.assertEqual((again['enabled'],again['configured']),(True,True))
        self.assertEqual(turnstile.read_secret()['secret'],SECRET)
        # Only a platform admin sees or changes it.
        agent,_ = self.create_member()
        self.assertEqual(agent.call(TURNSTILE)[0],403)
        self.assertEqual(agent.call(TURNSTILE,KEYS)[0],403)

    def test_the_check_is_not_switched_on_without_both_keys(self):
        for body in ({'enabled':True,'site_key':'','secret':SECRET},
                     {'enabled':True,'site_key':SITE_KEY,'secret':''},
                     {'enabled':True,'site_key':'ไม่ใช่คีย์','secret':SECRET},
                     {'enabled':True,'site_key':SITE_KEY,'secret':'สั้น'},
                     {'enabled':'yes','site_key':SITE_KEY,'secret':SECRET}):
            self.assertEqual(self.owner.call(TURNSTILE,body)[0],400,body)
        self.assertEqual(self.ok(self.owner,TURNSTILE)['enabled'],False)
        # The keys may be kept ready while the check itself stays off.
        self.assertEqual(self.ok(self.owner,TURNSTILE,{'enabled':False,'site_key':SITE_KEY,'secret':SECRET})['enabled'],False)


class GuestTurnstileTests(guest_tests.GuestChatTests):
    """The start form of the guest web chat, with the check on."""

    def switch_on(self):
        self.ok(self.owner,TURNSTILE,KEYS)

    def captcha_events(self, kind):
        with D.control() as cd:
            return D.rows(cd,'SELECT * FROM security_events WHERE kind=? ORDER BY id',(kind,))

    def test_nothing_changes_while_the_platform_has_no_keys(self):
        page = self.browser()
        self.assertEqual(self.overview(page)['captcha']['site_key'],'')
        self.assertEqual(self.start(page)[0],201)

    def test_the_page_gets_the_site_key_and_the_token_is_verified_once(self):
        self.switch_on()
        page = self.browser()
        self.assertEqual(self.overview(page)['captcha'],{'site_key':SITE_KEY,'action':turnstile.START_ACTION})
        cloudflare = passed()
        with patch.object(turnstile,'open_without_redirects',cloudflare):
            status,data,_ = self.start(page,captcha_token=TOKEN)
        self.assertEqual(status,201,data)
        self.assertEqual(cloudflare.requests[0].full_url,turnstile.VERIFY_URL)
        form = cloudflare.form()
        self.assertEqual((form['secret'],form['response']),(SECRET,TOKEN))
        self.assertTrue(form['remoteip'])

    def test_a_form_without_a_good_token_does_not_start_a_chat(self):
        self.switch_on()
        page = self.browser()
        # Nothing is even asked of Cloudflare when the visitor sends no token.
        cloudflare = passed()
        with patch.object(turnstile,'open_without_redirects',cloudflare):
            status,data,_ = self.start(page)
        self.assertEqual(status,400)
        self.assertIn('บอท',data['error'])
        self.assertEqual(cloudflare.requests,[])
        # A token Cloudflare refuses (wrong, expired, or already used) is refused here too.
        for codes in (('invalid-input-response',),('timeout-or-duplicate',)):
            with patch.object(turnstile,'open_without_redirects',refused(*codes)):
                self.assertEqual(self.start(page,captcha_token=TOKEN)[0],400)
        # A token minted for another of our forms does not open this one.
        with patch.object(turnstile,'open_without_redirects',passed('other-form')):
            self.assertEqual(self.start(page,captcha_token=TOKEN)[0],400)
        self.assertEqual(self.overview(page)['conversations'],[])
        self.assertEqual([row['subject'] for row in self.captcha_events('captcha_failed')],
                         ['missing-input-response','invalid-input-response','timeout-or-duplicate','action-mismatch'])

    def test_cloudflares_own_trouble_never_shuts_a_customer_out(self):
        self.switch_on()
        page = self.browser()
        # It could not be reached, and it says our own key is wrong: the chat starts and the event says what happened.
        with patch.object(turnstile,'open_without_redirects',Provider(error=TimeoutError())):
            self.assertEqual(self.start(page,captcha_token=TOKEN)[0],201)
        with patch.object(turnstile,'open_without_redirects',refused('invalid-input-secret')):
            self.assertEqual(self.start(page,captcha_token=TOKEN)[0],201)
        self.assertEqual([row['subject'] for row in self.captcha_events('captcha_unavailable')],['unreachable','invalid-input-secret'])
        self.assertEqual(len(self.overview(page)['conversations']),2)


for _name in [n for n in dir(guest_tests.GuestChatTests) if n.startswith('test_')]:
    setattr(GuestTurnstileTests,_name,None)


if __name__=='__main__':
    unittest.main()
