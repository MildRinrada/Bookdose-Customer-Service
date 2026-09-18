"""The overview's board (backend/modules/board): handover notes every member of the organization reads, and each
member's own to-dos that nobody else sees."""
import datetime as dt
import unittest

import test_app as base

BOARD = '/api/board'


class BoardTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    create_member = base.IntegrationTests.create_member

    def test_handover_is_shared_and_todos_are_private(self):
        agent,_ = self.create_member()
        board = self.ok(agent,BOARD,{'kind':'handover','body':'  กะเช้าเคลียร์แชท Facebook แล้ว\nเหลือเคสเว็บฝากกะบ่าย  '})
        self.assertEqual(board['handover'][0]['body'],'กะเช้าเคลียร์แชท Facebook แล้ว\nเหลือเคสเว็บฝากกะบ่าย')
        self.assertTrue(board['handover'][0]['mine'])
        note = board['handover'][0]['id']
        seen = self.ok(self.admin,BOARD)
        self.assertEqual([n['id'] for n in seen['handover']],[note])
        self.assertFalse(seen['handover'][0]['mine']);self.assertTrue(seen['handover'][0]['removable'])
        # A to-do with a time comes before one without; nobody else sees either.
        due = (dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=2)).isoformat()
        self.ok(agent,BOARD,{'kind':'todo','body':'เขียนสรุปประจำวัน'})
        todos = self.ok(agent,BOARD,{'kind':'todo','body':'โทรตามลูกค้าเคส BD-1002','due_at':due})['todos']
        self.assertEqual([t['body'] for t in todos],['โทรตามลูกค้าเคส BD-1002','เขียนสรุปประจำวัน'])
        self.assertEqual(self.ok(self.admin,BOARD)['todos'],[])
        # Ticking one moves it after the open ones; someone else can neither tick nor remove it.
        first = todos[0]['id']
        todos = self.ok(agent,f'{BOARD}/{first}',{'done':True},'PATCH')['todos']
        self.assertEqual([t['id'] for t in todos][-1],first);self.assertTrue(todos[-1]['done_at'])
        self.assertEqual(self.admin.call(f'{BOARD}/{first}',{'done':False},'PATCH')[0],404)
        self.assertEqual(self.admin.call(f'{BOARD}/{first}',None,'DELETE')[0],404)
        self.assertEqual(len(self.ok(agent,f'{BOARD}/{first}',None,'DELETE')['todos']),1)
        # An agent removes only their own handover note; the owner may tidy any.
        other = self.ok(self.admin,BOARD,{'kind':'handover','body':'ประชุมทีม 16:00'})['handover'][0]['id']
        self.assertEqual(agent.call(f'{BOARD}/{other}',None,'DELETE')[0],403)
        self.assertEqual([n['id'] for n in self.ok(self.admin,f'{BOARD}/{note}',None,'DELETE')['handover']],[other])

    def test_what_may_be_written(self):
        for body in ({'kind':'poster','body':'x'},{'kind':'todo','body':'   '},{'kind':'todo','body':'x'*501},
                     {'kind':'todo','body':'x','due_at':'พรุ่งนี้'},{'kind':'todo','body':'x','due_at':'2026-01-01T10:00:00'},
                     {'kind':'todo','body':'x','due_at':'2099-01-01T10:00:00+07:00'},{'kind':'todo','body':'a\x00b'}):
            self.assertEqual(self.admin.call(BOARD,body)[0],400,body)
        self.assertEqual(self.admin.call(f'{BOARD}/{"0"*32}',{'done':'yes'},'PATCH')[0],400)
        self.assertEqual(base.Client(self.base).call(BOARD)[0],401)


if __name__=='__main__':
    unittest.main()
