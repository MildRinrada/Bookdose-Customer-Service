"""Platform admins look after the server only (organization/repository.py): they never work in an organization - no
member list, no case, no routing, no customer reply - and look into one only on a support access, read-only. The
organization is run by its own admin, whom the console invites (the platform's own organization included). Email is
mocked; nothing leaves the machine."""
import unittest

import test_app as base
from test_app import Client

PASSWORD = 'Test-password-123!'


class PlatformRoleTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    visitor = base.IntegrationTests.visitor
    customer = base.IntegrationTests.customer
    create_member = base.IntegrationTests.create_member
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD

    def owner_id(self):
        return self.ok(self.owner,'/api/bootstrap')['user']['id']

    def test_the_owner_has_the_console_and_no_organization(self):
        boot = self.ok(self.owner,'/api/bootstrap')
        self.assertTrue(boot['user']['platform_admin'])
        self.assertEqual((boot['memberships'],boot['tenant_id']),([],None))
        self.assertEqual(self.owner.call('/api/platform/system')[0],200)
        # First-run setup made the owner nobody's member: signing in again opens no organization either.
        fresh = Client(self.base)
        self.assertEqual(fresh.login('admin@example.com')['tenant_id'],None)
        fresh.tenant = self.org
        for path in ('/api/workspace','/api/tickets','/api/conversations'):
            self.assertEqual(fresh.call(path)[0],403,path)
        self.assertEqual(fresh.call('/api/session/tenant',{'tenant_id':self.org})[0],403)

    def test_the_owner_is_never_given_work(self):
        owner = self.owner_id()
        members = self.ok(self.admin,'/api/workspace')['members']
        self.assertNotIn(owner,[m['id'] for m in members])
        _,conv = self.visitor()
        tid = self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']
        self.assertEqual(self.admin.call(f'/api/tickets/{tid}',{'assignee_id':owner},'PATCH')[0],400)
        self.assertIn(self.admin.call('/api/automation/rules',{'name':'ให้เจ้าของระบบ','keywords':'x','set_assignee_id':owner})[0],(400,404))
        # Nor invited or added as a member, nor made the admin of a new organization.
        self.enable_registration_mail()
        self.assertEqual(self.admin.call('/api/invitations',{'email':'admin@example.com','role':'agent','team_id':self.team})[0],409)
        self.assertEqual(self.owner.call('/api/platform/tenants',{'name':'องค์กร C','slug':'gamma','email':'admin@example.com'})[0],409)
        self.assertEqual(self.owner.call(f'/api/platform/tenants/{self.org}/admins',{'email':'admin@example.com'})[0],409)
        # And an organization's member is not made a platform admin (they would silently stop taking cases).
        self.assertEqual(self.owner.call('/api/platform/admins',{'email':'orgadmin@example.com'})[0],409)

    def test_the_console_invites_an_organizations_admin(self):
        tenants = self.ok(self.owner,'/api/platform/tenants')
        alpha = next(t for t in tenants['tenants'] if t['id']==self.org)
        self.assertEqual([a['email'] for a in alpha['admins']],['orgadmin@example.com'])
        self.assertFalse(tenants['can_invite'])
        # Without the platform's email an invitation cannot go; with it, the admin gets a link and sets a password.
        self.assertEqual(self.owner.call(f'/api/platform/tenants/{self.org}/admins',{'email':'second@example.com'})[0],503)
        self.enable_registration_mail()
        self.assertEqual(self.ok(self.owner,f'/api/platform/tenants/{self.org}/admins',{'email':'second@example.com'}),{'mode':'invited','sent':True})
        alpha = next(t for t in self.ok(self.owner,'/api/platform/tenants')['tenants'] if t['id']==self.org)
        self.assertEqual(alpha['admin_invites'],['second@example.com'])
        token = self.mail_link('token')
        joined = Client(self.base)
        self.ok(joined,'/api/invitation/accept',{'token':token,'name':'ผู้ดูแลคนที่สอง','password':'Second-pass-123!'})
        self.assertEqual(joined.boot()['memberships'][0]['role'],'admin')
        self.assertEqual(self.owner.call(f'/api/platform/tenants/{self.org}/admins',{'email':'orgadmin@example.com'})[0],409)

    def test_support_access_lets_the_owner_look_but_never_act(self):
        self.enable_registration_mail()
        visitor,conv = self.visitor()
        self.ok(self.owner,f'/api/platform/tenants/{self.org}/support-access',{'reason':'ตรวจสอบปัญหา #42','hours':4})
        request = self.ok(self.admin,'/api/support-access')['requests'][0]['id']
        self.ok(self.admin,f'/api/support-access/{request}/approve',{'hours':4})
        self.ok(self.owner,'/api/session/tenant',{'tenant_id':self.org})
        self.owner.boot()
        work = self.ok(self.owner,'/api/workspace')
        self.assertTrue(work['read_only'])
        self.assertNotIn(self.owner_id(),[m['id'] for m in work['members']])
        self.assertTrue(self.ok(self.owner,'/api/conversations')['conversations'])
        self.ok(self.owner,f'/api/conversations/{conv}')
        for path,body,method in ((f'/api/conversations/{conv}/messages',{'kind':'reply','body':'สวัสดีค่ะ'},None),
                                 (f'/api/conversations/{conv}/ticket',{},None),
                                 (f'/api/conversations/{conv}',{'status':'closed'},'PATCH'),
                                 ('/api/settings',{'response_hours':2},'PATCH')):
            status,answer = self.owner.call(path,body,method)
            self.assertEqual(status,403,path)
            self.assertIn('ดูอย่างเดียว',answer['error'])
        self.assertEqual([m['kind'] for m in self.ok(self.admin,f'/api/conversations/{conv}')['messages']],['customer'])


if __name__=='__main__':
    unittest.main()
