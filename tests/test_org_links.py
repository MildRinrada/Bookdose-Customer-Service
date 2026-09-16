"""Organization join links and QR codes (org_links): the organization's permanent link with its QR, the invite links
its admin makes (label, lifetime, number of users) and revokes, what a customer sees before signing in, joining by a
link (one use per account; expired, revoked and used-up links open for nobody new), and the organizations on the
customer's account page.
Email is mocked; nothing leaves the machine."""
import base64
import unittest

import test_app as base
from test_app import Client, D, rate_limit
from backend.utils.dates import after

ORG = '/api/public/alpha'
LINKS = '/api/org-links'
ROLES = '/api/customer/org-roles'
QR = 'data:image/svg+xml;base64,'


def join_path(url):
    return '/api/customer/join-links/'+url.rsplit('/',1)[1]


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
        tenant = self.ok(self.admin,'/api/platform/tenants',{'name':'องค์กร B','slug':'beta','email':'owner@example.com',
                                                             'admin_name':'ผู้ดูแล B','password':'Test-password-123!'})['id']
        client = Client(self.base)
        client.login('owner@example.com')
        return client,tenant

    def svg(self, data_url):
        self.assertTrue(data_url.startswith(QR),data_url[:40])
        return base64.b64decode(data_url[len(QR):]).decode()

    def test_the_organizations_own_link_and_qr(self):
        view = self.ok(self.admin,LINKS)
        # No public address set yet: the link is the one this browser used.
        self.assertEqual((view['org_slug'],view['links']),('alpha',[]))
        self.assertEqual(view['org_url'],f'{self.base}/?org=alpha')
        self.assertIn('<svg',self.svg(view['org_qr']))
        # Only the organization's admin sees and makes links.
        agent,_ = self.create_member()
        manager,_ = self.create_member(role='manager',email='manager@example.com')
        self.assertEqual(agent.call(LINKS)[0],403)
        self.assertEqual(manager.call(LINKS,{'label':'ทดสอบ'})[0],403)
        self.assertIn(Client(self.base).call(LINKS)[0],(401,403))
        # With the platform's public address set, every link uses it (a QR is scanned on another device).
        self.enable_registration_mail()
        self.assertEqual(self.ok(self.admin,LINKS)['org_url'],'https://bookdose.example.com/?org=alpha')

    def test_invite_links_are_made_listed_and_revoked(self):
        self.enable_registration_mail()
        for bad in ({'days':400},{'days':-1},{'max_uses':1001},{'days':'7'},{'max_uses':True},{'label':'ก'*61}):
            self.assertEqual(self.status(self.admin,LINKS,bad),400,bad)
        made = self.ok(self.admin,LINKS,{'label':'งานอบรมลูกค้า','days':7,'max_uses':50})
        self.assertTrue(made['url'].startswith('https://bookdose.example.com/join/'))
        self.assertEqual((made['label'],made['max_uses'],made['uses'],made['revoked_at'],made['gone']),('งานอบรมลูกค้า',50,0,None,''))
        self.assertTrue(made['expires_at']>after(days=6))
        self.assertIn('<svg',self.svg(made['qr']))
        plain = self.ok(self.admin,LINKS,{})
        self.assertEqual((plain['label'],plain['expires_at'],plain['max_uses']),('',None,None))
        self.assertNotEqual(plain['url'],made['url'])
        listed = self.ok(self.admin,LINKS)['links']
        self.assertEqual([l['id'] for l in listed],[plain['id'],made['id']])          # newest first
        # Revoking stops the link at once; the row stays as history.
        self.assertEqual(self.status(self.admin,f'{LINKS}/{"0"*32}',None,'DELETE'),404)
        self.ok(self.admin,f'{LINKS}/{made["id"]}',None,'DELETE')
        revoked = next(l for l in self.ok(self.admin,LINKS)['links'] if l['id']==made['id'])
        self.assertEqual(revoked['gone'],'ยกเลิกแล้ว')
        self.assertTrue(revoked['revoked_at'])
        agent,_ = self.create_member()
        self.assertEqual(agent.call(f'{LINKS}/{plain["id"]}',None,'DELETE')[0],403)
        # Each organization sees only its own links.
        owner,_ = self.beta()
        self.assertEqual(self.ok(owner,LINKS)['links'],[])
        self.assertEqual(self.status(owner,f'{LINKS}/{plain["id"]}',None,'DELETE'),404)

    def test_a_customer_joins_by_a_link(self):
        owner,_ = self.beta()
        link = self.ok(owner,LINKS,{'label':'งานอีเวนต์','max_uses':1})
        path = join_path(link['url'])
        # Before signing in the page shows whose link it is, and nothing else.
        visitor = Client(self.base)
        self.assertEqual(self.ok(visitor,path),{'org_slug':'beta','org_name':'องค์กร B','valid':True,'reason':''})
        self.assertEqual(visitor.call(path,{})[0],401)
        self.assertEqual(visitor.call('/api/customer/join-links/'+'n'*22)[0],404)
        customer = self.customer(email='visitor@example.com')
        self.assertEqual(self.status(customer,'/api/customer/join-links/short'),404)
        joined = self.ok(customer,path,{})['organization']
        self.assertEqual((joined['slug'],joined['name'],joined['home']),('beta','องค์กร B',False))
        self.assertEqual([o['slug'] for o in self.ok(customer,'/api/customer/organizations')['organizations']],['alpha','beta'])
        self.assertEqual(self.ok(customer,f'{ORG.replace("alpha","beta")}/conversations',
                                 {'subject':'สอบถามบริการ','body':'ขอรายละเอียด'})['id'][:0],'')
        # One use per account, however often the link is opened.
        self.ok(customer,path,{})
        self.assertEqual(self.ok(owner,LINKS)['links'][0]['uses'],1)
        # Used up: nobody new gets in, while the account that used it still opens the link.
        second = self.customer(email='second@example.com')
        self.assertEqual(self.status(second,path,{}),410)
        self.ok(customer,path,{})
        self.assertEqual([o['slug'] for o in self.ok(second,'/api/customer/organizations')['organizations']],['alpha'])
        gone = self.ok(owner,LINKS)['links'][0]
        self.assertEqual((gone['uses'],gone['gone']),(1,'ใช้ครบจำนวนแล้ว'))
        self.assertFalse(self.ok(second,path)['valid'])

    def test_expired_and_revoked_links_open_for_nobody(self):
        owner,_ = self.beta()
        dated = self.ok(owner,LINKS,{'label':'7 วัน','days':7})
        pulled = self.ok(owner,LINKS,{'label':'ยกเลิกภายหลัง'})
        customer = self.customer(email='visitor@example.com')
        with D.control() as cd:
            cd.execute('UPDATE org_join_links SET expires_at=? WHERE id=?',(after(days=-1),dated['id']))
        self.assertEqual(self.ok(customer,join_path(dated['url'])),
                         {'org_slug':'beta','org_name':'องค์กร B','valid':False,'reason':'หมดอายุแล้ว'})
        self.assertEqual(self.status(customer,join_path(dated['url']),{}),410)
        self.ok(owner,f'{LINKS}/{pulled["id"]}',None,'DELETE')
        self.assertEqual(self.ok(customer,join_path(pulled['url']))['reason'],'ยกเลิกแล้ว')
        self.assertEqual(self.status(customer,join_path(pulled['url']),{}),410)
        self.assertEqual([o['slug'] for o in self.ok(customer,'/api/customer/organizations')['organizations']],['alpha'])
        # A suspended organization's link says no more than an unknown one.
        live = self.ok(owner,LINKS,{})
        self.ok(self.admin,'/api/platform/tenants/'+self.ok(owner,'/api/workspace')['tenant']['id'],
                {'status':'suspended','confirmation':'CONFIRM'},'PATCH')
        self.assertEqual(self.status(customer,join_path(live['url'])),404)

    def test_the_account_page_shows_every_organization(self):
        customer = self.customer(email='visitor@example.com')
        self.assertEqual(self.ok(customer,ROLES),{'organizations':[{'slug':'alpha','name':'องค์กร A','home':True,'member':True}]})
        beta,_ = self.beta()
        self.ok(customer,join_path(self.ok(beta,LINKS,{})['url']),{})
        self.assertEqual([(o['slug'],o['home'],o['member']) for o in self.ok(customer,ROLES)['organizations']],
                         [('alpha',True,True),('beta',False,True)])
        self.assertEqual(Client(self.base).call(ROLES)[0],401)

    def test_guessing_a_token_is_limited(self):
        owner,_ = self.beta()
        self.ok(owner,LINKS,{})
        visitor = Client(self.base)
        answers = {visitor.call('/api/customer/join-links/'+f'{i:022d}')[0] for i in range(35)}
        self.assertEqual(answers,{404,429})


if __name__ == '__main__':
    unittest.main()
