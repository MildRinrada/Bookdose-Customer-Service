"""What customers ask of the team while they wait and when they come back: ไม่รีบ (portal/no_rush.py), ขอคนเดิม
(portal/same_member.py), ฉันก็เจอ on a known issue (incidents/service.py) and ช่วงเวลาห้ามรบกวน (customers/notify.py).
Disposable databases."""
import datetime as dt
import unittest

import test_guest_chat as guest_tests
from test_guest_chat import GUEST
from backend.database import db as D
from backend.utils.dates import now

THAI = dt.timezone(dt.timedelta(hours=7))
REPORTER = 'b1c2d3e4f5a60718293a4b5c6d7e8f90'


class CustomerCareTests(guest_tests.GuestChatTests):
    # Only the helpers of the guest chat tests, not their tests.
    def fresh_queue(self):
        from backend.modules.conversations import queue
        queue._cache.clear()

    def ticket_of(self, conv):
        with D.tenant(self.org) as db:
            return D.one(db,'SELECT t.* FROM tickets t JOIN ticket_conversations tc ON tc.ticket_id=t.id WHERE tc.conversation_id=?',(conv,))

    # ไม่รีบ
    def test_no_rush_goes_behind_and_the_case_keeps_the_promise(self):
        first,second = self.browser(),self.browser()
        a = self.started(first)
        b = self.started(second,body='ขอสอบถามอีกเรื่องค่ะ')
        self.fresh_queue()
        place = self.ok(first,GUEST+'/session')['queue']['position']
        self.assertEqual(self.ok(second,GUEST+'/session')['queue']['position'],place+1)
        said = self.ok(first,GUEST+'/no-rush',{'on':True})['no_rush']
        self.assertTrue(said['until'] and said['text'].endswith('น.'))
        self.fresh_queue()
        queue = self.ok(first,GUEST+'/session')['queue']
        self.assertEqual(queue['no_rush']['until'],said['until'])
        # The one who did not say it goes ahead.
        self.assertEqual(self.ok(second,GUEST+'/session')['queue']['position'],place)
        self.assertGreater(queue['position'],place)
        # A case opened in the same wait keeps the promise; the team sees why.
        ticket = self.ok(self.admin,f'/api/conversations/{a}/ticket',{})['id']
        self.assertEqual(self.ticket_of(a)['first_response_due_at'],said['until'])
        self.assertGreaterEqual(self.ticket_of(a)['resolution_due_at'],said['until'])
        self.assertEqual(self.ok(self.admin,f'/api/tickets/{ticket}')['ticket']['no_rush']['until'],said['until'])
        self.assertEqual(self.ok(self.admin,f'/api/conversations/{a}')['conversation']['no_rush']['until'],said['until'])
        listed = {c['id']:c['no_rush'] for c in self.ok(self.admin,'/api/conversations')['conversations']}
        self.assertEqual((listed[a],listed[b]),(said['until'],None))
        # A case that was there first: its deadline moves, and goes back when the customer takes it back.
        self.ok(self.admin,f'/api/conversations/{b}/ticket',{})
        before = self.ticket_of(b)
        self.ok(second,GUEST+'/no-rush',{'on':True})
        self.assertGreater(self.ticket_of(b)['first_response_due_at'],before['first_response_due_at'])
        self.assertIsNone(self.ok(second,GUEST+'/no-rush',{'on':False})['no_rush'])
        after = self.ticket_of(b)
        self.assertEqual((after['first_response_due_at'],after['resolution_due_at']),(before['first_response_due_at'],before['resolution_due_at']))
        # The team replies: the wait is over, and so is ไม่รีบ; there is nothing to say it for until the customer writes.
        self.reply(a)
        self.assertIsNone(self.ok(first,GUEST+'/session')['queue'])
        self.assertIsNone(self.ok(self.admin,f'/api/conversations/{a}')['conversation']['no_rush'])
        self.assertEqual(self.status(first,GUEST+'/no-rush',{'on':True}),409)
        self.assertEqual(self.status(first,GUEST+'/no-rush',{'on':'yes'}),400)

    # ขอคนเดิม
    def test_the_member_of_the_last_case_is_offered_and_takes_the_chat_when_here(self):
        agent,agent_id = self.create_member()
        visitor = self.browser()
        first = self.started(visitor)
        self.assertIsNone(self.overview(visitor)['last_member'])
        ticket = self.ok(self.admin,f'/api/conversations/{first}/ticket',{})['id']
        self.ok(self.admin,f'/api/tickets/{ticket}',{'assignee_id':agent_id,'status':'resolved'},'PATCH')
        offered = self.overview(visitor)['last_member']
        self.assertEqual(offered['name'],'เจ้าหน้าที่ทดสอบ')
        self.assertIsNone(self.overview(self.browser())['last_member'])
        # Here (the app open a minute ago): the new chat is a case of theirs, and the chatbot stays out of it.
        with D.tenant(self.org) as db:
            db.execute('INSERT OR REPLACE INTO agent_activity VALUES(?,?)',(agent_id,now()))
        status,data,_ = self.start(visitor,body='เรื่องเดิมยังไม่หายค่ะ',same_member=True)
        self.assertEqual(status,201,data)
        self.assertEqual(data['asked_member'],{'name':'เจ้าหน้าที่ทดสอบ','given':True})
        self.assertEqual(self.ticket_of(data['id'])['assignee_id'],agent_id)
        header = self.ok(self.admin,f"/api/conversations/{data['id']}")['conversation']['asked_member']
        self.assertEqual((header['name'],header['given']),('เจ้าหน้าที่ทดสอบ',True))
        # Away: the chat goes to the team as usual, and the customer is not told why.
        self.ok(agent,'/api/account/status',{'status':'offline'})
        status,data,_ = self.start(visitor,body='อีกเรื่องค่ะ',same_member=True)
        self.assertEqual(data['asked_member'],{'name':'เจ้าหน้าที่ทดสอบ','given':False})
        self.assertIsNone(self.ticket_of(data['id']))
        header = self.ok(self.admin,f"/api/conversations/{data['id']}")['conversation']['asked_member']
        self.assertEqual((header['given'],header['reason']),(False,'ไม่อยู่'))

    # ฉันก็เจอ
    def test_customers_say_they_hit_a_known_issue_once_per_browser(self):
        issue = self.ok(self.admin,'/api/issues',{'title':'ระบบชำระเงิน'})['issues'][0]['id']
        reader = self.browser()
        path = f'/api/public/alpha/issues/{issue}/affected'
        self.assertEqual(self.ok(reader,'/api/public/alpha/issues')['issues'][0]['affected'],0)
        self.assertEqual(self.ok(reader,path,{'affected':True,'reporter':REPORTER})['affected'],1)
        self.assertEqual(self.ok(reader,path,{'affected':True,'reporter':REPORTER})['affected'],1)
        self.assertEqual(self.ok(reader,path,{'affected':True,'reporter':'c'*32})['affected'],2)
        self.assertEqual(self.ok(reader,path,{'affected':False,'reporter':'c'*32})['affected'],1)
        self.assertEqual(self.ok(self.admin,'/api/issues')['issues'][0]['affected'],1)
        for bad in ({'affected':'yes','reporter':REPORTER},{'affected':True,'reporter':'short'}):
            self.assertEqual(self.status(reader,path,bad),400,bad)
        self.ok(self.admin,f'/api/issues/{issue}',{'status':'resolved'},'PATCH')
        self.assertEqual(self.status(reader,path,{'affected':True,'reporter':'d'*32}),409)
        with D.tenant(self.org) as db:
            self.assertFalse(db.execute('SELECT 1 FROM known_issue_reports WHERE reporter=?',(REPORTER,)).fetchone())

    # ช่วงเวลาห้ามรบกวน
    def test_page_alerts_stay_on_until_the_customer_turns_them_off(self):
        client,_ = base_visitor(self)
        path = '/api/customer/notification-settings'
        self.assertEqual(self.ok(client,path)['page'],{'popup':True,'sound':True})
        self.assertEqual(self.status(client,path,{'page':{'popup':'yes','sound':True}}),400)
        self.assertEqual(self.ok(client,path,{'page':{'popup':True,'sound':False}})['page'],{'popup':True,'sound':False})
        # The quiet hours and the events stay as they were.
        view = self.ok(client,path)
        self.assertFalse(view['quiet']['enabled'])
        self.assertTrue(all(e['email'] for e in view['events']))

    def test_quiet_hours_hold_notices_until_they_end(self):
        from backend.modules.customers import notify, repository as accounts, service as customers
        client,conv = base_visitor(self)
        local = dt.datetime.now(THAI)
        start,end = (local-dt.timedelta(hours=1)).strftime('%H:%M'),(local+dt.timedelta(hours=1)).strftime('%H:%M')
        path = '/api/customer/notification-settings'
        self.assertEqual(self.status(client,path,{'quiet':{'enabled':True,'start':'21:00','end':'21:00'}}),400)
        saved = self.ok(client,path,{'quiet':{'enabled':True,'start':start,'end':end}})['quiet']
        self.assertEqual(saved,{'enabled':True,'start':start,'end':end})
        # The events stay as they were.
        self.assertTrue(all(e['email'] for e in self.ok(client,path)['events']))
        with D.control() as cd:
            account = accounts.find(cd,accounts.find_by_email(cd,'visitor@example.com')['id'])
        until = notify.quiet_until(account)
        self.assertIsNotNone(until)
        self.assertIsNone(notify.quiet_until(account,until+dt.timedelta(minutes=1)))
        # A LINE or email notice due now waits for the end, without counting as a try.
        with D.tenant(self.org) as db:
            accounts.insert_alert(db,'a'*32,account['id'],'email','ทดสอบ','ข้อความ','/customer/alerts')
            db.commit()
        notify.send(self.org)
        # A chat reply's notice waits too, and is looked at again then.
        self.reply(conv)
        with D.tenant(self.org) as db:
            db.execute("UPDATE customer_notifications SET created_at='2000-01-01T00:00:00+00:00' WHERE sent_at IS NULL")
            db.execute("UPDATE customer_seen SET seen_at='1999-01-01T00:00:00+00:00'")
            db.commit()
        customers.send_notices(self.org)
        with D.tenant(self.org) as db:
            alert = D.one(db,'SELECT * FROM customer_alert_outbox WHERE id=?',('a'*32,))
            notice = D.one(db,'SELECT * FROM customer_notifications ORDER BY rowid DESC LIMIT 1')
        self.assertEqual((alert['sent_at'],alert['attempts'],alert['next_at']),(None,0,until.isoformat(timespec='seconds')))
        self.assertEqual((notice['sent_at'],notice['held_until']),(None,until.isoformat(timespec='seconds')))


def base_visitor(test):
    import test_app as base
    return base.IntegrationTests.visitor(test)


# Only these tests here: the guest chat's own run in their file.
for _name in [n for n in vars(guest_tests.GuestChatTests) if n.startswith('test_')]:
    setattr(CustomerCareTests, _name, None)


if __name__ == '__main__':
    unittest.main()
