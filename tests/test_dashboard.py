"""The customer's project dashboard: the health rule on its own (on track, delayed, ahead, done, not started and the
planned share), the budget across two projects with VAT invoices (paid, unpaid, overdue; void ones ignored), what a
finance member and a technical member each see, and service levels from the customer's own cases.
Email is mocked; nothing leaves the machine."""
import datetime as dt
import unittest

import test_app as base
import test_contracts as contract_tests
from test_app import D, rate_limit

from backend.modules.contracts import health
from backend.utils.dates import today

ORG = '/api/public/alpha'
TODAY = '2026-09-15'
BILLING = {'pay_bank':'กสิกรไทย','pay_account_name':'องค์กร A จำกัด','pay_account_number':'123-4-56789-0','pay_promptpay':'081-234-5678',
           'vat_registered':True,'tax_id':'0105551234567','tax_branch':'สำนักงานใหญ่','org_address':'1 ถนนสุขุมวิท กรุงเทพฯ','invoice_due_days':15}


def milestone(title, due='', amount='', status='pending', progress=0, done_at=None, kind='delivery'):
    return {'kind':kind,'title':title,'due_date':due,'amount':amount,'status':status,'progress':progress,'done_at':done_at}


def days(n):
    """n days from the server's today (UTC, as the dashboard counts)."""
    return (dt.date.fromisoformat(today())+dt.timedelta(days=n)).isoformat()


class HealthRuleTests(unittest.TestCase):
    def test_not_started_on_track_and_delayed(self):
        plan = [milestone('ออกแบบ','2026-10-01','100000'),milestone('พัฒนา','2026-12-01','300000')]
        self.assertEqual(health.state(plan,TODAY),'not_started')
        plan[0].update(status='in_progress',progress=40)
        self.assertEqual(health.state(plan,TODAY),'on_track')
        found = health.assess(plan,'2026-10-03')
        self.assertEqual((found['state'],found['late'],found['next']),
                         ('delayed',[{'title':'ออกแบบ','due_date':'2026-10-01','days_late':2}],{'title':'ออกแบบ','due_date':'2026-10-01'}))
        # A delivery handed in but not yet accepted is still not done.
        plan[0].update(status='submitted',progress=100)
        self.assertEqual(health.state(plan,'2026-10-03'),'delayed')
        self.assertIsNone(health.assess(plan,TODAY)['finished_at'])

    def test_done_and_ahead(self):
        plan = [milestone('ออกแบบ','2026-10-01',status='done',done_at='2026-09-20T08:00:00+00:00'),
                milestone('พัฒนา','2026-12-01',status='done',done_at='2026-12-01T03:00:00+00:00'),
                milestone('มัดจำ','2027-01-31','50000',kind='payment')]
        # Accepted on the latest due date: done; payments are not part of the plan of work.
        found = health.assess(plan,'2026-12-05')
        self.assertEqual((found['state'],found['finished_at'],found['final_due'],found['next']),
                         ('done','2026-12-01T03:00:00+00:00','2026-12-01',None))
        plan[1]['done_at'] = '2026-11-30T09:00:00+00:00'
        self.assertEqual(health.state(plan,'2026-12-05'),'ahead')
        plan[1]['done_at'] = '2026-12-02T09:00:00+00:00'
        self.assertEqual(health.state(plan,'2026-12-05'),'done')
        # Without due dates there is nothing to be ahead of.
        self.assertEqual(health.state([milestone('ติดตั้ง',status='done',done_at='2026-09-01T00:00:00+00:00')],TODAY),'done')
        self.assertEqual(health.state([milestone('ค่าบริการ','2026-01-01','24000',kind='payment')],TODAY),'done')

    def test_planned_share_uses_the_progress_weights(self):
        plan = [milestone('ออกแบบ','2026-09-15','100000'),milestone('พัฒนา','2026-12-01','300000'),milestone('มัดจำ','2026-01-01','9',kind='payment')]
        self.assertEqual(health.planned(plan,'2026-09-14'),0)
        self.assertEqual(health.planned(plan,TODAY),25)                 # due today counts: 100,000 of 400,000
        self.assertEqual(health.planned(plan,'2026-12-01'),100)
        plan[1]['amount'] = ''                                           # not every delivery has an amount: equal weights
        self.assertEqual(health.planned(plan,TODAY),50)
        plan.append(milestone('อบรม'))                                   # no due date: never planned
        self.assertEqual(health.planned(plan,'2027-01-01'),66)
        self.assertEqual(health.planned([],TODAY),0)


class DashboardTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    visitor = base.IntegrationTests.visitor
    customer = base.IntegrationTests.customer
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD
    draft = contract_tests.ContractTests.draft
    signed = contract_tests.ContractTests.signed
    no_email = contract_tests.ContractTests.no_email
    project = contract_tests.ContractTests.project

    def ok(self, client, path, body=None, method=None):
        rate_limit.RATES.clear()
        return base.IntegrationTests.ok(self,client,path,body,method)

    def dashboard(self, client):
        return self.ok(client,'/api/customer/dashboard')

    def test_budget_across_two_projects_with_vat_invoices(self):
        owner = self.customer(email='owner@example.com',name='เจ้าของงาน')
        self.assertEqual(self.dashboard(owner),{'budget':{'contract_total':'0.00','billed':'0.00','paid':'0.00','outstanding':'0.00',
                                                           'overdue':'0.00','remaining':'0.00','projects':[],'upcoming':[],'monthly':[]},
                                                'health':{'summary':{'on_track':0,'delayed':0,'ahead':0,'done':0,'not_started':0},'projects':[]},
                                                'sla':{'orgs':[]}})
        self.ok(self.admin,'/api/contract-billing',BILLING)
        _,first = self.signed([{'kind':'delivery','title':'ออกแบบระบบ','due_date':days(30),'amount':'100000'},
                               {'kind':'payment','title':'งวดสุดท้าย','due_date':'','amount':'20000'}],customer_email='owner@example.com')
        _,second = self.signed([{'kind':'payment','title':'มัดจำ','due_date':'','amount':'50000'},
                                {'kind':'payment','title':'งวดที่ 2','due_date':'','amount':'10000'}],customer_email='owner@example.com')
        design,final = self.project(owner,first)['milestones']
        # First project: the design is accepted (107,000 with VAT) and paid; the last payment (21,400) is overdue.
        self.ok(self.admin,f'/api/contracts/{first}/milestones/{design["id"]}/deliver',{'note':'แบบหน้าจอ'})
        paid = self.ok(owner,f'{ORG}/contracts/{first}/milestones/{design["id"]}/accept',{})['invoice_id']
        self.ok(self.admin,f'/api/contracts/{first}/invoices/{paid}/confirm',{})
        late = self.ok(self.admin,f'/api/contracts/{first}/milestones/{final["id"]}/invoice',{})['id']
        with D.tenant(self.org) as db:
            db.execute('UPDATE contract_invoices SET due_date=? WHERE id=?',(days(-1),late))
            db.commit()
        # Second project: an invoice made by mistake is void and issued again; the other payment is not billed yet.
        deposit,_ = self.project(owner,second)['milestones']
        void = self.ok(self.admin,f'/api/contracts/{second}/milestones/{deposit["id"]}/invoice',{})['id']
        self.ok(self.admin,f'/api/contracts/{second}/invoices/{void}/void',{'reason':'ออกผิดงวด'})
        waiting = self.ok(self.admin,f'/api/contracts/{second}/milestones/{deposit["id"]}/invoice',{})['id']
        budget = self.dashboard(owner)['budget']
        self.assertEqual({k:budget[k] for k in ('contract_total','billed','paid','outstanding','overdue','remaining')},
                         {'contract_total':'192600.00','billed':'181900.00','paid':'107000.00','outstanding':'74900.00',
                          'overdue':'21400.00','remaining':'85600.00'})
        rows = {p['contract_id']:p for p in budget['projects']}
        self.assertEqual({k:rows[first][k] for k in ('total','billed','paid','outstanding','overdue','org_slug')},
                         {'total':'128400.00','billed':'128400.00','paid':'107000.00','outstanding':'21400.00','overdue':'21400.00','org_slug':'alpha'})
        self.assertEqual((rows[first]['next_due']['invoice_id'],rows[first]['next_due']['total']),(late,'21400.00'))
        self.assertEqual({k:rows[second][k] for k in ('total','billed','paid','outstanding','overdue')},
                         {'total':'64200.00','billed':'53500.00','paid':'0.00','outstanding':'53500.00','overdue':'0.00'})
        self.assertEqual([(u['invoice_id'],u['total'],u['days_left'],u['status'],u['milestone_title']) for u in budget['upcoming']],
                         [(late,'21400.00',-1,'unpaid','งวดสุดท้าย'),(waiting,'53500.00',15,'unpaid','มัดจำ')])
        self.assertEqual(len(budget['monthly']),12)
        self.assertEqual(budget['monthly'][-1],{'month':today()[:7],'paid':'107000.00'})
        self.assertEqual({m['paid'] for m in budget['monthly'][:-1]},{'0.00'})
        # Health: the only delivery was accepted before its due date; the payment-only contract has no plan of work.
        found = self.dashboard(owner)['health']
        self.assertEqual([(h['contract_id'],h['state'],h['progress'],h['planned']) for h in found['projects']],[(first,'ahead',100,0)])
        self.assertEqual(found['summary']['ahead'],1)

    def test_finance_sees_the_budget_and_technical_the_health(self):
        owner = self.customer(email='owner@example.com',name='เจ้าของงาน')
        finance = self.customer(email='finance@example.com',name='การเงิน ใจดี')
        technical = self.customer(email='technical@example.com',name='ไอที เก่งมาก')
        owner,contract = self.signed([{'kind':'delivery','title':'ติดตั้งระบบ','due_date':days(-1),'amount':'100000'},
                                      {'kind':'payment','title':'มัดจำ','due_date':'','amount':'30000'}],customer_email='owner@example.com')
        for client,role in ((finance,'finance'),(technical,'technical')):
            row = self.ok(owner,f'{ORG}/team',{'email':f'{role}@example.com','role':role,'all_projects':True})['id']
            self.ok(client,f'{ORG}/team/{row}/accept',{})
        deposit = self.project(owner,contract)['milestones'][1]
        self.ok(self.admin,f'/api/contracts/{contract}/milestones/{deposit["id"]}/invoice',{})
        money = self.dashboard(finance)
        self.assertEqual(([p['contract_id'] for p in money['budget']['projects']],money['budget']['outstanding']),([contract],'30000.00'))
        self.assertEqual(len(money['budget']['upcoming']),1)
        self.assertEqual((money['health']['projects'],money['health']['summary']['delayed']),([],0))
        work = self.dashboard(technical)
        self.assertEqual((work['budget']['projects'],work['budget']['upcoming'],work['budget']['contract_total']),([],[],'0.00'))
        late = work['health']['projects'][0]
        self.assertEqual((late['contract_id'],late['state'],late['planned'],late['late'][0]['days_late'],late['next']['title']),
                         (contract,'delayed',100,1,'ติดตั้งระบบ'))
        self.assertEqual(work['health']['summary']['delayed'],1)
        everything = self.dashboard(owner)
        self.assertEqual((len(everything['budget']['projects']),len(everything['health']['projects'])),(1,1))

    def test_service_levels_from_the_customers_own_cases(self):
        client,first = self.visitor(subject='เปิดหนังสือไม่ได้')
        second = self.ok(client,f'{ORG}/conversations',{'subject':'ขอใบเสร็จ','body':'ต้องการใบเสร็จย้อนหลัง'})['id']
        stranger = self.customer(email='stranger@example.com')
        cases = [self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id'] for conv in (first,second)]
        at = lambda hour:f'2026-01-05T{hour:02d}:00:00+00:00'
        with D.tenant(self.org) as db:
            # Answered in 30 minutes (on time), resolved after 4 hours (2 hours late).
            db.execute('''UPDATE tickets SET status='resolved',created_at=?,first_response_due_at=?,first_response_at=?,
                          resolution_due_at=?,resolved_at=? WHERE id=?''',(at(10),at(11),'2026-01-05T10:30:00+00:00',at(12),at(14),cases[0]))
            # Answered after 2 hours (late), still open and within its resolution time.
            db.execute('''UPDATE tickets SET status='open',created_at=?,first_response_due_at=?,first_response_at=?,
                          resolution_due_at=?,resolved_at=NULL WHERE id=?''',(at(10),at(11),at(12),'2999-01-01T00:00:00+00:00',cases[1]))
            for n,(case,conv,rating) in enumerate(((cases[0],first,4),(cases[1],second,5),(cases[1],second,None))):
                db.execute('INSERT INTO csat_surveys(id,ticket_id,conversation_id,rating,sent_at,answered_at) VALUES(?,?,?,?,?,?)',
                           (f'{n}'*32,case,conv,rating,at(15),at(16) if rating else None))
            db.commit()
        self.assertEqual(self.dashboard(client)['sla']['orgs'],
                         [{'org_slug':'alpha','org_name':'องค์กร A','cases':2,'open':1,'first_response_avg_minutes':75,
                           'first_response_on_time_pct':50,'resolution_avg_hours':4.0,'resolution_on_time_pct':0,'csat_avg':4.5}])
        self.assertEqual(self.dashboard(stranger)['sla']['orgs'],[])


if __name__=='__main__':
    unittest.main()
