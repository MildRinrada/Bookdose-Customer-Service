"""ชุดข้อมูลสำหรับวิเคราะห์ (reports/dataset.py): the report's period as tidy CSV tables in one ZIP, joined by ids, with
a data dictionary - and nothing that says who a customer is or what anyone wrote."""
import csv
import datetime as dt
import io
import unittest
import zipfile

import test_guest_chat as guest_tests

GUEST = guest_tests.GUEST


class ReportDatasetTests(unittest.TestCase):
    def download(self, client, first, last):
        return client.call(f'/api/reports/dataset?from={first}&to={last}&tz=-420')

    def test_the_period_as_tables_without_who_or_what(self):
        conv = self.started(self.browser(),body='เบอร์ของฉัน 081-234-5678 อีเมล somchai@example.com',name='สมชาย ใจดี')
        case = self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']
        self.reply(conv,'รับเรื่องแล้วค่ะ')
        self.ok(self.admin,f'/api/tickets/{case}',{'status':'resolved'},'PATCH')
        today = dt.date.today()
        first,last = (today-dt.timedelta(days=2)).isoformat(),(today+dt.timedelta(days=1)).isoformat()
        agent,_ = self.create_member()
        self.assertEqual(self.download(agent,first,last)[0],403)
        self.assertEqual(self.download(self.admin,'2026-01-31','2026-01-01')[0],400)
        status,data = self.download(self.admin,first,last)
        self.assertEqual(status,200)
        archive = zipfile.ZipFile(io.BytesIO(data))
        names = set(archive.namelist())
        self.assertTrue({'tickets.csv','conversations.csv','messages.csv','csat.csv','reopens.csv','escalations.csv',
                         'teams.csv','members.csv','data_dictionary.csv','README.txt'}<=names)
        table = lambda name: list(csv.DictReader(io.StringIO(archive.read(name).decode('utf-8-sig'))))
        ticket = next(t for t in table('tickets.csv') if t['ticket_id']==case)
        self.assertEqual((ticket['status'],ticket['channel'],ticket['first_response_met']),('resolved','web','1'))
        self.assertTrue(float(ticket['first_response_minutes'])>=0)
        messages = [m for m in table('messages.csv') if m['conversation_id']==conv]
        self.assertEqual({m['author_type'] for m in messages}>={'customer','staff'},True)
        self.assertTrue(all(m['length'].isdigit() for m in messages))
        # Nobody's name, number, address or words.
        everything = b''.join(archive.read(n) for n in names if n.endswith('.csv') and n!='members.csv').decode('utf-8-sig')
        for secret in ('สมชาย','081-234-5678','somchai@example.com','รับเรื่องแล้วค่ะ'):
            self.assertNotIn(secret,everything)
        # Every column is explained.
        explained = {(r['file'],r['column']) for r in table('data_dictionary.csv')}
        for name in ('tickets.csv','messages.csv','conversations.csv'):
            for column in archive.read(name).decode('utf-8-sig').splitlines()[0].split(','):
                self.assertIn((name,column),explained)
        # Recorded.
        self.assertTrue(any(e['action']=='reports.dataset_exported' for e in self.ok(self.admin,'/api/audit')['events']))


for _name, _member in vars(guest_tests.GuestChatTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(ReportDatasetTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
