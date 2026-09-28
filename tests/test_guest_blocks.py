"""Stopping trouble on guest web chat (guest/blocks.py): the daily count of new chats per address kept in the database,
an owner blocking a guest from the inbox (its open chats close, it can read but not write or start, its addresses are
held for days, loopback never), agents refused, lifting the block from the inbox or the settings list, a signed-in
customer's chat never blockable, erasing the guest's name from the block, and the clean-up of old addresses."""
import unittest

import test_app as base
import test_guest_chat as guest_tests
from test_app import D, rate_limit
from backend.modules.guest import blocks
from backend.utils.dates import after

GUEST = guest_tests.GUEST
ORG = guest_tests.ORG


class GuestBlockTests(unittest.TestCase):
    Chat = guest_tests.GuestChatTests
    setUp, tearDown, ok, status, browser = Chat.setUp, Chat.tearDown, Chat.ok, Chat.status, Chat.browser
    start, started, create_member, CUSTOMER_PASSWORD = Chat.start, Chat.started, Chat.create_member, Chat.CUSTOMER_PASSWORD
    customer, customer_mail, mail_link = Chat.customer, Chat.customer_mail, Chat.mail_link
    enable_registration_mail = Chat.enable_registration_mail

    def test_daily_count_per_address_is_kept_in_the_database(self):
        page = self.browser()
        conv = self.started(page)
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute('SELECT ip FROM guest_conversations WHERE conversation_id=?',(conv,)).fetchone()[0],'127.0.0.1')
            # 19 more today from this address (others' browsers), and many from yesterday that no longer count.
            db.executemany('INSERT INTO guest_conversations(conversation_id,visitor_id,created_at,ip) VALUES(?,?,?,?)',
                           [(f'x{n}','someone',after(hours=-2),'127.0.0.1') for n in range(19)]
                           +[(f'y{n}','someone',after(hours=-30),'127.0.0.1') for n in range(40)])
        status,data,_ = self.start(self.browser())
        self.assertEqual((status,data['error']),(429,blocks.TOO_MANY_TODAY))
        # The hourly count kept in memory is gone after a restart; this one is not.
        rate_limit.RATES.clear()
        self.assertEqual(self.start(page)[0],429)
        with D.tenant(self.org) as db:
            db.execute("DELETE FROM guest_conversations WHERE conversation_id='x0'")
        self.assertEqual(self.start(page)[0],201)

    def test_owner_blocks_a_guest_from_the_inbox(self):
        troll,other = self.browser(),self.browser()
        first = self.started(troll,body='ป่วน 1')
        second = self.started(troll,body='ป่วน 2')
        kept = self.started(other,body='ลูกค้าจริง')
        detail = self.ok(self.admin,f'/api/conversations/{first}')['conversation']
        self.assertEqual(detail['guest_block'],{'block':None})
        # Only owners.
        agent,_ = self.create_member()
        status,data = agent.call(f'/api/conversations/{first}/guest-block',{})
        self.assertEqual((status,data['error']),(403,'เฉพาะเจ้าขององค์กรที่บล็อกหรือปลดบล็อกผู้เยี่ยมชมได้'))
        result = self.ok(self.admin,f'/api/conversations/{first}/guest-block',{})
        self.assertEqual(result['closed'],2)
        # The test server sees the browser as loopback: never held.
        self.assertIsNone(result['block']['network_until'])
        self.assertEqual(result['block']['blocked_by'],'ผู้ดูแลองค์กร A')
        with D.tenant(self.org) as db:
            status = dict(db.execute('SELECT id,status FROM conversations WHERE id IN (?,?,?)',(first,second,kept)).fetchall())
            self.assertEqual(status,{first:'closed',second:'closed',kept:'open'})
            self.assertEqual(db.execute('SELECT COUNT(*) FROM guest_block_ips').fetchone()[0],0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM audit_logs WHERE action='guest.blocked'").fetchone()[0],1)
        # Blocking again changes nothing.
        self.assertEqual(self.ok(self.admin,f'/api/conversations/{second}/guest-block',{})['closed'],0)
        self.assertIsNotNone(self.ok(self.admin,f'/api/conversations/{second}')['conversation']['guest_block']['block'])
        # The guest reads, and writes nothing.
        troll.conversation = first
        self.assertEqual(self.status(troll,GUEST+'/session'),200)
        for path,body in ((GUEST+'/messages',{'body':'อีกแล้ว'}),(GUEST+'/name',{'name':'ชื่อป่วน'}),(GUEST+'/link',{'via':'email','to':'a@example.com'}),
                          (GUEST+'/line-code',{}),(GUEST+'/handoff',{})):
            rate_limit.RATES.clear()
            status,data = troll.call(path,body)
            self.assertEqual((status,data['error']),(403,blocks.BLOCKED),path)
        status,data,_ = self.start(troll)
        self.assertEqual((status,data['error']),(403,blocks.BLOCKED))
        # Other guests go on as before.
        other.conversation = kept
        self.assertEqual(self.status(other,GUEST+'/messages',{'body':'ยังคุยได้'}),201)
        # Lifted from the inbox: the guest writes again; its chats stay closed until someone writes.
        self.ok(self.admin,f'/api/conversations/{first}/guest-block',method='DELETE')
        self.assertEqual(self.ok(self.admin,f'/api/conversations/{first}')['conversation']['guest_block'],{'block':None})
        self.assertEqual(self.status(troll,GUEST+'/messages',{'body':'ขอโทษค่ะ'}),201)
        self.assertEqual(self.status(self.admin,f'/api/conversations/{first}/guest-block',None,'DELETE'),404)
        # Letting the browser forget it still works while blocked.
        self.ok(self.admin,f'/api/conversations/{first}/guest-block',{})
        self.assertEqual(self.status(troll,GUEST+'/forget',{}),200)

    def test_addresses_are_held_for_days_and_the_list_lifts_a_block(self):
        troll = self.browser()
        conv = self.started(troll)
        with D.tenant(self.org) as db:
            db.execute("UPDATE guest_conversations SET ip='203.0.113.9' WHERE conversation_id=?",(conv,))
            db.execute("UPDATE guest_devices SET ip='::1'")
        block = self.ok(self.admin,f'/api/conversations/{conv}/guest-block',{})['block']
        self.assertGreater(block['network_until'],after(days=6))
        with D.tenant(self.org) as db:
            self.assertEqual([r[0] for r in db.execute('SELECT ip FROM guest_block_ips')],['203.0.113.9'])
            # A new guest from that address cannot start; another address can; a signed-in customer is never touched.
            with self.assertRaises(Exception) as caught:
                blocks.check_start(db,None,'203.0.113.9')
            self.assertEqual((caught.exception.status,caught.exception.message),(403,blocks.NETWORK_BLOCKED))
            blocks.check_start(db,None,'203.0.113.10')
        customer = self.customer()
        self.assertTrue(self.ok(customer,ORG+'/conversations',{'subject':'บัญชี','body':'สมาชิกคุยได้'})['id'])
        listed = self.ok(self.admin,'/api/settings/guest-blocks')['blocks']
        self.assertEqual([(b['id'],b['conversation_id'],b['subject']) for b in listed],[(block['id'],conv,'สอบถามเวลาทำการค่ะ')])
        agent,_ = self.create_member()
        self.assertEqual(agent.call('/api/settings/guest-blocks')[0],403)
        self.assertEqual(agent.call(f'/api/settings/guest-blocks/{block["id"]}',None,'DELETE')[0],403)
        # The days are over: the address goes at the next clean-up, the guest stays blocked.
        with D.tenant(self.org) as db:
            db.execute("UPDATE guest_block_ips SET until='2000-01-01T00:00:00+00:00'")
            db.execute("UPDATE guest_conversations SET created_at='2000-01-01T00:00:00+00:00'")
            blocks.cleanup(db)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM guest_block_ips').fetchone()[0],0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM guest_conversations WHERE ip<>''").fetchone()[0],0)
            blocks.check_start(db,None,'203.0.113.9')
        troll.conversation = conv
        self.assertEqual(self.status(troll,GUEST+'/messages',{'body':'ยังโดนบล็อก'}),403)
        self.ok(self.admin,f'/api/settings/guest-blocks/{block["id"]}',method='DELETE')
        self.assertEqual(self.ok(self.admin,'/api/settings/guest-blocks')['blocks'],[])
        self.assertEqual(self.status(self.admin,f'/api/settings/guest-blocks/{block["id"]}',None,'DELETE'),404)

    def test_only_a_guest_chat_can_be_blocked_and_erasing_forgets_the_name(self):
        customer = self.customer()
        member_chat = self.ok(customer,ORG+'/conversations',{'subject':'บัญชี','body':'ของสมาชิก'})['id']
        self.assertIsNone(self.ok(self.admin,f'/api/conversations/{member_chat}')['conversation']['guest_block'])
        status,data = self.admin.call(f'/api/conversations/{member_chat}/guest-block',{})
        self.assertEqual((status,data['error']),(409,blocks.NOT_GUEST))
        troll = self.browser()
        conv = self.started(troll,name='คนป่วน')
        self.ok(self.admin,f'/api/conversations/{conv}/guest-block',{})
        self.assertEqual(self.ok(self.admin,'/api/settings/guest-blocks')['blocks'][0]['name'],'คนป่วน')
        contact = self.ok(self.admin,f'/api/conversations/{conv}')['contact']['id']
        with D.tenant(self.org) as db:
            from backend.modules.guest import service as guest
            guest.forget_contact(db,contact)
        listed = self.ok(self.admin,'/api/settings/guest-blocks')['blocks'][0]
        self.assertEqual((listed['name'],listed['subject']),('ผู้เยี่ยมชม',''))


if __name__ == '__main__':
    unittest.main()
