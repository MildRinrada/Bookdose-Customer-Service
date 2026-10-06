"""What signing in gives a customer over a guest: a new chat that says which earlier chat it carries on from (the team
sees it), sending a finished case back within 7 days, keeping a chat or a case as a file, hearing when a known issue
is fixed, and - when the organization turns it on - going ahead of guests in the queue."""
import unittest

import test_app as base
from test_app import D
from backend.modules.conversations import queue
from backend.utils.dates import after

PUBLIC = '/api/public/alpha'


class MemberPerksTests(unittest.TestCase):
    def test_a_new_chat_carries_on_from_an_earlier_one(self):
        customer,first = self.visitor(subject='เข้าระบบไม่ได้')
        second = self.ok(customer,f'{PUBLIC}/conversations',{'subject':'ยังเข้าไม่ได้อีก','body':'ลองใหม่แล้ว','follows':first})['id']
        detail = self.ok(self.admin,f'/api/conversations/{second}')['conversation']
        self.assertEqual((detail['follows']['id'],detail['follows']['subject']),(first,'เข้าระบบไม่ได้'))
        self.assertTrue(detail['member'])
        listed = {c['id']:c for c in self.ok(self.admin,'/api/conversations')['conversations']}
        self.assertTrue(listed[second]['member'])
        self.assertIsNone(self.ok(self.admin,f'/api/conversations/{first}')['conversation']['follows'])
        # Only a chat of their own.
        other,theirs = self.visitor(email='other@example.com')
        status,_ = customer.call(f'{PUBLIC}/conversations',{'subject':'x','body':'y','follows':theirs})
        self.assertEqual(status,404)

    def test_a_finished_case_goes_back_within_seven_days(self):
        customer,chat = self.visitor()
        ticket = self.ok(self.admin,f'/api/conversations/{chat}/ticket',{})['id']
        # Still being worked on: nothing to send back.
        self.assertFalse(self.ok(customer,f'{PUBLIC}/cases/{ticket}')['reopen']['allowed'])
        self.assertEqual(customer.call(f'{PUBLIC}/cases/{ticket}/reopen',{})[0],409)
        self.ok(self.admin,f'/api/tickets/{ticket}',{'status':'resolved'},'PATCH')
        self.assertTrue(self.ok(customer,f'{PUBLIC}/cases/{ticket}')['reopen']['allowed'])
        answer = self.ok(customer,f'{PUBLIC}/cases/{ticket}/reopen',{'message':'กดแล้วยังค้าง'})
        self.assertEqual(answer['conversation_id'],chat)
        self.assertEqual(self.ok(self.admin,f'/api/tickets/{ticket}')['ticket']['status'],'open')
        last = self.ok(self.admin,f'/api/conversations/{chat}')['messages'][-1]
        self.assertEqual((last['kind'],last['body']),('customer','ปัญหายังไม่หาย: กดแล้วยังค้าง'))
        # Finished more than seven days ago: start a new chat instead.
        self.ok(self.admin,f'/api/tickets/{ticket}',{'status':'resolved'},'PATCH')
        with D.tenant(self.org) as db:
            db.execute('UPDATE tickets SET resolved_at=?,updated_at=? WHERE id=?',(after(days=-8),after(days=-8),ticket))
            db.commit()
        self.assertFalse(self.ok(customer,f'{PUBLIC}/cases/{ticket}')['reopen']['allowed'])
        self.assertEqual(customer.call(f'{PUBLIC}/cases/{ticket}/reopen',{})[0],409)
        # Not someone else's.
        other,_ = self.visitor(email='other@example.com')
        self.assertEqual(other.call(f'{PUBLIC}/cases/{ticket}/reopen',{})[0],404)

    def test_a_customer_finishes_their_own_case(self):
        customer,chat = self.visitor()
        ticket = self.ok(self.admin,f'/api/conversations/{chat}/ticket',{})['id']
        self.ok(self.admin,'/api/automation/settings',{'escalation_enabled':False,'escalation_minutes':15,'csat_enabled':True,'csat_message':'ให้คะแนนหน่อยครับ'},'PATCH')
        self.assertTrue(self.ok(customer,f'{PUBLIC}/cases/{ticket}')['resolve']['allowed'])
        self.ok(customer,f'{PUBLIC}/cases/{ticket}/resolve',{})
        detail = self.ok(self.admin,f'/api/tickets/{ticket}')
        self.assertEqual(detail['ticket']['status'],'resolved')
        self.assertIsNotNone(detail['ticket']['resolved_at'])
        self.assertIn('ticket.customer_resolved',[e['action'] for e in detail['events']])
        # The survey follows, as when a member finishes the case.
        self.assertEqual(self.ok(self.admin,f'/api/conversations/{chat}')['messages'][-1]['body'],'ให้คะแนนหน่อยครับ')
        # Finished: nothing more to finish, but it can go back.
        view = self.ok(customer,f'{PUBLIC}/cases/{ticket}')
        self.assertFalse(view['resolve']['allowed'])
        self.assertTrue(view['reopen']['allowed'])
        self.assertEqual(customer.call(f'{PUBLIC}/cases/{ticket}/resolve',{})[0],409)
        # Not someone else's.
        other,_ = self.visitor(email='other@example.com')
        self.assertEqual(other.call(f'{PUBLIC}/cases/{ticket}/resolve',{})[0],404)

    def test_a_customer_closes_from_the_chat_with_the_word_or_the_button(self):
        customer,chat = self.visitor()
        ticket = self.ok(self.admin,f'/api/conversations/{chat}/ticket',{})['id']
        self.ok(self.admin,'/api/automation/settings',{'escalation_enabled':False,'escalation_minutes':15,'csat_enabled':False,'csat_message':'x'},'PATCH')
        status = lambda: self.ok(self.admin,f'/api/tickets/{ticket}')['ticket']['status']
        last = lambda: self.ok(customer,f'{PUBLIC}/session')['messages'][-1]
        # A sentence that has the word in it asks nothing; the word alone (politeness aside) brings the question.
        self.ok(customer,f'{PUBLIC}/messages',{'body':'ถ้าแก้ไม่ได้ก็ปิดเคสไปเถอะ'})
        self.assertEqual(last()['kind'],'customer')
        self.ok(customer,f'{PUBLIC}/messages',{'body':'ปิดเคสได้เลยค่ะ'})
        self.assertIn('ต้องการปิดเคส BD-',last()['body'])
        self.assertEqual(status(),'new')
        # ไม่ keeps it open; the word again asks again; ใช่ finishes it, and the chat says so.
        self.ok(customer,f'{PUBLIC}/messages',{'body':'ไม่ค่ะ'})
        self.assertEqual(last()['body'],'รับทราบ เรื่องยังเปิดอยู่ ทีมงานดูแลต่อให้')
        self.assertEqual(status(),'new')
        self.ok(customer,f'{PUBLIC}/messages',{'body':'ปิดเคส'})
        self.ok(customer,f'{PUBLIC}/messages',{'body':'ใช่ครับ'})
        self.assertIn('ปิดเคส BD-',last()['body'])
        self.assertEqual(status(),'resolved')
        detail = self.ok(self.admin,f'/api/tickets/{ticket}')
        actions = [e['action'] for e in detail['events']]
        self.assertIn('ticket.close_asked',actions)
        self.assertIn('ticket.customer_resolved',actions)
        # The system's questions are never the team's first reply.
        self.assertIsNone(detail['ticket']['first_response_at'])
        # Writing again reopens, as ever; the button on the chat finishes it without the question.
        self.ok(customer,f'{PUBLIC}/messages',{'body':'เอ๊ะ ยังไม่หาย'})
        self.assertEqual(status(),'open')
        self.ok(customer,f'{PUBLIC}/resolve',{})
        self.assertEqual(status(),'resolved')
        self.assertEqual(customer.call(f'{PUBLIC}/resolve',{})[0],409)
        # A question nobody answers lapses: an ordinary message after it goes on as usual.
        self.ok(customer,f'{PUBLIC}/messages',{'body':'ปิดเคส'})
        self.assertEqual(status(),'open')
        self.ok(customer,f'{PUBLIC}/messages',{'body':'ขอถามเพิ่มอีกเรื่องค่ะ'})
        self.assertEqual(last()['kind'],'customer')
        self.ok(customer,f'{PUBLIC}/messages',{'body':'ใช่'})
        self.assertEqual(status(),'open')

    def test_a_chat_and_a_case_download_as_text(self):
        customer,chat = self.visitor(subject='ขอใบเสร็จย้อนหลัง',body='ต้องการของเดือนที่แล้ว')
        self.ok(self.admin,f'/api/conversations/{chat}/messages',{'kind':'note','body':'โน้ตภายในห้ามหลุด'})
        self.ok(self.admin,f'/api/conversations/{chat}/messages',{'kind':'reply','body':'ส่งให้ทางอีเมลแล้วครับ'})
        status,content = customer.call(f'{PUBLIC}/conversations/{chat}/export')
        self.assertEqual(status,200)
        text = content.decode('utf-8-sig')
        for line in ('ประวัติการคุย: ขอใบเสร็จย้อนหลัง','ต้องการของเดือนที่แล้ว','ส่งให้ทางอีเมลแล้วครับ'):
            self.assertIn(line,text)
        self.assertNotIn('โน้ตภายในห้ามหลุด',text)
        ticket = self.ok(self.admin,f'/api/conversations/{chat}/ticket',{})['id']
        status,content = customer.call(f'{PUBLIC}/cases/{ticket}/export')
        self.assertEqual(status,200)
        self.assertIn('ส่งให้ทางอีเมลแล้วครับ',content.decode('utf-8-sig'))
        other,_ = self.visitor(email='other@example.com')
        self.assertEqual(other.call(f'{PUBLIC}/conversations/{chat}/export')[0],404)

    def test_a_followed_issue_tells_the_customer_once_fixed(self):
        customer,_ = self.visitor()
        issue = self.ok(self.admin,'/api/issues',{'title':'ระบบชำระเงิน','detail':'กำลังแก้ไข'})['issues'][0]['id']
        self.assertEqual(self.ok(customer,f'{PUBLIC}/issues/{issue}/follow',{'follow':True})['following'],[issue])
        self.assertEqual(self.ok(customer,f'{PUBLIC}/issues/following')['following'],[issue])
        self.ok(self.admin,f'/api/issues/{issue}',{'status':'resolved'},'PATCH')
        with D.tenant(self.org) as db:
            queued = db.execute("SELECT channel,subject FROM customer_alert_outbox WHERE dedup_key LIKE 'issue:%'").fetchall()
            told = db.execute('SELECT told_at FROM known_issue_followers WHERE issue_id=?',(issue,)).fetchone()[0]
        self.assertEqual([(q[0],q[1]) for q in queued],[('email','องค์กร A แก้ปัญหา “ระบบชำระเงิน” แล้ว')])
        self.assertIsNotNone(told)
        # The worker sends it to the proven address, with the link to the notifications page.
        from backend.modules.customers import notify
        before = self.mailer.call_count
        self.assertEqual(notify.send(self.org),1)
        mail = self.mailer.call_args_list[before].args[3]
        self.assertEqual((mail['To'],mail['Subject']),('visitor@example.com','องค์กร A แก้ปัญหา “ระบบชำระเงิน” แล้ว'))
        self.assertIn('/customer/alerts',mail.get_content())
        alerts = self.ok(customer,'/api/customer/overview')['alerts']
        self.assertIn(('issue','ระบบชำระเงิน'),[(a['kind'],a['subject']) for a in alerts])
        # Once told, not again; a fixed issue cannot be followed.
        self.ok(self.admin,f'/api/issues/{issue}',{'status':'active'},'PATCH')
        self.ok(self.admin,f'/api/issues/{issue}',{'status':'resolved'},'PATCH')
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM customer_alert_outbox WHERE dedup_key LIKE 'issue:%'").fetchone()[0],1)
        self.assertEqual(customer.call(f'{PUBLIC}/issues/{issue}/follow',{'follow':True})[0],409)
        # Guests and visitors who are not signed in cannot follow.
        self.assertEqual(base.Client(self.base).call(f'{PUBLIC}/issues/following')[0],401)

    def test_members_go_first_when_the_organization_says_so(self):
        _,guest_chat = self.visitor(email='early@example.com')
        _,member_chat = self.visitor(email='late@example.com')
        with D.tenant(self.org) as db:
            # The first one becomes a guest's: its contact belongs to no account.
            contact = db.execute('SELECT contact_id FROM conversations WHERE id=?',(guest_chat,)).fetchone()[0]
            db.execute('DELETE FROM customer_contacts WHERE contact_id=?',(contact,))
            db.execute('DELETE FROM customer_members WHERE contact_id=?',(contact,))
            db.commit()
            order = [c['id'] for c in queue._waiting(db) if c['id'] in (guest_chat,member_chat)]
        self.assertEqual(order,[guest_chat,member_chat])
        settings = self.ok(self.admin,'/api/settings/guest-chat')
        self.assertFalse(settings['members_first'])
        self.ok(self.admin,'/api/settings/guest-chat',{'members_first':True})
        self.assertTrue(self.ok(self.admin,'/api/settings/guest-chat')['members_first'])
        with D.tenant(self.org) as db:
            order = [c['id'] for c in queue._waiting(db) if c['id'] in (guest_chat,member_chat)]
        self.assertEqual(order,[member_chat,guest_chat])
        self.assertEqual(self.admin.call('/api/settings/guest-chat',{'members_first':'yes'})[0],400)


# The setUp, the sign-ins and the helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(MemberPerksTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
