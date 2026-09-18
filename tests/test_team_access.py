"""An organization looking after its own team: inviting colleagues by email instead of inventing passwords for them
(invitations), and a staff member who forgot their password getting back in without asking an admin (auth.forgot_password /
auth.reset_password, which also lifts the lock from wrong passwords). Email is mocked; nothing leaves the machine."""
import unittest

import test_app as base
from test_app import Client, D
from backend.middleware import rate_limit

PASSWORD = 'Test-password-123!'
NEW_PASSWORD = 'Brand-new-password-9!'
INVITATIONS = '/api/invitations'


class TeamAccessTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    create_member = base.IntegrationTests.create_member
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    email_token = base.IntegrationTests.email_token

    def invite(self, email='newcomer@example.com', role='agent'):
        self.enable_registration_mail()
        answer = self.ok(self.admin,INVITATIONS,{'email':email,'role':role,'team_id':self.team})
        self.assertTrue(answer['sent'])
        return answer,self.email_token()

    def signed_out(self):
        rate_limit.RATES.clear()
        return Client(self.base)

    def test_an_admin_invites_a_colleague_who_chooses_their_own_password(self):
        answer,token = self.invite()
        pending = answer['invitations'][0]
        self.assertEqual((pending['email'],pending['state'],pending['role']),('newcomer@example.com','pending','agent'))
        # The invitation alone is not a membership: nothing exists for that address yet.
        self.assertNotIn('newcomer@example.com',[m['email'] for m in self.ok(self.admin,'/api/workspace')['members']])
        # The page behind the link names the organization and asks for a password, because the address is new here.
        guest = self.signed_out()
        view = self.ok(guest,'/api/invitation?token='+token,method='GET')
        self.assertEqual((view['email'],view['organization'],view['needs_account']),('newcomer@example.com','องค์กร A',True))
        joined = self.ok(guest,'/api/invitation/accept',{'token':token,'name':'เพื่อนร่วมงาน','password':NEW_PASSWORD})
        self.assertTrue(joined['signed_in'])
        self.assertEqual(guest.boot()['user']['email'],'newcomer@example.com')
        member = next(m for m in self.ok(self.admin,'/api/workspace')['members'] if m['email']=='newcomer@example.com')
        self.assertEqual((member['role'],member['team_id'],member['active']),('agent',self.team,1))
        # The link is spent, and the admin sees the invitation as taken.
        self.assertEqual(self.signed_out().call('/api/invitation/accept',{'token':token,'name':'อีกคน','password':NEW_PASSWORD})[0],400)
        self.assertEqual(self.ok(self.admin,INVITATIONS,method='GET')['invitations'][0]['state'],'accepted')
        # The password is the newcomer's own: the admin never chose or saw it, and it really signs them in.
        fresh = self.signed_out()
        self.ok(fresh,'/api/login',{'email':'newcomer@example.com','password':NEW_PASSWORD})
        self.assertEqual(fresh.boot()['user']['name'],'เพื่อนร่วมงาน')

    def test_somebody_who_already_has_an_account_joins_with_the_password_they_know(self):
        self.enable_registration_mail()
        agent,user_id = self.create_member(email='agent@example.com')
        # They left the team; the account on the platform stays, so they must not be asked for a new password.
        self.ok(self.admin,f'/api/members/{user_id}',{'role':'agent','team_id':self.team,'active':False},method='PATCH')
        self.assertEqual(agent.call('/api/tickets')[0],403)
        _,token = self.invite(email='agent@example.com')
        guest = self.signed_out()
        self.assertFalse(self.ok(guest,'/api/invitation?token='+token,method='GET')['needs_account'])
        # Nothing is set and no session is handed out: an emailed link never skips a sign-in.
        joined = self.ok(guest,'/api/invitation/accept',{'token':token})
        self.assertEqual((joined['signed_in'],joined['organization']),(False,'องค์กร A'))
        self.assertIsNone(guest.boot()['user'])
        back = self.signed_out()
        self.ok(back,'/api/login',{'email':'agent@example.com','password':PASSWORD})
        self.assertIn(self.org,[m['id'] for m in back.boot()['memberships']])

    def test_an_invitation_can_be_taken_back_and_the_same_address_is_never_invited_twice(self):
        answer,token = self.invite()
        invite_id = answer['invitations'][0]['id']
        # A second invitation for the same address replaces the first one instead of piling up.
        again = self.ok(self.admin,INVITATIONS,{'email':'newcomer@example.com','role':'manager','team_id':self.team})
        self.assertEqual(len(again['invitations']),1)
        self.assertEqual(again['invitations'][0]['role'],'manager')
        self.assertEqual(self.signed_out().call('/api/invitation?token='+token,method='GET')[0],400)
        self.ok(self.admin,f'{INVITATIONS}/{invite_id}',method='DELETE')
        self.assertEqual(self.ok(self.admin,INVITATIONS,method='GET')['invitations'][0]['state'],'cancelled')
        newest = self.email_token()
        self.assertEqual(self.signed_out().call('/api/invitation/accept',{'token':newest,'name':'ใครก็ตาม','password':NEW_PASSWORD})[0],400)

    def test_only_an_admin_of_that_organization_invites(self):
        self.enable_registration_mail()
        agent,_ = self.create_member()
        self.assertEqual(agent.call(INVITATIONS,{'email':'x@example.com','role':'agent','team_id':self.team})[0],403)
        self.assertEqual(agent.call(INVITATIONS,method='GET')[0],403)
        # Without the platform's mailbox there is nothing to send an invitation with; the members page still works.
        with D.control() as cd:
            cd.execute("DELETE FROM platform_settings WHERE key='registration_mail'")
            cd.commit()
        self.assertEqual(self.admin.call(INVITATIONS,{'email':'x@example.com','role':'agent','team_id':self.team})[0],503)
        self.assertFalse(self.ok(self.admin,INVITATIONS,method='GET')['can_invite'])

    def test_a_staff_member_sets_a_new_password_from_their_own_email_and_the_lock_goes_with_it(self):
        self.enable_registration_mail()
        agent,_ = self.create_member(email='agent@example.com')
        # Five wrong passwords lock the address: before, the only way back was to wait or to ask an admin.
        locked = self.signed_out()
        for _ in range(5):
            self.assertEqual(locked.call('/api/login',{'email':'agent@example.com','password':'wrong-password-1'})[0],401)
        self.assertEqual(locked.call('/api/login',{'email':'agent@example.com','password':PASSWORD})[0],429)
        # The answer never says whether the address has an account.
        self.assertEqual(self.signed_out().call('/api/forgot-password',{'email':'nobody@example.com'})[0],202)
        self.assertEqual(self.signed_out().call('/api/forgot-password',{'email':'agent@example.com'})[0],202)
        token = self.email_token()
        answer = self.ok(self.signed_out(),'/api/reset-password',{'token':token,'password':NEW_PASSWORD})
        self.assertTrue(answer['unlocked'])
        # The link signs nobody in; the new password does, at once, with no wait left over from the lock.
        back = self.signed_out()
        self.assertIsNone(back.boot()['user'])
        self.assertEqual(back.call('/api/login',{'email':'agent@example.com','password':PASSWORD})[0],401)
        self.ok(back,'/api/login',{'email':'agent@example.com','password':NEW_PASSWORD})
        self.assertEqual(back.boot()['user']['email'],'agent@example.com')
        # The old sessions of that account are gone, and the link cannot be used a second time.
        self.assertIsNone(agent.boot()['user'])
        self.assertEqual(self.signed_out().call('/api/reset-password',{'token':token,'password':NEW_PASSWORD})[0],400)


if __name__=='__main__':
    unittest.main()
