"""The organizations on the customer's account page (org_links): the platform's own first, and one added by its code.
Email is mocked; nothing leaves the machine."""
import unittest

import test_app as base
from test_app import Client, rate_limit

ROLES = '/api/customer/org-roles'


class OrgLinkTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    visitor = base.IntegrationTests.visitor
    customer = base.IntegrationTests.customer
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    create_member = base.IntegrationTests.create_member
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD

    # The support page counts requests per address; these tests make many from one.
    def ok(self, client, path, body=None, method=None):
        rate_limit.RATES.clear()
        return base.IntegrationTests.ok(self,client,path,body,method)

    def status(self, client, path, body=None, method=None):
        rate_limit.RATES.clear()
        return client.call(path,body,method)[0]

    def beta(self):
        """A second organization with its own admin, signed in (customers are connected with alpha, the platform's
        own, but reach beta only by its code or a link)."""
        tenant = self.ok(self.owner,'/api/platform/tenants',{'name':'องค์กร B','slug':'beta','email':'owner@example.com',
                                                             'admin_name':'ผู้ดูแล B','password':'Test-password-123!'})['id']
        client = Client(self.base)
        client.login('owner@example.com')
        return client,tenant

    def test_the_account_page_shows_every_organization(self):
        customer = self.customer(email='visitor@example.com')
        self.assertEqual(self.ok(customer,ROLES),{'organizations':[{'slug':'alpha','name':'องค์กร A','home':True,'member':True}]})
        beta,_ = self.beta()
        self.ok(customer,'/api/customer/organizations',{'slug':'beta'})
        self.assertEqual([(o['slug'],o['home'],o['member']) for o in self.ok(customer,ROLES)['organizations']],
                         [('alpha',True,True),('beta',False,True)])
        self.assertEqual(Client(self.base).call(ROLES)[0],401)


if __name__ == '__main__':
    unittest.main()
