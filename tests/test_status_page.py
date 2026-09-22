"""The public status page: it answers without a sign-in, it says nothing about any one organization, and the note the
platform team writes is what turns "is it them or us?" into "they know, they are on it"."""
import unittest

import test_app as base


class StatusPageTests(unittest.TestCase):
    def test_anyone_may_read_it_without_signing_in(self):
        visitor = base.Client(self.base)
        status,answer = visitor.call('/api/status')
        self.assertEqual(status,200,answer)
        self.assertIn(answer['state'],('ok','partial','down','unknown'))
        self.assertTrue(answer['checked_at'])
        self.assertEqual({c['key'] for c in answer['components']},{'api','workers','storage','mail'})

    def test_it_names_no_organization(self):
        visitor = base.Client(self.base)
        answer = str(self.ok(visitor,'/api/status'))
        for secret in ('alpha','องค์กร A','admin@example.com'):
            self.assertNotIn(secret,answer,secret)

    def test_the_team_writes_a_note_and_everyone_sees_it(self):
        visitor = base.Client(self.base)
        self.assertIsNone(self.ok(visitor,'/api/status')['notice'])
        self.ok(self.owner,'/api/platform/status',{'state':'watching','text':'กำลังตรวจสอบปัญหาการส่งข้อความออก'})
        answer = self.ok(visitor,'/api/status')
        self.assertEqual(answer['notice']['state'],'watching')
        self.assertEqual(answer['notice']['text'],'กำลังตรวจสอบปัญหาการส่งข้อความออก')
        self.assertTrue(answer['notice']['updated_by'])
        # A note about trouble is never drowned out by the checks being green.
        self.assertIn(answer['state'],('partial','down'))
        self.ok(self.owner,'/api/platform/status',None,'DELETE')
        self.assertIsNone(self.ok(visitor,'/api/status')['notice'])

    def test_only_a_platform_admin_writes_it(self):
        self.assertEqual(self.admin.call('/api/platform/status',{'state':'down','text':'x'})[0],403)
        self.assertEqual(base.Client(self.base).call('/api/platform/status',{'state':'down','text':'x'})[0],401)

    def test_refused_notes(self):
        for bad in ({'state':'ok','text':'x'},{'state':'nope','text':'x'},{'state':'down','text':''},
                    {'state':'down','text':'x'*501},{'text':'x'},{}):
            self.assertEqual(self.owner.call('/api/platform/status',bad)[0],400,bad)


# The setUp, the sign-ins and the helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(StatusPageTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
