"""รายงานปัญหา from a signed-in customer: the ? in the customer's top bar sends the website's problem to the platform,
where the console tells it from a team member's report. It belongs to no organization."""
import unittest

import test_app as base


class CustomerProblemReportTests(unittest.TestCase):
    def test_a_customer_reports_and_the_console_reads_it(self):
        customer = self.customer()
        body = {'message':'กดส่งข้อความแล้วหน้าค้าง','page':'/customer/chats'}
        self.assertIsNotNone(self.ok(customer,'/api/customer/problem-report',body)['id'])
        reports = self.ok(self.owner,'/api/platform/reports')['reports']
        mine = next(r for r in reports if r['message']=='กดส่งข้อความแล้วหน้าค้าง')
        self.assertEqual((mine['reporter'],mine['tenant_id'],mine['user_email']),('customer',None,'visitor@example.com'))
        self.assertEqual(mine['page'],'/customer/chats')
        # A team member's report is still a team member's.
        self.ok(self.admin,'/api/problem-reports',{'message':'ปุ่มมอบหมายไม่ทำงาน','page':'/tickets'})
        staff = next(r for r in self.ok(self.owner,'/api/platform/reports')['reports'] if r['message']=='ปุ่มมอบหมายไม่ทำงาน')
        self.assertEqual(staff['reporter'],'staff')
        # Signed out, nothing is taken.
        self.assertEqual(base.Client(self.base).call('/api/customer/problem-report',body)[0],401)
        self.assertEqual(customer.call('/api/customer/problem-report',{'message':'','page':'/'})[0],400)


# The setUp, the sign-ins and the helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(CustomerProblemReportTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
