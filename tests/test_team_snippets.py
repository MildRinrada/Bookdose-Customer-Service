"""คำตอบสำเร็จรูปของทีม: the organization's own prepared replies, and the line between them and a Macro.

A snippet is text the team puts into a draft and reads over before sending; a Macro is the one that sends and moves
the case on. The organization used to have a single 'canned_reply' setting, which becomes the first snippet of an
organization upgraded to this version (backend/database/schema.py -> upgrade_tenant)."""
import unittest

import test_app as base


class TeamSnippetTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    create_member = base.IntegrationTests.create_member

    def snippets(self, client=None):
        return self.ok(client or self.admin,'/api/workspace')['snippets']

    def test_the_old_single_canned_reply_became_the_first_snippet(self):
        found = self.snippets()
        self.assertEqual(len(found),1)
        self.assertEqual(found[0]['shortcut'],'ทักทาย')
        self.assertIn('ขอบคุณที่ติดต่อเข้ามา',found[0]['text'])
        # The setting is emptied, which is what keeps the move from happening again on the next start.
        self.assertEqual(self.ok(self.admin,'/api/workspace')['settings']['canned_reply'],'')

    def test_an_owner_keeps_the_whole_list_and_its_order(self):
        body = {'snippets':[{'shortcut':'/ขอบคุณ','text':'ขอบคุณค่ะ'},{'shortcut':'refund','text':'ขั้นตอนคืนเงิน'}]}
        self.ok(self.admin,'/api/settings/snippets',body)
        found = self.snippets()
        self.assertEqual([s['shortcut'] for s in found],['ขอบคุณ','refund'])
        # Saving again with the ids keeps them, so a rename is not a new row for anyone reading by id.
        again = [{'id':found[1]['id'],'shortcut':'refund','text':'ขั้นตอนคืนเงินใหม่'},found[0]]
        self.ok(self.admin,'/api/settings/snippets',{'snippets':again})
        found = self.snippets()
        self.assertEqual([s['shortcut'] for s in found],['refund','ขอบคุณ'])
        self.assertEqual(found[0]['id'],again[0]['id'])
        self.assertEqual(found[0]['text'],'ขั้นตอนคืนเงินใหม่')

    def test_what_is_refused(self):
        for body in ({'snippets':[{'shortcut':'','text':'a'}]},
                     {'snippets':[{'shortcut':'มี ช่องว่าง','text':'a'}]},
                     {'snippets':[{'shortcut':'ok','text':'   '}]},
                     {'snippets':[{'shortcut':'ok','text':'a'},{'shortcut':'/ok','text':'b'}]},
                     {'snippets':'ไม่ใช่รายการ'}):
            self.assertEqual(self.admin.call('/api/settings/snippets',body)[0],400,body)

    def test_an_agent_may_read_the_list_but_not_change_it(self):
        agent,_ = self.create_member()
        self.assertEqual(len(self.snippets(agent)),1)
        self.assertEqual(agent.call('/api/settings/snippets',{'snippets':[]})[0],403)

    def test_a_macro_must_do_more_than_send_a_text(self):
        """Otherwise it is a snippet that skips the read-through, which is the overlap this split removes."""
        self.assertEqual(self.admin.call('/api/automation/macros',{'name':'ทักทาย','reply':'สวัสดีค่ะ'})[0],400)
        self.ok(self.admin,'/api/automation/macros',{'name':'ขอข้อมูล','reply':'ขอข้อมูลเพิ่มค่ะ','set_status':'pending_customer'})
        self.ok(self.admin,'/api/automation/macros',{'name':'ตามผล','reply':'','followup_hours':24})


if __name__ == '__main__':
    unittest.main()
