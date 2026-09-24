"""คุยต่อใน LINE: a web chat carried to the organization's LINE with a code - the same conversation, history and all,
what the customer writes on LINE lands in it, the team's replies go out on LINE, and the web page reads it without a
box to write in."""
import json
import unittest

import test_guest_chat as guest_tests
from test_app import D
from backend.modules.channels import service as C

GUEST = guest_tests.GUEST
SENDER = guest_tests.SENDER


class LineMoveTests(unittest.TestCase):
    def line_on(self):
        self.route = self.configure()['route_id']
        with D.tenant(self.org) as db:
            config = json.loads(db.execute("SELECT config FROM channel_settings WHERE kind='line'").fetchone()[0])
            db.execute("UPDATE channel_settings SET config=? WHERE kind='line'",(json.dumps({**config,'basic_id':'@bookdose'}),))
            db.commit()

    def session(self, page):
        return self.ok(page,GUEST+'/session')

    def test_a_web_chat_goes_on_in_line(self):
        page = self.browser()
        conv = self.started(page,body='สั่งหนังสือไปแล้วยังไม่ได้รับค่ะ')
        # No LINE for the organization: nothing offered, and asking is refused.
        self.assertIsNone(self.session(page)['line'])
        self.assertEqual(self.status(page,GUEST+'/line-continue',{}),409)
        self.line_on()
        self.assertEqual(self.session(page)['line']['moved'],False)
        answer = self.ok(page,GUEST+'/line-continue',{})
        self.assertRegex(answer['code'],r'^[0-9]{6}$')
        # The link opens LINE with the code typed in.
        self.assertEqual(answer['send_url'],f"https://line.me/R/oaMessage/%40bookdose/?{answer['code']}")
        # The customer already had a LINE chat with the organization.
        self.say('สวัสดีค่ะ แชทเก่าใน LINE')
        with D.tenant(self.org) as db:
            old = db.execute("SELECT id FROM conversations WHERE channel='line'").fetchone()[0]
        self.say(answer['code'])
        with D.tenant(self.org) as db:
            channel = db.execute('SELECT channel FROM conversations WHERE id=?',(conv,)).fetchone()[0]
            code_seen = db.execute('SELECT COUNT(*) FROM messages WHERE body=?',(answer['code'],)).fetchone()[0]
        self.assertEqual(channel,'line')
        self.assertEqual(code_seen,0)   # the code is never a message in the team's inbox
        # The confirmation goes to LINE, and is not the team's first response.
        self.assertTrue(C.process_outbox(self.org))
        self.assertEqual(self.line.call_args.args[1],SENDER)
        self.assertIn('มาคุยต่อใน LINE แล้ว',self.line.call_args.args[2])
        # What they write on LINE now lands in the same chat, after the web messages.
        self.say('ขอเลขพัสดุด้วยค่ะ')
        staff = self.ok(self.admin,f'/api/conversations/{conv}')
        self.assertEqual([m['body'] for m in staff['messages'] if m['kind']=='customer'],
                         ['สั่งหนังสือไปแล้วยังไม่ได้รับค่ะ','ขอเลขพัสดุด้วยค่ะ'])
        self.assertEqual(staff['conversation']['channel'],'line')
        old_bodies = [m['body'] for m in self.ok(self.admin,f'/api/conversations/{old}')['messages']]
        self.assertEqual(old_bodies,['สวัสดีค่ะ แชทเก่าใน LINE'])
        # The team's reply goes out on LINE.
        self.line.reset_mock()
        self.reply(conv,'เลขพัสดุคือ TH123 ค่ะ')
        self.assertTrue(C.process_outbox(self.org))
        self.assertEqual((self.line.call_args.args[1],self.line.call_args.args[2]),(SENDER,'เลขพัสดุคือ TH123 ค่ะ'))
        # The web page still reads it all, says where it went and takes no more messages.
        shown = self.session(page)
        self.assertEqual(shown['line'],{'moved':True,'oa_name':'Test OA','open_url':'https://line.me/R/oaMessage/%40bookdose/'})
        self.assertIn('เลขพัสดุคือ TH123 ค่ะ',[m['body'] for m in shown['messages']])
        self.assertEqual(self.status(page,GUEST+'/messages',{'body':'ยังอยู่ไหมคะ'}),409)
        self.assertEqual(self.status(page,GUEST+'/line-continue',{}),409)
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM audit_logs WHERE action='conversation.moved_to_line'").fetchone()[0],1)

    def test_a_signed_in_customer_asks_the_same_way(self):
        import test_app as base
        client,conv = base.IntegrationTests.visitor(self,'alpha','member@example.com','Order','ของยังไม่มาค่ะ')
        self.line_on()
        self.assertFalse(self.ok(client,'/api/public/alpha/session')['line']['moved'])
        answer = self.ok(client,'/api/public/alpha/line/continue',{})
        self.say(answer['code'])
        self.assertTrue(self.ok(client,'/api/public/alpha/session')['line']['moved'])
        # Still in the customer's own list of chats on the web.
        self.assertIn(conv,[c['id'] for c in self.ok(client,'/api/customer/overview').get('conversations',[])]
                      or [c['id'] for c in self.ok(client,'/api/customer/dashboard').get('conversations',[])])

    def test_a_wrong_or_expired_code_moves_nothing(self):
        page = self.browser()
        conv = self.started(page)
        self.line_on()
        answer = self.ok(page,GUEST+'/line-continue',{})
        self.say(f"{(int(answer['code'])+1)%10**6:06d}")
        with D.tenant(self.org) as db:
            db.execute("UPDATE line_move_codes SET expires_at='2000-01-01T00:00:00+00:00'")
            db.commit()
        self.say(answer['code'])
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute('SELECT channel FROM conversations WHERE id=?',(conv,)).fetchone()[0],'web')
        self.assertFalse(self.session(page)['line']['moved'])


# The setUp, the helpers and the LINE test tools of the guest chat tests, without their tests.
for _name, _member in vars(guest_tests.GuestChatTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(LineMoveTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
