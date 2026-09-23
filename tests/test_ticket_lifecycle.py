"""Where a case's status moves by itself. A case is "ใหม่" until somebody starts on it, and the team's first reply is
that moment - nothing else was moving it, so cases stayed new while they were being worked on and every count of new
cases was a count of old ones. What the tests hold to is the narrowness of it: only 'new' moves, only the team's own
reply moves it, and a status a person chose is never overwritten."""
import unittest

import test_app as base


class TicketLifecycleTests(unittest.TestCase):
    def a_case(self):
        """A case opened from a customer's support-page conversation; (customer, conversation id, case id)."""
        visitor,conversation = self.visitor()
        return visitor,conversation,self.ok(self.admin,f'/api/conversations/{conversation}/ticket',{})['id']

    def status(self, ticket_id):
        return self.ok(self.admin,f'/api/tickets/{ticket_id}')['ticket']['status']

    def reply(self, conversation, text='รับเรื่องแล้วนะคะ กำลังตรวจสอบให้ค่ะ'):
        self.ok(self.admin,f'/api/conversations/{conversation}/messages',{'kind':'reply','body':text})

    def test_a_new_case_is_new_until_somebody_answers(self):
        _,_,ticket = self.a_case()
        self.assertEqual(self.status(ticket),'new')

    def test_the_first_reply_starts_the_work(self):
        _,conversation,ticket = self.a_case()
        self.reply(conversation)
        self.assertEqual(self.status(ticket),'open')

    def test_an_internal_note_is_not_an_answer(self):
        """Writing to the team is not answering the customer, and the SLA clock agrees: neither moves."""
        _,conversation,ticket = self.a_case()
        self.ok(self.admin,f'/api/conversations/{conversation}/messages',{'kind':'note','body':'ขอตรวจกับฝ่ายบัญชีก่อน'})
        self.assertEqual(self.status(ticket),'new')
        self.assertIsNone(self.ok(self.admin,f'/api/tickets/{ticket}')['ticket']['first_response_at'])

    def test_a_status_somebody_chose_is_not_overwritten_by_a_reply(self):
        _,conversation,ticket = self.a_case()
        for chosen in ('pending_customer','pending_internal','resolved','closed'):
            self.ok(self.admin,f'/api/tickets/{ticket}',{'status':chosen},'PATCH')
            self.reply(conversation,f'ข้อความเพิ่มเติม {chosen}')
            self.assertEqual(self.status(ticket),chosen)

    def test_a_case_opened_on_a_conversation_already_answered_starts_as_working(self):
        """The team replied first and opened the case afterwards: the work started before the case existed."""
        visitor,conversation = self.visitor()
        self.reply(conversation)
        ticket = self.ok(self.admin,f'/api/conversations/{conversation}/ticket',{})['id']
        self.assertEqual(self.status(ticket),'open')
        self.assertIsNotNone(self.ok(self.admin,f'/api/tickets/{ticket}')['ticket']['first_response_at'])

    def test_the_customer_sees_the_case_being_worked_on(self):
        visitor,conversation,ticket = self.a_case()
        self.reply(conversation)
        self.assertEqual(self.ok(visitor,'/api/public/alpha/session')['ticket']['status'],'open')


# The setUp, the sign-ins and the helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(TicketLifecycleTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
