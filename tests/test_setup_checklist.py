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


# The setUp, the sign-ins and the helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(SetupChecklistTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
