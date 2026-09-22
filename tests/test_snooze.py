"""พักเคสไว้ก่อน: a case waiting on something outside the team leaves the queue until the moment it is worth looking
at again, and comes back on its own. What the tests hold to is the part that makes a pause safe to use: it never
disappears (ทุกเคส still counts it), the SLA clock is not moved by it, a customer's reply ends it at once, and the
worker hands it back when its time comes."""
import datetime as dt
import unittest

import test_app as base
from backend.database import db as D
from backend.modules.tickets import service as tickets
from backend.utils.dates import iso, utc_now


class SnoozeTests(unittest.TestCase):
    def a_case(self):
        """A case opened from a customer's support-page conversation; (customer, case id)."""
        visitor,conversation = self.visitor()
        return visitor,self.ok(self.admin,f'/api/conversations/{conversation}/ticket',{})['id']

    def listed(self, ticket_id):
        return next(t for t in self.ok(self.admin,'/api/tickets')['tickets'] if t['id']==ticket_id)

    def in_hours(self, hours):
        return iso(utc_now()+dt.timedelta(hours=hours))

    def test_pausing_says_when_it_comes_back_why_and_who(self):
        _,ticket = self.a_case()
        until = self.in_hours(18)
        self.ok(self.admin,f'/api/tickets/{ticket}/snooze',{'until':until,'note':'รอลูกค้าส่งสลิป'})
        row = self.listed(ticket)
        self.assertEqual(row['snoozed_until'],until)
        self.assertEqual(row['snooze_note'],'รอลูกค้าส่งสลิป')
        self.assertTrue(row['snoozed_by'])

    def test_the_sla_deadline_is_not_moved_by_stepping_away(self):
        """The promise belongs to the customer. Pausing stops the reminders, not the clock."""
        _,ticket = self.a_case()
        before = self.listed(ticket)
        self.ok(self.admin,f'/api/tickets/{ticket}/snooze',{'until':self.in_hours(18),'note':''})
        after = self.listed(ticket)
        self.assertEqual(after['first_response_due_at'],before['first_response_due_at'])
        self.assertEqual(after['resolution_due_at'],before['resolution_due_at'])

    def test_a_paused_case_is_not_handed_out_as_the_next_job(self):
        _,ticket = self.a_case()
        self.ok(self.admin,f'/api/tickets/{ticket}/snooze',{'until':self.in_hours(18),'note':'รอซัพพลายเออร์'})
        following = self.ok(self.admin,'/api/tickets/next',{})
        self.assertNotEqual((following['ticket'] or {}).get('id'),ticket)

    def test_it_never_disappears_from_the_full_list(self):
        """A list that says ทุกเคส and quietly leaves some out is a list nobody can count from; the queue filters are
        the frontend's job, so the server keeps answering with everything."""
        _,ticket = self.a_case()
        self.ok(self.admin,f'/api/tickets/{ticket}/snooze',{'until':self.in_hours(18),'note':''})
        self.assertTrue(any(t['id']==ticket for t in self.ok(self.admin,'/api/tickets')['tickets']))

    def test_taking_the_pause_off_by_hand(self):
        _,ticket = self.a_case()
        self.ok(self.admin,f'/api/tickets/{ticket}/snooze',{'until':self.in_hours(18),'note':'รอสลิป'})
        self.ok(self.admin,f'/api/tickets/{ticket}/snooze',None,'DELETE')
        row = self.listed(ticket)
        self.assertIsNone(row['snoozed_until'])
        self.assertEqual(row['snooze_note'],'')
        # A case that is not paused has no pause to take off.
        self.assertEqual(self.admin.call(f'/api/tickets/{ticket}/snooze',None,'DELETE')[0],404)

    def test_the_customer_writing_is_the_thing_it_was_waiting_for(self):
        visitor,ticket = self.a_case()
        self.ok(self.admin,f'/api/tickets/{ticket}/snooze',{'until':self.in_hours(18),'note':'รอลูกค้าส่งสลิป'})
        self.ok(visitor,"/api/public/alpha/messages",{"body":"ส่งสลิปแล้วนะคะ"})
        self.assertIsNone(self.listed(ticket)['snoozed_until'])

    def test_the_worker_hands_it_back_when_its_time_comes(self):
        _,ticket = self.a_case()
        self.ok(self.admin,f'/api/tickets/{ticket}/snooze',{'until':self.in_hours(18),'note':'รอพรุ่งนี้เช้า'})
        # The moment arrives (the worker's round is what the clock would do on its own).
        with D.tenant(self.org) as db:
            db.execute('UPDATE tickets SET snoozed_until=? WHERE id=?',(iso(utc_now()-dt.timedelta(minutes=1)),ticket))
            db.commit()
            self.assertEqual(tickets.wake_due(db),1)
            self.assertEqual(tickets.wake_due(db),0)
        row = self.listed(ticket)
        self.assertIsNone(row['snoozed_until'])
        self.assertTrue(any(e['action']=='ticket.woken' for e in self.ok(self.admin,f'/api/tickets/{ticket}')['events']))

    def test_the_time_has_to_be_a_time_ahead_and_not_years_away(self):
        _,ticket = self.a_case()
        path = f'/api/tickets/{ticket}/snooze'
        self.assertEqual(self.admin.call(path,{'until':self.in_hours(-1),'note':''})[0],400)
        self.assertEqual(self.admin.call(path,{'until':iso(utc_now()+dt.timedelta(days=400)),'note':''})[0],400)
        self.assertEqual(self.admin.call(path,{'until':'พรุ่งนี้เช้า','note':''})[0],400)
        # Without a zone there is no telling which nine in the morning was meant.
        self.assertEqual(self.admin.call(path,{'until':'2026-12-01T09:00:00','note':''})[0],400)

    def test_a_finished_case_has_nothing_to_wait_for(self):
        _,ticket = self.a_case()
        self.ok(self.admin,f'/api/tickets/{ticket}',{'status':'closed'},'PATCH')
        self.assertEqual(self.admin.call(f'/api/tickets/{ticket}/snooze',{'until':self.in_hours(18),'note':''})[0],400)

    def test_another_organization_cannot_pause_this_one(self):
        _,ticket = self.a_case()
        self.second_organization()
        self.assertEqual(self.admin.call(f'/api/tickets/{ticket}/snooze',{'until':self.in_hours(18),'note':''})[0],404)


# The setUp, the sign-ins and the helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(SnoozeTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
