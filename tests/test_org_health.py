"""คะแนนสุขภาพต่อองค์กร: the four signals a platform admin needs to tell a healthy organization from one in trouble,
and the rule that keeps the number honest - a signal with no data is left out, never counted as zero."""
import unittest

import test_app as base


class OrgHealthTests(unittest.TestCase):
    def health(self, tenant=None):
        tenant = tenant or self.ok(self.admin,'/api/workspace')['tenant']['id']
        return next(o for o in self.ok(self.owner,'/api/platform/health')['usage'] if o['id']==tenant)['health']

    def test_the_four_signals_are_there(self):
        self.assertEqual(set(self.health()['signals']),{'response','csat','backlog','channels'})

    def test_a_brand_new_organization_is_new_not_in_trouble(self):
        beta,_ = self.second_organization()
        fresh = self.health(beta)
        self.assertEqual(fresh['level'],'new')
        self.assertIsNone(fresh['score'])
        # Every signal says it has nothing to go on, rather than reporting zero.
        self.assertTrue(all(s['score'] is None for s in fresh['signals'].values()),fresh['signals'])

    def test_a_backlog_past_its_deadline_pulls_the_score_down(self):
        before = self.health()
        # Open cases whose resolution deadline has already gone by.
        from backend.database import db as D
        tenant = self.ok(self.admin,'/api/workspace')['tenant']['id']
        with D.tenant(tenant) as db:
            db.execute("UPDATE tickets SET resolution_due_at='2000-01-01T00:00:00+00:00' WHERE status NOT IN ('resolved','closed')")
            db.commit()
        after = self.health()
        self.assertEqual(after['signals']['backlog']['score'],0)
        self.assertGreater(after['signals']['backlog']['overdue'],0)
        self.assertLess(after['score'],before['score'] or 100)

    def test_what_the_score_is_made_of_travels_with_it(self):
        signals = self.health()['signals']
        self.assertIn('total',signals['response'])
        self.assertIn('answers',signals['csat'])
        self.assertIn('open_cases',signals['backlog'])
        self.assertIn('failing',signals['channels'])

    def test_only_a_platform_admin_sees_it(self):
        self.assertEqual(self.admin.call('/api/platform/health')[0],403)


# The setUp, the sign-ins and the helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(OrgHealthTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
