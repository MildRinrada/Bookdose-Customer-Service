"""The Next.js web app (frontend/) forwards /api/* to the Python server. The forwarded host and client address are believed
only from the web app: from this machine while no proxy secret is set, otherwise with the secret."""
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend.database import db as D
from backend.middleware import rate_limit
from test_app import Client, start_server

LOGIN = {'email':'admin@example.com','password':'Test-password-123!'}


class WebProxyTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory(prefix='bookdose-test-')
        self.original_data=D.DATA
        D.DATA=Path(self.temporary.name)/'data'
        D.init()
        rate_limit.RATES.clear()
        self.server,self.thread=start_server()
        self.base=f'http://127.0.0.1:{self.server.server_port}'
        self.assertEqual(Client(self.base).call('/api/setup',{'name':'เจ้าของระบบ','email':'admin@example.com','password':'Test-password-123!',
                                                               'organization':'องค์กร A','slug':'alpha','demo':False})[0],200)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        D.DATA=self.original_data
        self.temporary.cleanup()

    def login(self, headers, body=LOGIN):
        return Client(self.base).call('/api/login',body,headers=headers)[0]

    def test_web_app_on_this_machine_is_believed(self):
        web = {'X-Forwarded-Host':'localhost:3000','Origin':'http://localhost:3000'}
        self.assertEqual(self.login(web),200)
        # The browser's own origin must still match the host it used.
        self.assertEqual(self.login({**web,'Origin':'http://evil.example'}),403)
        # Without the forwarded host the request is judged by its own Host header, as before.
        self.assertEqual(self.login({'Origin':'http://localhost:3000'}),403)

    def test_a_local_copy_answers_only_to_localhost(self):
        self.assertEqual(self.login({'X-Forwarded-Host':'evil.example','Origin':'http://evil.example'}),403)

    def test_with_a_secret_only_the_web_app_holding_it_is_believed(self):
        public = {'X-Forwarded-Host':'support.example.com','Origin':'https://support.example.com'}
        with patch.dict(os.environ,{'BOOKDOSE_PROXY_SECRET':'s3cret-value'}):
            self.assertEqual(self.login(public),403)
            self.assertEqual(self.login({**public,'X-Bookdose-Proxy':'wrong'}),403)
            self.assertEqual(self.login({**public,'X-Bookdose-Proxy':'s3cret-value'}),200)

    def test_sign_in_limits_count_per_forwarded_address(self):
        web = {'X-Forwarded-Host':'localhost:3000','Origin':'http://localhost:3000'}
        # A different email each time, so the per-address limit is what answers (five wrong passwords for one email
        # would lock that email first: security.lockout).
        wrong = lambda index:{'email':f'guess{index}@example.com','password':'Wrong-password-1'}
        for index in range(15):
            self.assertEqual(self.login({**web,'X-Bookdose-Client-IP':'203.0.113.5'},wrong(index)),401)
        self.assertEqual(self.login({**web,'X-Bookdose-Client-IP':'203.0.113.5'},wrong(15)),429)
        # Another visitor behind the same web app is not locked out, and neither is this machine.
        self.assertEqual(self.login({**web,'X-Bookdose-Client-IP':'203.0.113.6'}),200)
        self.assertEqual(self.login({}),200)
        # Sent straight to the Python server, the header is not believed.
        for index in range(15):
            self.login({'X-Bookdose-Client-IP':'198.51.100.7'},wrong(index))
        self.assertEqual(self.login({**web,'X-Bookdose-Client-IP':'198.51.100.7'}),200)

    def test_too_many_reads_say_when_to_ask_again(self):
        # A customer switching chats quickly behind the web app: the reads of this address are used up. The answer
        # says when a read is allowed again (the page asks again then instead of freezing the chat).
        moment = time.monotonic()
        rate_limit.RATES[('public-read','ip','127.0.0.1')].extend([moment-50]+[moment]*179)
        request = urllib.request.Request(self.base+'/api/public/alpha',headers={'X-Forwarded-Host':'localhost:3000'})
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(request,timeout=20)
        with caught.exception as answer:
            data = json.loads(answer.read())
            self.assertEqual(answer.status,429)
            self.assertTrue(1<=data['retry_after']<=11,data)
            self.assertEqual(answer.headers['Retry-After'],str(data['retry_after']))

    def test_keep_alive_outlasts_the_web_app_proxy(self):
        # Node's HTTP agent in Next.js drops an idle connection after 5 s; the server must not close it first, or a
        # request sent on it at that moment fails (ECONNRESET, answered 500 by the web app).
        from backend.asgi import create_app, uvicorn_config
        self.assertGreater(uvicorn_config(create_app(workers=False),'127.0.0.1',0).timeout_keep_alive,5)


if __name__=='__main__':
    unittest.main()
