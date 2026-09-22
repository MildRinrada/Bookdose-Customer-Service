"""Correcting or taking back a message sent to the wrong place. A thread is what the team and the customer both rely
on, so nothing changes quietly: an edited message says so, and a deleted one leaves a marker for the team."""
import unittest

import test_app as base


class MessageEditTests(unittest.TestCase):
    def open_thread(self):
        visitor,conversation = self.visitor()
        mid = self.ok(self.admin,f'/api/conversations/{conversation}/messages',
                      {'kind':'reply','body':'สวัสดีครับ ส่งผิดห้อง'})['id']
        return visitor,conversation,mid

    def messages(self, conversation, who=None):
        return self.ok(who or self.admin,f'/api/conversations/{conversation}')['messages']

    def test_the_writer_corrects_their_own_and_it_says_so(self):
        _,conversation,mid = self.open_thread()
        before = next(m for m in self.messages(conversation) if m['id']==mid)
        self.assertIsNone(before['edited_at'])
        self.ok(self.admin,f'/api/conversations/{conversation}/messages/{mid}',{'body':'ขออภัยครับ พิมพ์ผิดห้อง'},'PATCH')
        after = next(m for m in self.messages(conversation) if m['id']==mid)
        self.assertIn('ขออภัยครับ',after['body'])
        self.assertTrue(after['edited_at'])

    def test_deleting_takes_it_from_the_customer_and_leaves_the_team_a_marker(self):
        visitor,conversation,mid = self.open_thread()
        self.assertTrue(any(m['id']==mid for m in self.ok(visitor,'/api/public/alpha/session?conversation='+conversation)['messages']))
        self.ok(self.admin,f'/api/conversations/{conversation}/messages/{mid}',None,'DELETE')
        # Gone from what the customer can read...
        self.assertFalse(any(m['id']==mid for m in self.ok(visitor,'/api/public/alpha/session?conversation='+conversation)['messages']))
        # ...and the team sees that something was taken back, and by whom.
        marker = next(m for m in self.messages(conversation) if m['id']==mid)
        self.assertEqual(marker['body'],'')
        self.assertTrue(marker['deleted_at'])
        self.assertTrue(marker['deleted_by'])

    def test_a_customers_own_words_are_never_touched(self):
        _,conversation,_ = self.open_thread()
        customer_message = next(m for m in self.messages(conversation) if m['kind']=='customer')
        self.assertEqual(self.admin.call(f"/api/conversations/{conversation}/messages/{customer_message['id']}",
                                         {'body':'เปลี่ยนคำพูดลูกค้า'},'PATCH')[0],400)
        self.assertEqual(self.admin.call(f"/api/conversations/{conversation}/messages/{customer_message['id']}",None,'DELETE')[0],400)

    def test_only_the_writer_edits_and_an_owner_may_also_delete(self):
        _,conversation,mid = self.open_thread()
        agent,_ = self.create_member(team=self.work['team_id'])
        self.assertEqual(agent.call(f'/api/conversations/{conversation}/messages/{mid}',{'body':'ของคนอื่น'},'PATCH')[0],403)
        self.assertEqual(agent.call(f'/api/conversations/{conversation}/messages/{mid}',None,'DELETE')[0],403)
        # The owner wrote this one, so both work for them.
        self.ok(self.admin,f'/api/conversations/{conversation}/messages/{mid}',None,'DELETE')

    def test_a_message_is_taken_back_only_once(self):
        _,conversation,mid = self.open_thread()
        self.ok(self.admin,f'/api/conversations/{conversation}/messages/{mid}',None,'DELETE')
        self.assertEqual(self.admin.call(f'/api/conversations/{conversation}/messages/{mid}',None,'DELETE')[0],409)
        self.assertEqual(self.admin.call(f'/api/conversations/{conversation}/messages/{mid}',{'body':'x'},'PATCH')[0],409)

    def test_refused_edits(self):
        _,conversation,mid = self.open_thread()
        self.assertEqual(self.admin.call(f'/api/conversations/{conversation}/messages/{mid}',{'body':''},'PATCH')[0],400)
        # The same words again is not a correction.
        self.assertEqual(self.admin.call(f'/api/conversations/{conversation}/messages/{mid}',
                                         {'body':'สวัสดีครับ ส่งผิดห้อง'},'PATCH')[0],400)
        # A message of another conversation is not found here.
        _,other,_ = self.open_thread()
        self.assertEqual(self.admin.call(f'/api/conversations/{other}/messages/{mid}',{'body':'x'},'PATCH')[0],404)


# The setUp, the sign-ins and the helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(MessageEditTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
