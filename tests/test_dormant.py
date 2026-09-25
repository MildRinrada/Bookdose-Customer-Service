"""องค์กรที่หลับ: organizations nobody from the team has opened and no case has come into for 90 days are listed on the
platform console - never a new one or the platform's own - with what they hold, and their owners can be emailed from
there before they are suspended."""
import unittest

import test_app as base
from test_app import D
from backend.utils.dates import after

DORMANT = '/api/platform/dormant'


class DormantTests(unittest.TestCase):
    def organization(self, name, slug):
        tenant = self.ok(self.owner,'/api/platform/tenants',{'name':name,'slug':slug,'email':'orgadmin@example.com'})['id']
        with D.control() as cd:
            cd.execute('UPDATE tenants SET created_at=? WHERE id=?',(after(days=-200),tenant))
            cd.commit()
        return tenant

    def listed(self):
        return {o['slug']:o for o in self.ok(self.owner,DORMANT)['organizations']}

    def test_listed_contacted_and_suspended(self):
        asleep = self.organization('องค์กรเงียบ','quiet')
        awake = self.organization('องค์กรที่ยังใช้','busy')
        with D.tenant(awake) as db:     # someone in its team opened the app last week
            db.execute('INSERT INTO agent_activity VALUES(?,?)',('someone',after(days=-7)))
            db.commit()
        with D.tenant(asleep) as db:    # its last case, and a member's last visit, long ago
            db.execute('INSERT INTO agent_activity VALUES(?,?)',('someone',after(days=-120)))
            db.commit()
        self.organization('องค์กรใหม่','fresh')
        with D.control() as cd:
            cd.execute('UPDATE tenants SET created_at=? WHERE slug=?',(after(days=-10),'fresh'))
            cd.commit()
        listed = self.listed()
        # The platform's own organization (alpha) and a new one are never listed; nor is one still used.
        self.assertEqual(sorted(listed),['quiet'])
        quiet = listed['quiet']
        self.assertEqual(quiet['admins'],[{'name':'ผู้ดูแลองค์กร A','email':'orgadmin@example.com'}])
        self.assertEqual(quiet['last_seen'][:10],after(days=-120)[:10])
        self.assertIsNone(quiet['contacted'])
        # On the overview's to-do list too.
        todo = {i['key']:i for i in self.ok(self.owner,'/api/platform/health')['todo']}
        self.assertEqual(todo['dormant']['action']['href'],'/platform/organizations?tab=dormant')
        # Contacting needs the platform's mailbox, then emails the owners.
        body = {'subject':'ยังใช้งานอยู่ไหม','message':'องค์กรของคุณไม่มีการใช้งานมา 90 วัน'}
        self.assertEqual(self.owner.call(f'/api/platform/tenants/{asleep}/contact',body)[0],409)
        self.enable_registration_mail()
        self.assertEqual(self.ok(self.owner,f'/api/platform/tenants/{asleep}/contact',body)['sent'],['orgadmin@example.com'])
        mail = self.mailer.call_args.args[3]
        self.assertEqual(mail['Subject'],'ยังใช้งานอยู่ไหม')
        self.assertEqual(self.listed()['quiet']['contacted']['by'],'เจ้าของระบบ')
        # Only the platform's admins.
        self.assertEqual(self.admin.call(DORMANT)[0],403)
        # Suspended, it leaves the list.
        self.ok(self.owner,f'/api/platform/tenants/{asleep}',{'status':'suspended','confirmation':'CONFIRM'},'PATCH')
        self.assertEqual(self.listed(),{})


# The setUp, the sign-ins and the helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(DormantTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
