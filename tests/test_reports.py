"""The service report's parts beyond the case list (backend/modules/reports): each case's reopenings, the period's busy
hours, and for leads the chatbot, the articles used and the questions no article answers."""
import unittest

import test_app as base
from backend.utils.dates import today

EXTRAS = '/api/reports/extras'


class ReportTests(unittest.TestCase):
    locals().update({name:value for name,value in vars(base.IntegrationTests).items() if not name.startswith(('test','__'))})

    def case_row(self, ticket):
        return next(t for t in self.ok(self.admin,'/api/tickets')['tickets'] if t['id']==ticket)

    def test_reopenings_are_counted(self):
        visitor,conv = self.visitor()
        ticket = self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']
        self.assertEqual((self.case_row(ticket)['reopens'],self.case_row(ticket)['reopened_at']),(0,None))
        # Waiting for the customer is not finished: their answer is no reopening.
        self.ok(self.admin,f'/api/tickets/{ticket}',{'status':'pending_customer'},'PATCH')
        self.ok(visitor,'/api/public/alpha/messages',{'body':'ตอบกลับแล้วค่ะ'})
        self.assertEqual(self.case_row(ticket)['reopens'],0)
        # The customer writes after it was solved; staff open it again after it was closed.
        self.ok(self.admin,f'/api/tickets/{ticket}',{'status':'resolved'},'PATCH')
        self.ok(visitor,'/api/public/alpha/messages',{'body':'ยังเข้าไม่ได้เหมือนเดิม'})
        self.ok(self.admin,f'/api/tickets/{ticket}',{'status':'closed'},'PATCH')
        self.ok(self.admin,f'/api/tickets/{ticket}',{'status':'closed','priority':'high'},'PATCH')
        self.ok(self.admin,f'/api/tickets/{ticket}',{'status':'open'},'PATCH')
        row = self.case_row(ticket)
        self.assertEqual(row['reopens'],2);self.assertTrue(row['reopened_at'])

    def test_extras_by_role(self):
        day = today()
        query = f'{EXTRAS}?from={day}&to={day}&tz=0'
        before = self.ok(self.admin,query)['hours']['total']
        self.visitor()
        article = self.ok(self.admin,'/api/articles',{'title':'ลืมรหัสผ่าน','category':'บัญชี','body':'กดลืมรหัสผ่าน'})['id']
        self.ok(self.admin,f'/api/articles/{article}/use',{'kind':'copy'})
        self.ok(self.admin,f'/api/articles/{article}/vote',{'vote':-1})
        owner = self.ok(self.admin,query)
        self.assertEqual(owner['hours']['total'],before+1)
        self.assertEqual(len(owner['hours']['counts']),7);self.assertEqual(len(owner['hours']['counts'][0]),24)
        self.assertEqual((owner['articles']['uses'],owner['articles']['top'][0]['id'],owner['articles']['top'][0]['copied']),(1,article,1))
        self.assertEqual(owner['articles']['unhelpful'][0]['id'],article)
        self.assertEqual(owner['bot']['conversations'],0);self.assertIn('days',owner['bot'])
        self.assertIn('groups',owner['gaps'])
        # A day before anything happened is empty.
        empty = self.ok(self.admin,f'{EXTRAS}?from=2020-01-01&to=2020-01-02&tz=-420')
        self.assertEqual((empty['hours']['total'],empty['articles']['uses']),(0,0))
        # Agents see only their team's busy hours.
        agent,_ = self.create_member(email='helper@example.com')
        mine = self.ok(agent,query)
        self.assertEqual((mine['bot'],mine['articles'],mine['gaps']),(None,None,None))
        other = self.ok(self.admin,'/api/teams',{'name':'ทีมอื่น'})['id']
        self.assertEqual(self.ok(self.admin,f'{query}&team={other}')['hours']['total'],0)
        own = self.ok(self.admin,f'{query}&team={self.team}')['hours']['total']
        self.assertGreater(own,0)
        self.assertEqual(self.ok(agent,f'{query}&team={other}')['hours']['total'],own)   # an agent stays on their own team
        # What may be asked.
        for bad in ('',f'?from={day}',f'?from=2026-02-30&to=2026-03-01',f'?from={day}&to=2020-01-01',
                    '?from=2024-01-01&to=2025-06-01','?from=x&to=y'):
            self.assertEqual(self.admin.call(EXTRAS+bad)[0],400,bad)


if __name__=='__main__':
    unittest.main()
