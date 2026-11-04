"""จำนวนทีมงาน (platform/team_size.py), แบบคนเดียว, แจกเคสอัตโนมัติ as the default (automation/distribution.py) and the
ผู้ดูแลสมาชิก role ('people', organization/model.py)."""
import sqlite3
import unittest

import test_guest_chat as guest_tests
from test_app import Client, D
from backend.modules.platform import team_size

CONSOLE = '/api/platform/tenants'


class TeamSizeTests(unittest.TestCase):
    setUp = guest_tests.GuestChatTests.setUp
    tearDown = guest_tests.GuestChatTests.tearDown
    ok = guest_tests.GuestChatTests.ok
    start = guest_tests.GuestChatTests.start
    started = guest_tests.GuestChatTests.started
    browser = guest_tests.GuestChatTests.browser
    create_member = guest_tests.GuestChatTests.create_member
    enable_registration_mail = guest_tests.GuestChatTests.enable_registration_mail

    # Helpers
    def seats(self):
        return self.ok(self.admin,'/api/workspace')['team_size']

    def set_limit(self, value):
        return self.owner.call(f'{CONSOLE}/{self.org}/team-size',{'member_limit':value},'PATCH')

    def case_of(self, conv):
        return self.ok(self.admin,f'/api/conversations/{conv}')['ticket']

    def admin_id(self):
        return next(m['id'] for m in self.ok(self.admin,'/api/workspace')['members'] if m['email']=='orgadmin@example.com')

    # จำนวนทีมงาน
    def test_the_console_sets_the_number_never_below_the_people_working_there(self):
        working = self.seats()['members']
        self.assertEqual(self.set_limit(6)[0],400)
        self.assertEqual(self.set_limit(0)[0],400)
        if working>1:
            status,data = self.set_limit(working-1)
            self.assertEqual(status,409,data)
        self.assertEqual(self.set_limit(working+1)[0],200)
        self.assertEqual(self.seats()['limit'],working+1)
        listed = next(t for t in self.ok(self.owner,CONSOLE)['tenants'] if t['id']==self.org)
        self.assertEqual(listed['member_limit'],working+1)
        # The last seat is taken; the next person is refused, and so is switching someone back on.
        _,agent_id = self.create_member()
        status,data = self.admin.call('/api/members',{'name':'อีกคน','email':'one-more@example.com','password':'Test-password-123!','role':'agent','team_id':self.team})
        self.assertEqual(status,409,data)
        self.assertIn('ครบ',data['error'])
        self.ok(self.admin,f'/api/members/{agent_id}',{'role':'agent','team_id':self.team,'active':False},'PATCH')
        self.ok(self.admin,'/api/members',{'name':'อีกคน','email':'one-more@example.com','password':'Test-password-123!','role':'agent','team_id':self.team})
        status,data = self.admin.call(f'/api/members/{agent_id}',{'role':'agent','team_id':self.team,'active':True},'PATCH')
        self.assertEqual(status,409,data)

    def test_an_open_invitation_holds_a_seat_until_it_is_answered(self):
        self.enable_registration_mail()
        working = self.seats()['members']
        self.assertEqual(self.set_limit(working+1)[0],200)
        self.ok(self.admin,'/api/invitations',{'email':'invited@example.com','role':'agent','team_id':self.team})
        self.assertEqual(self.seats()['invited'],1)
        # The same address invited again keeps its seat; anyone else finds none.
        self.ok(self.admin,'/api/invitations',{'email':'invited@example.com','role':'agent','team_id':self.team})
        self.assertEqual(self.admin.call('/api/invitations',{'email':'other@example.com','role':'agent','team_id':self.team})[0],409)
        invite = next(i for i in self.ok(self.admin,'/api/invitations')['invitations'] if i['email']=='invited@example.com')
        self.ok(self.admin,f"/api/invitations/{invite['id']}",method='DELETE')
        self.ok(self.admin,'/api/invitations',{'email':'other@example.com','role':'agent','team_id':self.team})

    # แบบคนเดียว
    def test_alone_every_case_is_the_leads_at_once_and_nobody_can_be_added(self):
        for member in self.ok(self.admin,'/api/workspace')['members']:
            if member['active'] and member['email']!='orgadmin@example.com':
                self.ok(self.admin,f"/api/members/{member['id']}",{'role':member['role'],'team_id':member['team_id'],'active':False},'PATCH')
        self.assertEqual(self.set_limit(1)[0],200)
        self.assertTrue(self.seats()['solo'])
        # Nobody is asked to press รับเคส, whether or not cases are handed out: the case is the lead's already.
        ticket = self.case_of(self.started(self.browser()))
        self.assertEqual(ticket['assignee_id'],self.admin_id())
        status,data = self.admin.call('/api/members',{'name':'อีกคน','email':'one-more@example.com','password':'Test-password-123!','role':'agent','team_id':self.team})
        self.assertEqual(status,409)
        self.assertIn('คนเดียว',data['error'])

    def test_a_new_organization_starts_alone(self):
        self.team_default.stop()
        self.ok(self.owner,CONSOLE,{'name':'องค์กร B','slug':'bravo','email':'bravo@example.com','admin_name':'หัวหน้าทีม B','password':'Test-password-123!'})
        bravo = next(t for t in self.ok(self.owner,CONSOLE)['tenants'] if t['slug']=='bravo')
        self.assertEqual(bravo['member_limit'],1)

    # แจกเคสอัตโนมัติ
    def test_cases_are_handed_out_unless_the_organization_turned_it_off(self):
        self.handout_default.stop()
        agent,agent_id = self.create_member()
        self.ok(agent,'/api/workspace')
        self.assertEqual(self.case_of(self.started(self.browser()))['assignee_id'],agent_id)
        self.ok(self.admin,'/api/automation/distribution',{'enabled':False,'cap':5,'all_teams':True,'teams':[],'owners':False},'PATCH')
        self.assertIsNone(self.case_of(self.started(self.browser()))['assignee_id'])

    # ผู้ดูแลสมาชิก
    def test_a_people_admin_looks_after_members_and_sees_none_of_the_work(self):
        people,people_id = self.create_member(role='people',email='people@example.com')
        workspace = self.ok(people,'/api/workspace')
        self.assertEqual(workspace['role'],'people')
        for path in ('/api/conversations','/api/tickets','/api/contacts','/api/automation/alerts','/api/settings/tags'):
            self.assertEqual(people.call(path)[0],403,path)
        # They bring in agents and other ผู้ดูแลสมาชิก, never a หัวหน้าทีม; they change neither one nor themselves.
        self.set_limit(5)
        agent_id = self.ok(people,'/api/members',{'name':'เจ้าหน้าที่ใหม่','email':'new-agent@example.com','password':'Test-password-123!','role':'agent','team_id':self.team})['id']
        self.assertEqual(people.call('/api/members',{'name':'หัวหน้าใหม่','email':'new-lead@example.com','password':'Test-password-123!','role':'admin','team_id':self.team})[0],403)
        self.ok(people,f'/api/members/{agent_id}',{'role':'agent','team_id':self.team,'active':False},'PATCH')
        self.assertEqual(people.call(f'/api/members/{self.admin_id()}',{'role':'agent','team_id':self.team,'active':True},'PATCH')[0],403)
        self.assertEqual(people.call(f'/api/members/{people_id}',{'role':'admin','team_id':self.team,'active':True},'PATCH')[0],403)
        # Never someone a case goes to, nor a colleague an agent sees in the team.
        from backend.middleware.access import validate_assignee
        from backend.exceptions.errors import APIError
        with D.control() as cd, self.assertRaises(APIError):
            validate_assignee(cd,{'tenant_id':self.org},people_id,self.team)
        agent,_ = self.create_member(email='agent-two@example.com')
        self.assertNotIn(people_id,[m['id'] for m in self.ok(agent,'/api/workspace')['members']])

    def test_an_older_member_table_learns_the_new_role(self):
        from backend.modules.organization import repository
        db = sqlite3.connect(':memory:')
        db.execute('''CREATE TABLE memberships (
            tenant_id TEXT NOT NULL, user_id TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin','manager','agent')), team_id TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1, expires_at TEXT, PRIMARY KEY(tenant_id,user_id))''')
        db.execute("INSERT INTO memberships VALUES('t','u','admin','team',1,NULL)")
        db.commit()
        repository.allow_people_role(db)
        repository.allow_people_role(db)
        db.execute("INSERT INTO memberships VALUES('t','p','people','team',1,NULL)")
        self.assertEqual(db.execute('SELECT user_id,role FROM memberships ORDER BY user_id').fetchall(),[('p','people'),('u','admin')])


if __name__ == '__main__':
    unittest.main()
