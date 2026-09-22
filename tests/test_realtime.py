"""Realtime hints over WebSocket (docs/REALTIME-DESIGN.md): the handshake of staff, customers and guests (Origin,
cookie, session checked again), who hears about which change (public replies but never internal notes, nothing from
another customer, guest or organization, agents only their team), typing (who may type, throttling), read receipts
both ways, events only after the transaction commits, a LINE message stored by a worker thread, and the frame, socket
and idle limits. WebSocket exists only on FastAPI: the socket tests are skipped under BOOKDOSE_SERVER=legacy, where
publishing is a no-op (checked below without a server)."""
import contextlib
import io
import json
import sqlite3
import threading
import time
import unittest
from unittest.mock import patch

import test_app as base
import test_channels as channel_tests
from test_app import app, Client, D, rate_limit
from backend.database.db import Connection, after_commit
from backend.realtime.hub import Hub, hub

LEGACY = app.settings.SERVER=='legacy'
if not LEGACY:
    from websockets.exceptions import ConnectionClosed
    from websockets.sync.client import connect
    from backend.realtime import socket as S

STAFF = '/api/realtime/staff'
CUSTOMER = '/api/realtime/customer'
GUEST = '/api/public/alpha/guest/realtime'


class AfterCommitTests(unittest.TestCase):
    """Both servers: the connection hook, and publishing with no event loop attached."""

    def test_callbacks_run_after_commit_only_once_and_never_after_rollback(self):
        calls = []
        db = sqlite3.connect(':memory:',factory=Connection)
        db.execute('CREATE TABLE t(x)')
        db.execute('INSERT INTO t VALUES(1)')
        after_commit(db,'a',lambda:calls.append('a'))
        after_commit(db,'a',lambda:calls.append('duplicate'))
        self.assertEqual(calls,[])
        db.rollback()
        db.commit()
        self.assertEqual(calls,[])
        db.execute('INSERT INTO t VALUES(2)')
        after_commit(db,'b',lambda:calls.append('b'))
        after_commit(db,'c',lambda:1/0)
        after_commit(db,'d',lambda:calls.append('d'))
        with contextlib.redirect_stdout(io.StringIO()) as log:
            db.commit()
        db.commit()
        self.assertIn('After commit: ZeroDivisionError',log.getvalue())
        self.assertEqual(calls,['b','d'])
        plain = sqlite3.connect(':memory:')
        after_commit(plain,'e',lambda:calls.append('e'))
        self.assertEqual(calls,['b','d','e'])

    def test_hub_without_loop_is_a_no_op(self):
        lonely = Hub()
        self.assertFalse(lonely.listening())
        lonely.send([(('account','x'),{'type':'changed','scope':'alerts'})])
        if LEGACY:
            self.assertFalse(hub.listening())


class FakeSocket:
    def __init__(self, key):
        self.key = key


class HubTests(unittest.TestCase):
    def test_socket_limit_per_session(self):
        lonely = Hub()
        sockets = [FakeSocket('k') for _ in range(5)]
        self.assertTrue(all(lonely.add(s) for s in sockets))
        self.assertFalse(lonely.add(FakeSocket('k')))
        self.assertTrue(lonely.add(FakeSocket('other')))
        lonely.remove(sockets[0])
        self.assertTrue(lonely.add(FakeSocket('k')))


@unittest.skipIf(LEGACY,'WebSocket runs only on FastAPI (BOOKDOSE_SERVER=legacy has none)')
class RealtimeTests(unittest.TestCase):
    ok = base.IntegrationTests.ok
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    customer = base.IntegrationTests.customer
    create_member = base.IntegrationTests.create_member
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD
    configure = channel_tests.ChannelTests.configure
    webhook = channel_tests.ChannelTests.webhook
    event = channel_tests.ChannelTests.event

    def setUp(self):
        base.IntegrationTests.setUp(self)
        self.sockets = []

    def tearDown(self):
        for ws in self.sockets:
            try:
                ws.close()
            except Exception:
                pass
        base.IntegrationTests.tearDown(self)

    # Helpers
    def socket(self, client=None, path=STAFF, origin='same', cookie=None, headers=None):
        """An open WebSocket as this client's browser (its cookies, this site's Origin unless told otherwise)."""
        if cookie is None:
            cookie = '; '.join(f'{c.name}={c.value}' for c in client.jar) if client else ''
        extra = {**({'Cookie':cookie} if cookie else {}),**(headers or {})}
        ws = connect(f'ws://127.0.0.1:{self.server.server_port}{path}',origin=self.base if origin=='same' else origin,
                     additional_headers=extra or None,open_timeout=10,close_timeout=2)
        self.sockets.append(ws)
        return ws

    def joined(self, client=None, path=STAFF, **options):
        """A socket that passed the handshake (its hello received)."""
        ws = self.socket(client,path,**options)
        self.assertEqual(self.frame(ws),{'type':'hello','poll_ms':60000})
        return ws

    def frame(self, ws, timeout=5):
        return json.loads(ws.recv(timeout=timeout))

    def closed(self, ws, code):
        with self.assertRaises(ConnectionClosed) as caught:
            for _ in range(100):
                ws.recv(timeout=10)
        self.assertEqual(caught.exception.rcvd.code,code)

    def until(self, ws, match, timeout=5):
        """The first frame for which match(frame) is true (earlier frames are skipped)."""
        deadline = time.monotonic()+timeout
        while True:
            left = deadline-time.monotonic()
            if left<=0:
                self.fail('the expected event did not arrive')
            try:
                data = self.frame(ws,left)
            except TimeoutError:
                self.fail('the expected event did not arrive')
            if match(data):
                return data

    def quiet(self, ws, seconds=0.6):
        """Every frame arriving within `seconds` (pings left out)."""
        found,deadline = [],time.monotonic()+seconds
        while (left:=deadline-time.monotonic())>0:
            try:
                data = self.frame(ws,left)
            except TimeoutError:
                break
            if data!={'type':'ping'}:
                found.append(data)
        return found

    def changed(self, scope, entity_id=None, org='alpha'):
        return lambda f:f.get('type')=='changed' and f.get('scope')==scope and f.get('id')==entity_id and f.get('org',org)==org

    def chat(self, client, subject='ต้องการความช่วยเหลือ', body='เปิดหนังสือไม่ได้', slug='alpha'):
        rate_limit.RATES.clear()
        return self.ok(client,f'/api/public/{slug}/conversations',{'subject':subject,'body':body})['id']

    def say(self, conversation, kind='reply', body='ตอบกลับแล้วค่ะ'):
        rate_limit.RATES.clear()
        return self.ok(self.admin,f'/api/conversations/{conversation}/messages',{'kind':kind,'body':body})['id']

    def guest(self, name='สมศรี'):
        from test_guest_chat import GuestClient
        page = GuestClient(self.base)
        rate_limit.RATES.clear()
        status,data,_ = page.raw('/api/public/alpha/guest/conversations',{'body':'สอบถามเวลาทำการค่ะ','name':name,'remember':True,
                                 'website':'','started_ms':int(time.time()*1000)-5000})
        self.assertEqual(status,201,data)
        page.guest_csrf,page.conversation = data['csrf'],data['id']
        return page

    # Handshake
    def test_handshake_for_staff_customer_and_guest(self):
        self.joined(self.admin)
        self.joined(self.customer(),CUSTOMER)
        self.joined(self.guest(),GUEST)
        # Plain HTTP to the same paths is not a socket.
        self.assertEqual(self.admin.call(STAFF)[0],404)
        with patch.object(S,'PING_SECONDS',0.2):
            ws = self.joined(self.admin)
            self.assertEqual(self.frame(ws),{'type':'ping'})
            ws.send(json.dumps({'type':'pong'}))
            self.assertEqual(self.frame(ws),{'type':'ping'})

    def test_origin_must_be_this_site(self):
        for origin in (None,'http://evil.example',f'http://localhost:{self.server.server_port}',self.base+'.evil.example'):
            with self.subTest(origin=origin):
                self.closed(self.socket(self.admin,origin=origin),4403)
        page = self.guest()
        self.closed(self.socket(page,GUEST,origin='https://evil.example'),4403)
        # Through the web app (same machine), the browser's host is the forwarded one and Origin must match it.
        forwarded = {'X-Forwarded-Host':'localhost:3000'}
        self.joined(self.admin,origin='http://localhost:3000',headers=forwarded)
        self.closed(self.socket(self.admin,headers=forwarded),4403)
        self.closed(self.socket(self.admin,origin='http://evil.example:3000',headers={'X-Forwarded-Host':'evil.example:3000'}),4403)

    def test_no_or_invalid_session_closes_4401(self):
        self.closed(self.socket(None,STAFF),4401)
        self.closed(self.socket(None,CUSTOMER),4401)
        self.closed(self.socket(None,GUEST),4401)
        self.closed(self.socket(None,STAFF,cookie='bookdose_session=forged'),4401)
        self.closed(self.socket(None,CUSTOMER,cookie='bookdose_account=forged'),4401)
        self.closed(self.socket(None,GUEST,cookie='g_alpha='+'A'*43),4401)
        # A staff cookie is not a customer's, and a guest cookie of this organization is not another's.
        self.closed(self.socket(self.admin,CUSTOMER),4401)
        page = self.guest()
        self.ok(self.owner,'/api/platform/tenants',{'name':'องค์กร B','slug':'beta','email':'orgadmin@example.com'})
        self.closed(self.socket(page,'/api/public/beta/guest/realtime'),4401)
        # No such organization, or guest chat switched off: 4403.
        self.closed(self.socket(page,'/api/public/nowhere/guest/realtime'),4403)
        self.ok(self.admin,'/api/settings/guest-chat',{'guest_chat':{'enabled':False}})
        self.closed(self.socket(page,GUEST),4403)

    def test_signed_out_or_removed_sessions_close(self):
        with patch.object(S,'RECHECK_SECONDS',0.2):
            agent,user_id = self.create_member()
            removed = self.joined(agent)
            staff = self.joined(self.admin)
            self.ok(self.admin,'/api/members/'+user_id,{'team_id':self.team,'role':'agent','active':False},'PATCH')
            self.closed(removed,4401)
            customer = self.customer()
            ws = self.joined(customer,CUSTOMER)
            self.ok(customer,'/api/customer/logout',{})
            self.closed(ws,4401)
            page = self.guest()
            ws = self.joined(page,GUEST)
            self.ok(page,'/api/public/alpha/guest/forget',{})
            self.closed(ws,4401)
            self.ok(self.admin,'/api/logout',{})
            self.closed(staff,4401)

    # Who hears what
    def test_customer_hears_public_reply_but_never_internal_note(self):
        customer = self.customer()
        first,second = self.chat(customer),self.chat(customer,'เรื่องที่สอง','ขอใบเสร็จ')
        staff = self.joined(self.admin)
        ws = self.joined(customer,CUSTOMER)
        self.say(first,'note','PRIVATE-INTERNAL-NOTE')
        # Staff hear about the note ...
        self.until(staff,self.changed('conversation',first))
        # ... the customer does not: the first event it gets is the reply in the other conversation.
        self.say(second)
        received = [self.frame(ws) for _ in range(3)]
        self.assertEqual(received,[{'type':'changed','scope':'conversation','id':second,'org':'alpha'},
                                   {'type':'changed','scope':'conversations','org':'alpha'},{'type':'changed','scope':'alerts'}])
        self.say(first,'reply','คำตอบสาธารณะ')
        self.until(ws,self.changed('conversation',first))
        # A new status is public; hints carry no text.
        self.ok(self.admin,f'/api/conversations/{first}',{'status':'closed'},'PATCH')
        frames = self.quiet(ws,1)
        self.assertIn({'type':'changed','scope':'conversation','id':first,'org':'alpha'},frames)
        self.assertNotIn('PRIVATE',json.dumps(frames,ensure_ascii=False))
        # A case: staff get the case and list, the customer the case (status) and alerts.
        ticket = self.ok(self.admin,f'/api/conversations/{first}/ticket',{})['id']
        self.until(staff,self.changed('tickets'))
        self.until(ws,self.changed('ticket',ticket))
        self.quiet(ws,0.5)
        self.ok(self.admin,f'/api/tickets/{ticket}',{'priority':'urgent'},'PATCH')
        self.until(staff,self.changed('ticket',ticket))
        self.assertEqual(self.quiet(ws,0.6),[],'a staff-only field (priority) is not the customer\'s business')
        self.ok(self.admin,f'/api/tickets/{ticket}',{'status':'pending_customer'},'PATCH')
        self.until(ws,self.changed('ticket',ticket))

    def test_other_customers_organizations_and_teams_hear_nothing(self):
        mine = self.customer()
        mine_chat = self.chat(mine)
        other = self.customer(email='other@example.com',name='ลูกค้าอีกคน')
        other_chat = self.chat(other)
        ws = self.joined(other,CUSTOMER)
        self.say(mine_chat)
        self.say(other_chat)
        self.assertEqual(self.frame(ws),{'type':'changed','scope':'conversation','id':other_chat,'org':'alpha'})
        # Another organization: its staff and customers never hear about alpha, and alpha's staff not about beta.
        self.ok(self.owner,'/api/platform/tenants',{'name':'องค์กร B','slug':'beta','email':'orgadmin@example.com'})
        staff = self.joined(self.admin)
        beta_customer = self.customer(slug='beta',email='beta@example.com')
        beta_chat = self.chat(beta_customer,slug='beta')
        alpha_chat = self.chat(mine,'อีกเรื่อง','ข้อความใหม่')
        received = self.until(staff,lambda f:f.get('scope')=='conversation')
        self.assertEqual(received,{'type':'changed','scope':'conversation','id':alpha_chat,'org':'alpha'})
        self.assertNotIn(beta_chat,json.dumps(self.quiet(staff,0.5)))
        # An agent of another team hears nothing about this team's conversations; an owner hears everything.
        other_team = self.ok(self.admin,'/api/teams',{'name':'ทีมเทคนิค'})['id']
        agent,_ = self.create_member(team=other_team)
        manager,_ = self.create_member(role='admin',email='owner2@example.com',team=other_team)
        agent_ws,manager_ws = self.joined(agent),self.joined(manager)
        self.say(alpha_chat)
        self.until(manager_ws,self.changed('conversation',alpha_chat))
        self.assertEqual(self.quiet(agent_ws,0.6),[])

    def test_guest_hears_only_its_own_conversations(self):
        first,second = self.guest('หนึ่ง'),self.guest('สอง')
        first_ws,second_ws = self.joined(first,GUEST),self.joined(second,GUEST)
        self.say(first.conversation)
        self.say(second.conversation)
        self.assertEqual(self.frame(second_ws),{'type':'changed','scope':'conversation','id':second.conversation,'org':'alpha'})
        self.assertEqual(self.frame(first_ws),{'type':'changed','scope':'conversation','id':first.conversation,'org':'alpha'})
        self.say(first.conversation,'note','ภายในเท่านั้น')
        self.say(second.conversation)
        self.assertEqual(self.until(second_ws,lambda f:f.get('scope')=='conversation')['id'],second.conversation)
        self.assertEqual([f for f in self.quiet(first_ws,0.6) if f.get('id')==first.conversation],[])

    # Typing
    def test_typing_only_where_the_sender_may_reply_and_throttled(self):
        customer = self.customer()
        own = self.chat(customer)
        stranger = self.customer(email='other@example.com')
        foreign = self.chat(stranger)
        staff = self.joined(self.admin)
        ws = self.joined(customer,CUSTOMER)
        with patch.object(S,'TYPING_EVERY_SECONDS',1.0):
            ws.send(json.dumps({'type':'typing','conversation_id':own}))
            self.assertEqual(self.frame(staff),{'type':'typing','conversation_id':own,'org':'alpha','who':'customer',
                                                'name':'ลูกค้าทดสอบ','ttl_ms':6000})
            ws.send(json.dumps({'type':'typing','conversation_id':own}))       # too soon
            ws.send(json.dumps({'type':'typing','conversation_id':foreign}))   # someone else's
            ws.send(json.dumps({'type':'typing','conversation_id':'../x'}))
            ws.send('not json')
            self.assertEqual(self.quiet(staff,0.8),[])
            time.sleep(0.3)
            ws.send(json.dumps({'type':'typing','conversation_id':own}))
            self.assertEqual(self.frame(staff)['conversation_id'],own)
            # Staff typing reaches the customer, named as on staff replies; not the other customer.
            other_ws = self.joined(stranger,CUSTOMER)
            staff.send(json.dumps({'type':'typing','conversation_id':own}))
            self.assertEqual(self.frame(ws),{'type':'typing','conversation_id':own,'org':'alpha','who':'staff',
                                             'name':'ผู้ดูแลองค์กร A','ttl_ms':6000})
            self.assertEqual(self.quiet(other_ws,0.5),[])
            # A guest's typing, and an agent who cannot see the conversation cannot type in it.
            page = self.guest('สมศรี')
            guest_ws = self.joined(page,GUEST)
            guest_ws.send(json.dumps({'type':'typing','conversation_id':page.conversation}))
            self.assertEqual(self.until(staff,lambda f:f['type']=='typing')['name'],'สมศรี')
            guest_ws.send(json.dumps({'type':'typing','conversation_id':own}))
            other_team = self.ok(self.admin,'/api/teams',{'name':'ทีมเทคนิค'})['id']
            agent,_ = self.create_member(team=other_team)
            self.joined(agent).send(json.dumps({'type':'typing','conversation_id':own}))
            self.assertEqual([f for f in self.quiet(staff,0.6)+self.quiet(ws,0.1) if f['type']=='typing'],[])

    # Who on the team has the conversation open ("มีคนกำลังตอบแชทนี้อยู่")
    def test_the_team_hears_who_has_the_conversation_open(self):
        customer = self.customer()
        conv = self.chat(customer)
        colleague,colleague_id = self.create_member(email='colleague@example.com')
        owner_ws,colleague_ws = self.joined(self.admin),self.joined(colleague)
        page_ws = self.joined(customer,CUSTOMER)
        with patch.object(S,'TYPING_EVERY_SECONDS',1.0):
            colleague_ws.send(json.dumps({'type':'viewing','conversation_id':conv}))
            here = self.until(owner_ws,lambda f:f['type']=='here')
            self.assertEqual(here,{'type':'here','conversation_id':conv,'org':'alpha','user_id':colleague_id,
                                   'name':'เจ้าหน้าที่ทดสอบ','typing':False,'ttl_ms':25000,'typing_ms':6000})
            # The customer is never told who on the team is looking at their chat.
            self.assertEqual(self.quiet(page_ws,0.6),[])
            # Writing says so at once, and is the same signal with typing set.
            time.sleep(0.3)
            colleague_ws.send(json.dumps({'type':'typing','conversation_id':conv}))
            self.assertTrue(self.until(owner_ws,lambda f:f['type']=='here')['typing'])

    def test_viewing_follows_the_same_rules_as_replying(self):
        customer = self.customer()
        conv = self.chat(customer)
        stranger = self.customer(email='other@example.com')
        foreign = self.chat(stranger)
        owner_ws = self.joined(self.admin)
        with patch.object(S,'TYPING_EVERY_SECONDS',1.0):
            # An agent of another team cannot see the conversation, so cannot say they are in it.
            other_team = self.ok(self.admin,'/api/teams',{'name':'ทีมเทคนิค'})['id']
            agent,_ = self.create_member(team=other_team,email='agent2@example.com')
            self.joined(agent).send(json.dumps({'type':'viewing','conversation_id':conv}))
            # A customer's page has no such signal to send at all; neither has a guest's.
            page_ws = self.joined(customer,CUSTOMER)
            page_ws.send(json.dumps({'type':'viewing','conversation_id':conv}))
            guest_page = self.guest('สมศรี')
            self.joined(guest_page,GUEST).send(json.dumps({'type':'viewing','conversation_id':guest_page.conversation}))
            self.assertEqual([f for f in self.quiet(owner_ws,1) if f['type']=='here'],[])
            # The owner may see every team, so another customer's chat is theirs to be in; then a second beat too
            # soon, a mangled id and a frame with no id at all are all refused.
            owner_ws.send(json.dumps({'type':'viewing','conversation_id':foreign}))
            self.assertEqual(self.until(owner_ws,lambda f:f['type']=='here')['conversation_id'],foreign)
            owner_ws.send(json.dumps({'type':'viewing','conversation_id':foreign}))
            owner_ws.send(json.dumps({'type':'viewing','conversation_id':'../x'}))
            owner_ws.send(json.dumps({'type':'viewing'}))
            self.assertEqual([f for f in self.quiet(owner_ws,0.8) if f['type']=='here'],[])
            # Refusing a frame is not a reason to drop the connection: the next good one still works.
            owner_ws.send(json.dumps({'type':'viewing','conversation_id':conv}))
            self.assertEqual(self.until(owner_ws,lambda f:f['type']=='here')['conversation_id'],conv)

    # Read receipts
    def test_read_receipts_both_ways(self):
        customer = self.customer()
        conv = self.chat(customer)
        customer.conversation = conv
        with D.tenant(self.org) as db:
            db.execute("UPDATE messages SET created_at='2000-01-01T00:00:00+00:00' WHERE conversation_id=?",(conv,))
        staff = self.joined(self.admin)
        ws = self.joined(customer,CUSTOMER)
        # Staff open the conversation after the customer wrote: the customer's page hears it once.
        detail = self.ok(self.admin,f'/api/conversations/{conv}')
        self.assertIsNotNone(detail['customer_read_at'])
        read = self.frame(ws)
        self.assertEqual({k:v for k,v in read.items() if k!='at'},{'type':'read','conversation_id':conv,'org':'alpha','by':'staff'})
        self.assertRegex(read['at'],r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00$')
        self.ok(self.admin,f'/api/conversations/{conv}')
        self.assertEqual([f for f in self.quiet(ws,0.5) if f['type']=='read'],[])
        self.assertEqual(self.ok(customer,'/api/public/alpha/session')['staff_read_at'],read['at'])
        # The customer opens it after a team reply: staff hear it once.
        self.say(conv)
        with D.tenant(self.org) as db:
            db.execute("UPDATE messages SET created_at='2000-01-02T00:00:00+00:00' WHERE conversation_id=? AND kind='reply'",(conv,))
            db.execute("UPDATE customer_seen SET seen_at='1999-01-01T00:00:00+00:00'")
        self.quiet(staff,0.3)
        self.ok(customer,'/api/public/alpha/session')
        read = self.until(staff,lambda f:f['type']=='read')
        self.assertEqual({k:v for k,v in read.items() if k!='at'},{'type':'read','conversation_id':conv,'org':'alpha','by':'customer'})
        self.ok(customer,'/api/public/alpha/session')
        self.assertEqual([f for f in self.quiet(staff,0.5) if f['type']=='read'],[])
        # A guest too.
        page = self.guest()
        self.say(page.conversation)
        with D.tenant(self.org) as db:
            db.execute("UPDATE guest_seen SET seen_at='1999-01-01T00:00:00+00:00'")
        guest_ws = self.joined(page,GUEST)
        self.ok(page,'/api/public/alpha/guest/session')
        read = self.until(staff,lambda f:f['type']=='read')
        self.assertEqual((read['conversation_id'],read['by']),(page.conversation,'customer'))
        with D.tenant(self.org) as db:
            db.execute("UPDATE messages SET created_at='2000-01-01T00:00:00+00:00' WHERE conversation_id=? AND kind='customer'",(page.conversation,))
            db.execute('DELETE FROM conversation_staff_reads')
        self.ok(self.admin,f'/api/conversations/{page.conversation}')
        read = self.until(guest_ws,lambda f:f['type']=='read')
        self.assertEqual((read['conversation_id'],read['by']),(page.conversation,'staff'))

    # Transactions and workers
    def test_events_only_after_the_transaction_commits(self):
        from backend.modules.conversations.service import store_message
        customer = self.customer()
        rolled_back,committed = self.chat(customer),self.chat(customer,'สอง','ข้อความสอง')
        staff = self.joined(self.admin)
        with self.assertRaises(RuntimeError):
            with D.tenant(self.org) as db:
                D.begin(db)
                store_message(db,self.org,rolled_back,None,'ลูกค้า','customer',{'body':'ไม่ถูกบันทึก'})
                raise RuntimeError('rolled back')
        with D.tenant(self.org) as db:
            D.begin(db)
            store_message(db,self.org,committed,None,'ลูกค้า','customer',{'body':'บันทึกแล้ว'})
            self.assertEqual(self.quiet(staff,0.5),[],'nothing before the commit')
        self.assertEqual(self.frame(staff),{'type':'changed','scope':'conversation','id':committed,'org':'alpha'})
        self.assertNotIn(rolled_back,json.dumps(self.quiet(staff,0.5)))

    def test_line_message_stored_by_a_worker_thread_reaches_staff(self):
        staff = self.joined(self.admin)
        cfg = self.configure()
        self.assertEqual(self.webhook(cfg['route_id'])[0],200)
        results = []
        worker = threading.Thread(target=lambda:results.append(channel_tests.C.process_line(self.org,app.store_message)),name='bookdose-channels')
        worker.start()
        worker.join(20)
        self.assertEqual(results,[True])
        with D.tenant(self.org) as db:
            conv = D.one(db,"SELECT id FROM conversations WHERE channel='line'")['id']
        self.until(staff,self.changed('conversation',conv))
        self.until(staff,self.changed('conversations'))

    # Limits
    def test_frame_size_frame_rate_socket_count_and_idle_limits(self):
        ws = self.joined(self.admin)
        ws.send(json.dumps({'type':'pong','padding':'x'*3000}))
        self.closed(ws,4429)
        ws = self.joined(self.admin)
        for _ in range(21):
            ws.send(json.dumps({'type':'pong'}))
        self.closed(ws,4429)
        open_sockets = [self.joined(self.admin) for _ in range(5)]
        self.closed(self.socket(self.admin),4429)
        # Another session of the same person has its own allowance.
        second = Client(self.base)
        second.login('orgadmin@example.com')
        self.joined(second)
        for ws in open_sockets:
            ws.close()
        time.sleep(0.3)
        self.joined(self.admin)
        with patch.object(S,'IDLE_SECONDS',0.5):
            self.closed(self.joined(self.admin),4408)


if __name__=='__main__':
    unittest.main()
