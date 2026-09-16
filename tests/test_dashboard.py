"""The customer's service dashboard: service levels from the customer's own cases per organization (first response
and resolution against the SLA times, satisfaction), and nothing for an account without cases.
Email is mocked; nothing leaves the machine."""
import unittest

import test_app as base
from test_app import D, rate_limit

ORG = '/api/public/alpha'


class DashboardTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    visitor = base.IntegrationTests.visitor
    customer = base.IntegrationTests.customer
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD

    def ok(self, client, path, body=None, method=None):
        rate_limit.RATES.clear()
        return base.IntegrationTests.ok(self,client,path,body,method)

    def dashboard(self, client):
        return self.ok(client,'/api/customer/dashboard')

    def test_service_levels_from_the_customers_own_cases(self):
        client,first = self.visitor(subject='เปิดหนังสือไม่ได้')
        second = self.ok(client,f'{ORG}/conversations',{'subject':'ขอคู่มือ','body':'ต้องการคู่มือการใช้งาน'})['id']
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
        self.assertEqual(self.dashboard(stranger),{'sla':{'orgs':[]}})


if __name__=='__main__':
    unittest.main()
