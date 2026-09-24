"""ประกาศปัญหาที่รู้แล้ว: an owner posts what is down, customers read it on the chat pages without signing in, it shows
as back for a while once resolved, and only the organization's owners may post or close one."""
import unittest

import test_app as base
from backend.database import db as D


class KnownIssueTests(unittest.TestCase):
    def public(self):
        return self.ok(self.anonymous(),'/api/public/alpha/issues')['issues']

    def anonymous(self):
        client = base.Client(self.base)
        client.boot()
        return client

    def test_posted_shown_to_customers_resolved_then_gone(self):
        posted = self.ok(self.admin,'/api/issues',{'title':'ระบบชำระเงิน','detail':'จ่ายด้วยบัตรไม่ได้ชั่วคราว คาดว่าแก้เสร็จ 15:00'})
        issue = posted['issues'][0]
        self.assertEqual((issue['title'],issue['status']),('ระบบชำระเงิน','active'))
        shown = self.public()
        self.assertEqual([(i['title'],i['status']) for i in shown],[('ระบบชำระเงิน','active')])
        self.assertNotIn('author_name',shown[0])   # no staff names on the customers' copy
        # Resolved: still shown, as back, so those who saw the problem see it end.
        self.ok(self.admin,f"/api/issues/{issue['id']}",{'status':'resolved'},'PATCH')
        self.assertEqual(self.public()[0]['status'],'resolved')
        # An hour later it is gone from the customers' pages.
        with D.tenant(self.org) as db:
            db.execute("UPDATE known_issues SET resolved_at='2026-01-01T00:00:00+00:00'")
            db.commit()
        self.assertEqual(self.public(),[])
        with D.tenant(self.org) as db:
            events = [r[0] for r in db.execute("SELECT action FROM audit_logs WHERE entity=? ORDER BY rowid",(issue['id'],))]
        self.assertEqual(events,['issue.posted','issue.resolved'])

    def test_only_owners_post_and_every_member_reads(self):
        agent,_ = self.create_member(role='agent',email='issue.agent@example.com')
        status,_ = agent.call('/api/issues',{'title':'ระบบล่ม'})
        self.assertEqual(status,403)
        self.ok(self.admin,'/api/issues',{'title':'แอปมือถือ'})
        self.assertEqual([i['title'] for i in self.ok(agent,'/api/issues')['issues']],['แอปมือถือ'])

    def test_a_title_is_required(self):
        status,_ = self.admin.call('/api/issues',{'title':'  '})
        self.assertEqual(status,400)


# The setUp, the sign-ins and the helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(KnownIssueTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
