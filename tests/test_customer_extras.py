"""What customers - signed in or not - got on the organization's pages: บทความนี้ช่วยได้ไหม (knowledge/feedback.py), the
start form's fields per category (tickets/fields.py) and ขอให้ติดต่อกลับ (portal/callback.py). Disposable databases."""
import datetime as dt
import unittest

import test_guest_chat as guest_tests
from test_guest_chat import GUEST, ORG
from backend.database import db as D

FIELDS = '/api/settings/fields'
VOTER = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'


class CustomerExtrasTests(guest_tests.GuestChatTests):
    # Only the helpers of the guest chat tests, not their tests.
    def article(self, visibility='public'):
        return self.ok(self.admin,'/api/articles',{'title':'วิธีรีเซ็ตรหัสผ่าน','category':'บัญชี','body':'กดลืมรหัสผ่านที่หน้าเข้าสู่ระบบ',
                                                    'visibility':visibility})['id']

    def report(self):
        day = dt.date.today()
        return self.ok(self.admin,f'/api/reports/extras?from={day-dt.timedelta(days=1)}&to={day+dt.timedelta(days=1)}&tz=0')['articles']

    # บทความนี้ช่วยได้ไหม
    def test_anyone_says_whether_an_article_helped_once_per_browser(self):
        public,internal = self.article(),self.article('internal')
        reader = self.browser()
        path = f'{ORG}/articles/{public}/feedback'
        self.ok(reader,path,{'helpful':False,'voter':VOTER})
        self.ok(reader,path,{'helpful':False,'voter':'f'*32})
        # The same browser changing its mind replaces its say.
        self.ok(reader,path,{'helpful':True,'voter':VOTER})
        self.assertEqual(self.status(reader,f'{ORG}/articles/{internal}/feedback',{'helpful':True,'voter':VOTER}),404)
        for bad in ({'helpful':'yes','voter':VOTER},{'helpful':True,'voter':'short'},{'helpful':True}):
            self.assertEqual(self.status(reader,path,bad),400,bad)
        customers = self.report()['customers']
        self.assertEqual((customers['helpful'],customers['unhelpful']),(1,1))
        self.assertEqual([(a['title'],a['helpful'],a['unhelpful']) for a in customers['unhelpful_articles']],[('วิธีรีเซ็ตรหัสผ่าน',1,1)])
        with D.tenant(self.org) as db:
            self.assertFalse(db.execute('SELECT 1 FROM knowledge_feedback WHERE voter=?',(VOTER,)).fetchone())

    # แบบฟอร์มตามหมวดเรื่อง
    def form_setup(self):
        saved = self.ok(self.admin,FIELDS,{'fields':[
            {'name':'เลขสมาชิก','kind':'text','customer':True},
            {'name':'รุ่นเครื่อง','kind':'select','options':['A1','B2'],'customer':True,'categories':['แจ้งปัญหาการใช้งาน']},
            {'name':'ผลตรวจภายใน','kind':'text'}]})['fields']
        return {f['name']:f['id'] for f in saved}

    def test_the_start_form_asks_the_fields_of_the_category_and_the_case_takes_them(self):
        ids = self.form_setup()
        form = self.overview(self.browser())['form_fields']
        self.assertEqual([(f['name'],f['categories']) for f in form],[('เลขสมาชิก',[]),('รุ่นเครื่อง',['แจ้งปัญหาการใช้งาน'])])
        visitor = self.browser()
        # A field of another category, or a value its field does not take, is refused.
        status,_,_ = self.start(visitor,category='สอบถามบริการ',fields={ids['รุ่นเครื่อง']:'A1'})
        self.assertEqual(status,400)
        status,_,_ = self.start(visitor,category='แจ้งปัญหาการใช้งาน',fields={ids['รุ่นเครื่อง']:'Z9'})
        self.assertEqual(status,400)
        conv = self.started(visitor,category='แจ้งปัญหาการใช้งาน',fields={ids['เลขสมาชิก']:'M-001',ids['รุ่นเครื่อง']:'B2'})
        detail = self.ok(self.admin,f'/api/conversations/{conv}')
        conv_view = detail.get('conversation',detail)
        self.assertEqual([(v['name'],v['value']) for v in conv_view['form_values']],[('เลขสมาชิก','M-001'),('รุ่นเครื่อง','B2')])
        ticket = self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']
        self.assertEqual(self.ok(self.admin,f'/api/tickets/{ticket}')['ticket']['fields'],{ids['เลขสมาชิก']:'M-001',ids['รุ่นเครื่อง']:'B2'})
        # Signed in, the same form: the organization's fields come with it.
        customer = self.customer('alpha','member@example.com')
        org = next(o for o in self.ok(customer,'/api/customer/organizations')['organizations'] if o['slug']=='alpha')
        self.assertEqual([f['name'] for f in org['form_fields']],['เลขสมาชิก','รุ่นเครื่อง'])

    # ขอให้ติดต่อกลับ
    def test_a_callback_becomes_a_case_with_a_reminder_at_the_time_picked(self):
        visitor = self.browser()
        conv = self.started(visitor)
        session = self.ok(visitor,GUEST+'/session')
        offer = session['callback']
        self.assertIsNone(offer['waiting'])
        self.assertFalse(offer['line_ready'])
        self.assertTrue(offer['slots'])
        slot = offer['slots'][0]
        path = GUEST+'/callback'
        self.assertEqual(self.status(visitor,path,{'method':'phone','phone':'12','start':slot['start']}),400)
        self.assertEqual(self.status(visitor,path,{'method':'line','start':slot['start']}),400)
        self.assertEqual(self.status(visitor,path,{'method':'phone','phone':'081-234-5678','start':'2000-01-01T00:00:00+00:00'}),400)
        waiting = self.ok(visitor,path,{'method':'phone','phone':'081-234-5678','start':slot['start'],'note':'สะดวกหลังเที่ยง'})['waiting']
        self.assertEqual((waiting['phone'],waiting['start']),('0812345678',slot['start']))
        ticket = self.ok(visitor,GUEST+'/session')['ticket']
        self.assertIsNotNone(ticket)
        with D.tenant(self.org) as db:
            reminder = db.execute('SELECT due_at,note,done_at FROM followups WHERE ticket_id=?',(ticket['id'],)).fetchone()
        self.assertEqual(reminder[0],slot['start'])
        self.assertIn('0812345678',reminder[1])
        self.assertIsNone(reminder[2])
        self.assertIn('ขอให้ติดต่อกลับ',self.ok(visitor,GUEST+'/session')['messages'][-1]['body'])
        # Called off: the reminder is done and nothing waits.
        self.assertIsNone(self.ok(visitor,path,{'cancel':True})['waiting'])
        with D.tenant(self.org) as db:
            self.assertIsNotNone(db.execute('SELECT done_at FROM followups WHERE ticket_id=?',(ticket['id'],)).fetchone()[0])
        self.assertIsNone(self.ok(visitor,GUEST+'/session')['callback']['waiting'])
        self.assertEqual(conv,visitor.conversation)

    def test_a_signed_in_customer_asks_for_a_callback_too(self):
        client,conv = base_visitor(self)
        slot = self.ok(client,f'{ORG}/session')['callback']['slots'][0]
        self.ok(client,f'{ORG}/callback',{'method':'phone','phone':'0812345678','start':slot['start']})
        self.assertIsNotNone(self.ok(client,f'{ORG}/session')['callback']['waiting'])
        # The team marks the reminder done: the request no longer waits.
        ticket = self.ok(client,f'{ORG}/session')['ticket']['id']
        followup = self.ok(self.admin,f'/api/tickets/{ticket}')['automation']['followups'][0]['id']
        self.ok(self.admin,f'/api/followups/{followup}/done',{})
        self.assertIsNone(self.ok(client,f'{ORG}/session')['callback']['waiting'])


def base_visitor(test):
    import test_app as base
    return base.IntegrationTests.visitor(test)


# Only these tests here: the guest chat's own run in their file.
for _name in [n for n in vars(guest_tests.GuestChatTests) if n.startswith('test_')]:
    setattr(CustomerExtrasTests, _name, None)


if __name__ == '__main__':
    unittest.main()
