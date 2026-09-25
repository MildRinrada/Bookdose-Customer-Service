"""เครื่องมือ PDPA: a person found in every organization by email or phone, their data given as a file (without the
team's internal notes), and erased - the account gone, the records left with nothing that says who it was, the
files deleted - with who did it, when and why kept, and never the email itself."""
import base64
import io
import json
import unittest
import zipfile

import test_app as base
from test_app import Client, D
from backend.modules.pdpa import service as pdpa

PDPA = '/api/platform/pdpa'
EMAIL = 'somsri.pdpa@example.com'


class PhoneTests(unittest.TestCase):
    def test_a_phone_written_any_way(self):
        for written in ('081-234-5678','+66 81 234 5678','66812345678','(081) 234 5678'):
            self.assertEqual(pdpa.phone_digits(written),'0812345678',written)


class PdpaTests(unittest.TestCase):
    def setup_person(self):
        """Somsri: an account in องค์กร A with a conversation, a file and an internal note about her; and a record
        typed in by the team of องค์กร B with the same email and her phone written another way."""
        client,conv = self.visitor('alpha',EMAIL,'ของไม่ครบ','สั่งหนังสือแล้วได้ไม่ครบค่ะ')
        self.ok(client,'/api/public/alpha/messages',{'body':'แนบใบเสร็จค่ะ','attachments':[{'name':'receipt.txt','data':base64.b64encode(b'RECEIPT 123').decode()}]})
        self.ok(self.admin,f'/api/conversations/{conv}/messages',{'kind':'note','body':'NOTE ABOUT SOMSRI'})
        self.ok(self.admin,f'/api/conversations/{conv}/messages',{'kind':'reply','body':'ขออภัยค่ะ จะส่งเพิ่มให้'})
        self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})
        beta = self.ok(self.owner,'/api/platform/tenants',{'name':'องค์กร B','slug':'beta','email':'orgadmin@example.com'})['id']
        with D.tenant(beta) as db:
            db.execute("INSERT INTO contacts VALUES('b'||hex(randomblob(15)),'สมศรี','SOMSRI.PDPA@example.com','+66 81 234 5678','','','x','2026-01-01T00:00:00+00:00')")
            db.commit()
        return client,conv,beta

    def find(self, query):
        return self.ok(self.owner,PDPA+'/search',{'query':query})

    def test_found_exported_erased_and_logged(self):
        client,conv,beta = self.setup_person()
        found = self.find(EMAIL.upper())
        self.assertEqual(found['kind'],'email')
        self.assertEqual([a['email'] for a in found['accounts']],[EMAIL])
        self.assertEqual(sorted(r['tenant_slug'] for r in found['records']),['alpha','beta'])
        alpha = next(r for r in found['records'] if r['tenant_slug']=='alpha')
        self.assertEqual((alpha['conversations'],alpha['cases'],alpha['files']),(1,1,1))
        self.assertNotIn('messages_text',json.dumps(found))
        # By phone, written another way, the record of B turns up too.
        self.assertIn('beta',[r['tenant_slug'] for r in self.find('0812345678')['records']])
        choice = {'query':EMAIL,'accounts':[found['accounts'][0]['id']],'records':[{'tenant_id':beta,'contact_id':next(r['contact_id'] for r in found['records'] if r['tenant_slug']=='beta')}]}

        # The file of everything, without the team's internal note.
        self.assertEqual(self.owner.call(PDPA+'/export',choice)[0],400)          # a reason is required
        status,raw = self.owner.call(PDPA+'/export',{**choice,'reason':'คำขอทางอีเมล 25 ก.ย.'})
        self.assertEqual(status,200)
        archive = zipfile.ZipFile(io.BytesIO(raw))
        data = json.loads(archive.read('data.json'))
        text = json.dumps(data,ensure_ascii=False)
        self.assertEqual(data['accounts'][0]['email'],EMAIL)
        self.assertNotIn('password',data['accounts'][0])
        self.assertIn('สั่งหนังสือแล้วได้ไม่ครบค่ะ',text)
        self.assertIn('ขออภัยค่ะ จะส่งเพิ่มให้',text)
        self.assertNotIn('NOTE ABOUT SOMSRI',text)
        file = next(n for n in archive.namelist() if n.endswith('receipt.txt'))
        self.assertEqual(archive.read(file),b'RECEIPT 123')
        self.assertEqual(sorted(o['organization'] for o in data['organizations']),['องค์กร A','องค์กร B'])

        # Erasing asks for the word and a reason.
        self.assertEqual(self.owner.call(PDPA+'/erase',{**choice,'reason':'ลูกค้าขอลบข้อมูล'})[0],400)
        with D.tenant(self.org) as db:
            stored = db.execute("SELECT a.storage_key FROM attachments a JOIN messages m ON m.id=a.message_id WHERE m.conversation_id=?",(conv,)).fetchone()[0]
        self.assertTrue((D.DATA/'files'/self.org/stored).is_file())
        done = self.ok(self.owner,PDPA+'/erase',{**choice,'reason':'ลูกค้าขอลบข้อมูล','confirm':'ลบถาวร'})
        self.assertEqual((done['accounts'],done['files']),(1,1))
        # The account is gone: its session no longer works, and it cannot sign in again.
        self.assertIn(client.call('/api/public/alpha/session')[0],(401,403,404))
        with D.control() as cd:
            self.assertEqual(cd.execute('SELECT COUNT(*) FROM customer_accounts WHERE email=?',(EMAIL,)).fetchone()[0],0)
        # The records stay, empty of who it was; the file is deleted.
        with D.tenant(self.org) as db:
            contact = db.execute('SELECT c.name,c.email FROM contacts c JOIN conversations v ON v.contact_id=c.id WHERE v.id=?',(conv,)).fetchone()
            bodies = [r[0] for r in db.execute('SELECT body FROM messages WHERE conversation_id=?',(conv,))]
            subject = db.execute('SELECT subject FROM conversations WHERE id=?',(conv,)).fetchone()[0]
            cases = db.execute('SELECT COUNT(*) FROM tickets').fetchone()[0]
        self.assertEqual(tuple(contact),(pdpa.ERASED_NAME,''))
        self.assertEqual(set(bodies),{''})
        self.assertEqual(subject,pdpa.ERASED_TEXT)
        self.assertGreaterEqual(cases,1)
        self.assertFalse((D.DATA/'files'/self.org/stored).exists())
        with D.tenant(beta) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM contacts WHERE email LIKE '%pdpa%'").fetchone()[0],0)
        self.assertEqual(self.find(EMAIL)['accounts'],[])
        # Who, when and why, here and in each organization's history; never the email itself.
        history = self.ok(self.owner,PDPA)['history']
        self.assertEqual([h['kind'] for h in history],['erase','export'])
        self.assertEqual((history[0]['subject'],history[0]['reason'],history[0]['by_name']),('so***@example.com','ลูกค้าขอลบข้อมูล','เจ้าของระบบ'))
        self.assertNotIn(EMAIL,json.dumps(history))
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM audit_logs WHERE action='pdpa.erased'").fetchone()[0],1)
        # Organizations' admins do not have it.
        self.assertEqual(self.admin.call(PDPA)[0],403)

    def test_deletion_requests_noted_by_organizations_are_listed(self):
        _,conv = self.visitor('alpha','asked@example.com','ขอลบ','ขอลบข้อมูลของฉันด้วยค่ะ')
        with D.tenant(self.org) as db:
            contact = db.execute('SELECT contact_id FROM conversations WHERE id=?',(conv,)).fetchone()[0]
            db.execute("INSERT INTO contact_profiles(contact_id,deletion_requested_at,deletion_requested_by,updated_at) VALUES(?,?,?,?)",
                       (contact,'2026-09-01T00:00:00+00:00','ผู้ดูแลองค์กร A','2026-09-01T00:00:00+00:00'))
            db.commit()
        requested = self.ok(self.owner,PDPA)['requested']
        self.assertEqual([(r['email'],r['tenant_name']) for r in requested],[('asked@example.com','องค์กร A')])


# The setUp, the sign-ins and the helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(PdpaTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
