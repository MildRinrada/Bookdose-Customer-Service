"""Correcting an organization's code. Every link a customer was given holds the code, so the old one has to keep
working; and no other organization may ever be handed a code that used to lead somewhere else."""
import unittest

import test_app as base


class SlugRenameTests(unittest.TestCase):
    def rename(self, tenant, slug, who=None):
        return (who or self.owner).call(f'/api/platform/tenants/{tenant}/slug',{'slug':slug},'PATCH')

    def test_the_code_changes_and_the_old_one_still_leads_here(self):
        tenant = self.ok(self.admin,'/api/workspace')['tenant']['id']
        before = self.ok(self.admin,'/api/workspace')['tenant']['slug']
        visitor,_ = self.visitor(slug=before)
        status,answer = self.rename(tenant,'alpha-fixed')
        self.assertEqual(status,200,answer)
        self.assertEqual(answer['slug'],'alpha-fixed')
        self.assertEqual(answer['former_slugs'],[before])
        # The organization is reached by the new code...
        self.assertEqual(self.ok(visitor,'/api/public/alpha-fixed')['organization']['slug'],'alpha-fixed')
        # ...and by the one in every link already sent out, which answers with the code it has now.
        self.assertEqual(self.ok(visitor,f'/api/public/{before}')['organization']['slug'],'alpha-fixed')
        self.assertEqual(self.ok(self.admin,'/api/workspace')['tenant']['slug'],'alpha-fixed')

    def test_a_retired_code_is_never_given_to_another_organization(self):
        tenant = self.ok(self.admin,'/api/workspace')['tenant']['id']
        before = self.ok(self.admin,'/api/workspace')['tenant']['slug']
        self.ok(self.owner,f'/api/platform/tenants/{tenant}/slug',{'slug':'alpha-fixed'},'PATCH')
        # A brand new organization cannot take the retired code: an old link would open the wrong help centre.
        status,answer = self.owner.call('/api/platform/tenants',{'name':'องค์กรอื่น','slug':before})
        self.assertEqual(status,409,answer)
        # The organization itself may take its own old code back.
        self.assertEqual(self.rename(tenant,before)[0],200)
        self.assertEqual(self.ok(self.admin,'/api/workspace')['tenant']['slug'],before)

    def test_refused_codes(self):
        tenant = self.ok(self.admin,'/api/workspace')['tenant']['id']
        now = self.ok(self.admin,'/api/workspace')['tenant']['slug']
        self.assertEqual(self.rename(tenant,now)[0],400)              # the code it already has
        self.assertEqual(self.rename(tenant,'Alpha Fixed')[0],400)     # spaces and capitals
        self.assertEqual(self.rename(tenant,'-bad-')[0],400)
        self.assertEqual(self.rename(tenant,'')[0],400)
        self.ok(self.owner,'/api/platform/tenants',{'name':'องค์กร B','slug':'beta','email':'orgadmin@example.com'})
        self.assertEqual(self.rename(tenant,'beta')[0],409)            # another organization's code

    def test_only_a_platform_admin_may_change_it(self):
        tenant = self.ok(self.admin,'/api/workspace')['tenant']['id']
        self.assertEqual(self.rename(tenant,'alpha-fixed',who=self.admin)[0],403)

    def test_a_guest_keeps_their_chat_across_the_change(self):
        tenant = self.ok(self.admin,'/api/workspace')['tenant']['id']
        before = self.ok(self.admin,'/api/workspace')['tenant']['slug']
        self.ok(self.admin,'/api/settings/guest-chat',{'enabled':True})
        guest = base.Client(self.base)
        started = guest.call(f'/api/public/{before}/guest/conversations',
                             {'body':'สวัสดีครับ','name':'ผู้มาเยือน','remember':True,'started_ms':0})
        self.assertEqual(started[0],201,started)
        self.assertEqual(self.ok(guest,f'/api/public/{before}/guest')['conversations'][0]['id'],started[1]['id'])
        self.ok(self.owner,f'/api/platform/tenants/{tenant}/slug',{'slug':'alpha-fixed'},'PATCH')
        # The browser still holds g_<the old code>; the chat is still theirs under the new one.
        status,answer = guest.call('/api/public/alpha-fixed/guest')
        self.assertEqual(status,200,answer)
        self.assertEqual([c['id'] for c in answer['conversations']],[started[1]['id']])


    def test_the_organizations_own_owner_may_correct_it(self):
        before = self.ok(self.admin,'/api/workspace')['tenant']['slug']
        status,answer = self.admin.call('/api/settings/slug',{'slug':'alpha-own'},'PATCH')
        self.assertEqual(status,200,answer)
        self.assertEqual(answer['slug'],'alpha-own')
        workspace = self.ok(self.admin,'/api/workspace')
        self.assertEqual(workspace['tenant']['slug'],'alpha-own')
        self.assertEqual(workspace['tenant']['former_slugs'],[before])
        # The old code still opens the help centre, as it does when the platform changes it.
        self.assertEqual(self.ok(self.admin,f'/api/public/{before}')['organization']['slug'],'alpha-own')

    def test_an_agent_may_not_correct_it(self):
        agent,_ = self.create_member()
        self.assertEqual(agent.call('/api/settings/slug',{'slug':'alpha-agent'},'PATCH')[0],403)

    def test_the_owner_is_held_to_the_same_rules(self):
        self.ok(self.owner,'/api/platform/tenants',{'name':'องค์กร B','slug':'beta','email':'orgadmin@example.com'})
        self.assertEqual(self.admin.call('/api/settings/slug',{'slug':'beta'},'PATCH')[0],409)
        self.assertEqual(self.admin.call('/api/settings/slug',{'slug':'BAD CODE'},'PATCH')[0],400)

    def test_the_web_app_can_ask_which_code_is_current(self):
        tenant = self.ok(self.admin,'/api/workspace')['tenant']['id']
        before = self.ok(self.admin,'/api/workspace')['tenant']['slug']
        self.ok(self.owner,f'/api/platform/tenants/{tenant}/slug',{'slug':'alpha-fixed'},'PATCH')
        # This is what the web app asks before drawing a help-centre page, to move the address bar on.
        self.assertEqual(self.ok(self.admin,f'/api/public/{before}/code')['slug'],'alpha-fixed')
        self.assertEqual(self.ok(self.admin,'/api/public/alpha-fixed/code')['slug'],'alpha-fixed')


# The setUp, the sign-ins and the helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(SlugRenameTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
