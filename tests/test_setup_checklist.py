"""เริ่มต้นใช้งาน: the four steps a new organization has to do, how far along it is, and the step that proves the
whole loop works. A new organization that cannot tell what to set up is one that stops using the system."""
import unittest

import test_app as base


class SetupChecklistTests(unittest.TestCase):
    def setup(self, who=None):
        return self.ok(who or self.admin,'/api/automation/overview')['setup']

    def steps(self, who=None):
        return {s['key']:s for s in self.setup(who)['steps']}

    def test_the_four_steps_are_the_four_asked_for(self):
        self.assertEqual([s['key'] for s in self.setup()['steps']],['channels','agents','articles','chat'])
        # Rules and AI are kept, apart: they make a working organization better, not a working one.
        self.assertEqual([s['key'] for s in self.setup()['later']],['rules','ai'])

    def test_adding_an_agent_ticks_its_step(self):
        self.assertFalse(self.steps()['agents']['done'])
        self.create_member()
        self.assertTrue(self.steps()['agents']['done'])

    def test_the_articles_step_counts_towards_five(self):
        step = self.steps()['articles']
        self.assertEqual(step['target'],5)
        start = step['count']
        self.assertFalse(step['done'])
        for i in range(5-start):
            self.ok(self.admin,'/api/articles',{'title':f'บทความที่ {i+1}','category':'ทั่วไป',
                                                'body':'เนื้อหาตัวอย่างสำหรับทดสอบ','visibility':'public'})
            counted = self.steps()['articles']
            self.assertEqual(counted['count'],start+i+1)
        self.assertTrue(self.steps()['articles']['done'])

    def test_one_real_conversation_ticks_the_try_it_step(self):
        # A brand new organization has nothing yet: none of the four is done, and this is the state a new customer
        # actually starts from (the test organization was seeded with demo data, so it starts further along).
        self.second_organization()
        fresh = self.steps()
        self.assertFalse(fresh['chat']['done'])
        self.assertEqual(fresh['articles']['count'],0)
        # One message sent as a customer, and the step that proves the loop works is ticked.
        self.visitor(slug='beta')
        self.assertTrue(self.steps()['chat']['done'])

    def test_the_agents_step_points_at_the_page_that_exists(self):
        self.assertEqual(self.steps()['agents']['action']['href'],'/members')

    def test_an_agent_never_sees_the_checklist(self):
        agent,_ = self.create_member()
        self.assertIsNone(self.ok(agent,'/api/automation/overview')['setup'])
        self.assertEqual(agent.call('/api/automation/setup',{'hidden':True})[0],403)

    def test_an_owner_closes_it_for_good_in_this_organization_only(self):
        self.assertFalse(self.setup()['hidden'])
        self.assertEqual(self.admin.call('/api/automation/setup',{'hidden':'yes'})[0],400)
        self.assertEqual(self.ok(self.admin,'/api/automation/setup',{'hidden':True}),{'hidden':True})
        closed = self.setup()
        self.assertTrue(closed['hidden'])
        # The steps are still there to read; what is broken is still sent (the page shows only that).
        self.assertEqual(len(closed['steps']),4)
        # Saving other preferences keeps it closed.
        self.ok(self.admin,'/api/account/preferences',{'alias':'แอดมิน'})
        self.assertTrue(self.setup()['hidden'])
        # Another organization of the same owner still has its own.
        self.second_organization()
        self.assertFalse(self.setup()['hidden'])
        self.admin.switch(self.org)
        self.assertTrue(self.setup()['hidden'])
        # And it can be brought back.
        self.ok(self.admin,'/api/automation/setup',{'hidden':False})
        self.assertFalse(self.setup()['hidden'])


# The setUp, the sign-ins and the helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(SetupChecklistTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
