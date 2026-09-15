"""The Project Drive of a signed project: both sides upload into folders, the same name becomes the next version,
downloads are attachments, who may read, upload and delete (finance and outsiders stay out, technical staff upload,
customers delete only their own files, the team any), the read-only folders made from the project's own files (slips
only with billing), and the file rules (type, real content, size, one file per request). Email is mocked."""
import base64
import io
import urllib.error
import urllib.request
import unittest
from unittest.mock import patch
import zipfile

import test_app as base
import test_contracts as contract_tests
from test_app import rate_limit
from backend.modules.customers import notify

PNG = contract_tests.PNG
PDF = contract_tests.PDF
ORG = '/api/public/alpha'


def encoded(content):
    return base64.b64encode(content).decode()


def office(part):
    """A minimal Office-style zip holding `part` (e.g. word/document.xml)."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer,'w') as archive:
        archive.writestr('[Content_Types].xml','<Types/>')
        archive.writestr(part,'<x/>')
    return encoded(buffer.getvalue())


class DriveTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    visitor = base.IntegrationTests.visitor
    customer = base.IntegrationTests.customer
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    create_member = base.IntegrationTests.create_member
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD
    draft = contract_tests.ContractTests.draft
    signed = contract_tests.ContractTests.signed
    no_email = contract_tests.ContractTests.no_email
    project = contract_tests.ContractTests.project

    # The support page counts requests per address; these tests make many from one.
    def ok(self, client, path, body=None, method=None):
        rate_limit.RATES.clear()
        return base.IntegrationTests.ok(self,client,path,body,method)

    def status(self, client, path, body=None, method=None):
        rate_limit.RATES.clear()
        return client.call(path,body,method)[0]

    def fetch(self, client, path):
        """(status, headers, bytes) of a download."""
        rate_limit.RATES.clear()
        request = urllib.request.Request(self.base+path,headers={'X-CSRF-Token':client.csrf,'X-Tenant-ID':client.tenant,
                                                                 'X-Customer-CSRF':client.customer_csrf})
        try:
            response = client.opener.open(request,timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status,response.headers,response.read()

    def join(self, owner, member, email, role):
        row = self.ok(owner,f'{ORG}/team',{'email':email,'role':role,'all_projects':True})['id']
        self.ok(member,f'{ORG}/team/{row}/accept',{})

    def put(self, client, drive, name, data, folder='', note=''):
        return self.ok(client,f'{drive}/files',{'folder_id':folder,'note':note,'files':[{'name':name,'data':data}]})

    def folder(self, view, name):
        return next(f for f in view['folders'] if f['name']==name)

    def test_both_sides_upload_versions_and_downloads(self):
        owner = self.customer(email='owner@example.com',name='เจ้าของงาน')
        owner,contract = self.signed([{'kind':'delivery','title':'ออกแบบระบบ','due_date':'','amount':''}],customer_email='owner@example.com')
        staff,mine = f'/api/contracts/{contract}/drive',f'{ORG}/contracts/{contract}/drive'
        self.assertEqual([(f['name'],f['system']) for f in self.ok(owner,mine)['folders']],
                         [('เอกสารสัญญา/TOR',True),('ไฟล์ส่งมอบงาน',True),('หลักฐานการชำระเงิน',True)])
        # The team makes a folder and uploads; the customer side is told (event 'drive', whoever has documents; the
        # channels and their defaults are customers/notify.py's).
        with patch.object(notify,'contract_event') as told:
            folder = self.ok(self.admin,f'{staff}/folders',{'name':'แบบร่าง'})['id']
            first = self.put(self.admin,staff,'spec.pdf',PDF,folder,'ฉบับแรก')
            self.assertEqual((first['version'],first['folder_id']),(1,folder))
            self.assertEqual(told.call_count,1)
            _,org,event_contract,event,subject,text,need,path = told.call_args.args
            self.assertEqual((org['slug'],event_contract['id'],event,need),('alpha',contract,'drive','documents'))
            self.assertEqual(path,f'/customer/documents/alpha/{contract}?tab=drive')
            self.assertIn('spec.pdf',text)
            # The customer uploads the same name: its next version, in the same file. The same bytes again are refused.
            second = encoded(b'%PDF-1.4\nsecond version\n%%EOF\n')
            self.assertEqual(self.put(owner,mine,'SPEC.pdf',second,folder,'แก้ตามคอมเมนต์')['id'],first['id'])
            self.assertEqual(told.call_count,1)                        # the contractor's uploads only
        self.assertEqual(self.status(owner,f'{mine}/files',{'folder_id':folder,'files':[{'name':'spec.pdf','data':second}]}),409)
        seen = self.folder(self.ok(owner,mine),'แบบร่าง')
        self.assertEqual(seen['party'],'org')
        spec = seen['files'][0]
        self.assertEqual((spec['name'],spec['version'],spec['party'],spec['uploaded_by']),('spec.pdf',2,'customer','เจ้าของงาน'))
        self.assertEqual([(v['version'],v['party'],v['note']) for v in spec['versions']],[(2,'customer','แก้ตามคอมเมนต์'),(1,'org','ฉบับแรก')])
        self.assertFalse(spec['can_delete'])                           # v1 is the team's
        # Downloads are attachments, for either side, each version its own bytes.
        status,headers,content = self.fetch(owner,f"{mine}/versions/{spec['versions'][1]['id']}")
        self.assertEqual((status,content),(200,base64.b64decode(PDF)))
        self.assertTrue(headers['Content-Disposition'].startswith('attachment;'))
        self.assertIn("filename*=UTF-8''spec.pdf",headers['Content-Disposition'])
        status,headers,content = self.fetch(self.admin,f"{staff}/versions/{spec['versions'][0]['id']}")
        self.assertEqual((status,content,headers['Content-Type']),(200,base64.b64decode(second),'application/pdf'))
        self.assertTrue(headers['Content-Disposition'].startswith('attachment;'))
        # Without a folder, a file goes to the general one (made on first use); both sides see the events.
        general = self.put(owner,mine,'notes.txt',encoded('บันทึกการประชุม'.encode()))
        self.assertEqual(self.folder(self.ok(self.admin,staff),'ไฟล์ทั่วไป')['id'],general['folder_id'])
        events = [(e['action'],e['detail']) for e in self.ok(owner,f'{ORG}/contracts/{contract}')['events'] if e['action'].startswith('drive_')]
        self.assertEqual(events,[('drive_uploaded','แบบร่าง / spec.pdf · v1'),('drive_uploaded','แบบร่าง / spec.pdf · v2'),
                                 ('drive_uploaded','ไฟล์ทั่วไป / notes.txt · v1')])

    def test_who_may_read_upload_and_delete(self):
        owner = self.customer(email='owner@example.com',name='เจ้าของงาน')
        people = {role:self.customer(email=f'{role}@example.com',name=name) for role,name in
                  (('finance','การเงิน ใจดี'),('technical','ไอที เก่งมาก'))}
        stranger = self.customer(email='stranger@example.com')
        agent,_ = self.create_member()
        manager,_ = self.create_member(role='manager',email='manager@example.com')
        waiting = self.draft(customer_email='owner@example.com')[1]
        self.ok(self.admin,f'/api/contracts/{waiting}/send',{})
        owner,contract = self.signed([{'kind':'delivery','title':'ติดตั้ง','due_date':'','amount':''}],customer_email='owner@example.com')
        for role,client in people.items():
            self.join(owner,client,f'{role}@example.com',role)
        staff,mine = f'/api/contracts/{contract}/drive',f'{ORG}/contracts/{contract}/drive'
        # Out of reach: another customer, finance (no documents), the team's agents; not before the signing.
        self.assertEqual(self.status(stranger,mine),404)
        self.assertEqual(self.status(people['finance'],mine),403)
        self.assertEqual(self.status(people['finance'],f'{mine}/files',{'files':[{'name':'slip.png','data':PNG}]}),403)
        self.assertEqual(self.status(agent,staff),403)
        self.assertEqual(self.status(owner,f'{ORG}/contracts/{waiting}/drive'),409)
        self.assertEqual(self.status(self.admin,f'/api/contracts/{waiting}/drive'),409)
        # Technical staff read, make folders and upload.
        tech = people['technical']
        self.assertTrue(self.ok(tech,mine)['can_upload'])
        folder = self.ok(tech,f'{mine}/folders',{'name':'คู่มือ'})['id']
        theirs = self.put(tech,mine,'manual.pdf',PDF,folder)['id']
        owners = self.put(owner,mine,'logo.png',PNG,folder)['id']
        teams = self.put(manager,staff,'plan.pdf',PDF,folder)['id']
        files = {f['id']:f for f in self.folder(self.ok(tech,mine),'คู่มือ')['files']}
        self.assertEqual({k:f['can_delete'] for k,f in files.items()},{theirs:True,owners:False,teams:False})
        self.assertTrue(all(f['can_delete'] for f in self.folder(self.ok(self.admin,staff),'คู่มือ')['files']))
        # A customer deletes only their own files; the team deletes any.
        self.assertEqual(self.status(tech,f'{mine}/files/{owners}',None,'DELETE'),403)
        self.assertEqual(self.status(owner,f'{mine}/files/{teams}',None,'DELETE'),403)
        self.ok(tech,f'{mine}/files/{theirs}',None,'DELETE')
        self.ok(self.admin,f'{staff}/files/{owners}',None,'DELETE')
        self.assertEqual(self.status(tech,f'{mine}/files/{theirs}',None,'DELETE'),404)
        self.assertEqual([f['id'] for f in self.folder(self.ok(owner,mine),'คู่มือ')['files']],[teams])
        with base.D.tenant(self.org) as db:
            version = db.execute('SELECT id FROM drive_versions WHERE file_id=?',(theirs,)).fetchone()[0]
            self.assertIsNotNone(db.execute('SELECT deleted_at FROM drive_files WHERE id=?',(theirs,)).fetchone()[0])
        self.assertEqual(self.fetch(tech,f'{mine}/versions/{version}')[0],404)
        self.assertIn(('drive_deleted','คู่มือ / manual.pdf'),[(e['action'],e['detail']) for e in self.ok(owner,f'{ORG}/contracts/{contract}')['events']])
        # Folders: only empty ones; a customer only their own.
        self.assertEqual(self.status(self.admin,f'{staff}/folders/{folder}',None,'DELETE'),409)
        self.ok(manager,f'{staff}/files/{teams}',None,'DELETE')
        other = self.ok(manager,f'{staff}/folders',{'name':'ของทีม'})['id']
        self.assertEqual(self.status(tech,f'{mine}/folders/{other}',None,'DELETE'),403)
        self.assertEqual(self.status(owner,f'{mine}/folders/{folder}',None,'DELETE'),403)
        self.assertTrue(self.folder(self.ok(tech,mine),'คู่มือ')['can_delete'])
        self.ok(tech,f'{mine}/folders/{folder}',None,'DELETE')
        self.ok(self.admin,f'{staff}/folders/{other}',None,'DELETE')
        self.assertEqual([f['name'] for f in self.ok(owner,mine)['folders'] if not f['system']],[])
        # Removed from the team: the drive closes at once.
        row = self.ok(owner,f'{ORG}/team')['mine']['members'][1]['id']
        self.ok(owner,f'{ORG}/team/{row}',None,'DELETE')
        self.assertEqual(self.status(tech,mine),404)

    def test_read_only_folders_from_the_project(self):
        owner = self.customer(email='owner@example.com',name='เจ้าของงาน')
        tech = self.customer(email='technical@example.com',name='ไอที เก่งมาก')
        owner,contract = self.draft(customer_email='owner@example.com')
        self.ok(self.admin,f'/api/contracts/{contract}/files',{'files':[{'name':'tor.pdf','data':PDF}]})
        self.ok(self.admin,f'/api/contracts/{contract}',{'title':'ระบบห้องสมุด','body':'ขอบเขตงาน','warranty_days':30,'support_terms':'',
                                                         'milestones':[{'kind':'delivery','title':'ออกแบบระบบ','due_date':'','amount':'10000'}]},'PATCH')
        self.ok(self.admin,f'/api/contracts/{contract}/send',{})
        self.no_email()
        self.ok(owner,f'{ORG}/contracts/{contract}/sign',{'agree':True,'name':'สมชาย','method':'type','mark':'สมชาย','password':self.CUSTOMER_PASSWORD})
        self.ok(self.admin,f'/api/contracts/{contract}/sign',{'agree':True,'name':'เจ้าของ','method':'type','mark':'เจ้าของ',
                                                              'password':contract_tests.STAFF_PASSWORD})
        self.join(owner,tech,'technical@example.com','technical')
        design = self.project(owner,contract)['milestones'][0]
        self.ok(self.admin,f'/api/contracts/{contract}/milestones/{design["id"]}/deliver',{'note':'แบบหน้าจอ','files':[{'name':'design.pdf','data':PDF}]})
        invoice = self.ok(owner,f'{ORG}/contracts/{contract}/milestones/{design["id"]}/accept',{})['invoice_id']
        self.ok(owner,f'{ORG}/contracts/{contract}/invoices/{invoice}/slip',{'files':[{'name':'slip.png','data':PNG}]})
        mine = self.ok(owner,f'{ORG}/contracts/{contract}/drive')
        documents,delivered,slips = [self.folder(mine,n)['files'] for n in ('เอกสารสัญญา/TOR','ไฟล์ส่งมอบงาน','หลักฐานการชำระเงิน')]
        self.assertEqual([(f['name'],f['group'],f['versions'],f['can_delete']) for f in documents],[('tor.pdf','เวอร์ชัน 1.0',[],False)])
        self.assertEqual([(f['name'],f['group'],f['party']) for f in delivered],[('design.pdf','งวดที่ 1 · ออกแบบระบบ · รอบที่ 1','org')])
        self.assertEqual([(f['name'],f['party']) for f in slips],[('slip.png','customer')])
        self.assertTrue(slips[0]['group'].startswith('INV-'))
        for f in documents+delivered+slips:
            self.assertTrue(f['download'].startswith(f'{ORG}/contracts/{contract}/files/'))
            status,headers,_ = self.fetch(owner,f['download'])
            self.assertEqual(status,200)
            self.assertTrue(headers['Content-Disposition'].startswith('attachment;'))
        # Without billing, no payment slips; the team sees them, through its own file route.
        seen = self.ok(tech,f'{ORG}/contracts/{contract}/drive')
        self.assertEqual([f['name'] for f in seen['folders']],['เอกสารสัญญา/TOR','ไฟล์ส่งมอบงาน'])
        team = self.folder(self.ok(self.admin,f'/api/contracts/{contract}/drive'),'หลักฐานการชำระเงิน')['files']
        self.assertEqual([f['name'] for f in team],['slip.png'])
        self.assertEqual(self.fetch(self.admin,team[0]['download'])[0],200)
        self.assertTrue(team[0]['download'].startswith(f'/api/contracts/{contract}/files/'))
        # The read-only folders take no uploads.
        self.assertEqual(self.status(owner,f'{ORG}/contracts/{contract}/drive/files',{'folder_id':'delivery','files':[{'name':'a.pdf','data':PDF}]}),404)

    def test_file_rules(self):
        self.customer(email='owner@example.com',name='เจ้าของงาน')
        owner,contract = self.signed([{'kind':'payment','title':'งวดเดียว','due_date':'','amount':''}],customer_email='owner@example.com')
        mine = f'{ORG}/contracts/{contract}/drive'
        send = lambda name,data,**extra:self.status(owner,f'{mine}/files',{'files':[{'name':name,'data':data}],**extra})
        # Types, and the real content behind the name.
        self.assertEqual(send('setup.exe',encoded(b'MZ\x90\x00')),400)
        self.assertEqual(send('invoice.pdf',encoded(b'MZ\x90\x00 not a pdf')),400)
        self.assertEqual(send('report.docx',encoded(b'PK\x03\x04 broken')),400)
        self.assertEqual(send('report.docx',office('xl/workbook.xml')),400)     # a spreadsheet named as a document
        self.assertEqual(send('table.csv',encoded(b'a,b\x00c')),400)
        for name,data in (('report.docx',office('word/document.xml')),('budget.xlsx',office('xl/workbook.xml')),
                          ('slides.pptx',office('ppt/presentation.xml')),('source.zip',office('src/main.py')),
                          ('table.csv',encoded('ชื่อ,จำนวน\nหนังสือ,3\n'.encode())),('README.md',encoded(b'# Hello\n')),
                          ('photo.webp',encoded(b'RIFF\x10\x00\x00\x00WEBPVP8 ')),('scan.jpg',encoded(b'\xff\xd8\xff\xe0 jpeg')),
                          ('logo.png',PNG),('spec.pdf',PDF)):
            self.assertEqual(send(name,data),201,name)
        # One file per request, at most 5 MB.
        self.assertEqual(self.status(owner,f'{mine}/files',{'files':[{'name':'a.pdf','data':PDF},{'name':'b.pdf','data':PDF}]}),400)
        self.assertEqual(self.status(owner,f'{mine}/files',{'files':[]}),400)
        self.assertEqual(send('big.txt',encoded(b'a'*(5*1024*1024+1))),400)
        self.assertEqual(send('limit.txt',encoded(b'a'*(5*1024*1024))),201)
        self.assertEqual(send('a.pdf',PDF,folder_id='nope'),404)
        # Folder names: not a system folder's, no slashes, once per project.
        self.assertEqual(self.status(owner,f'{mine}/folders',{'name':'ไฟล์ส่งมอบงาน'}),400)
        self.assertEqual(self.status(owner,f'{mine}/folders',{'name':'a/b'}),400)
        self.assertEqual(self.status(owner,f'{mine}/folders',{'name':''}),400)
        self.ok(owner,f'{mine}/folders',{'name':'รายงาน'})
        self.assertEqual(self.status(self.admin,f'/api/contracts/{contract}/drive/folders',{'name':'รายงาน'}),409)
        with base.D.tenant(self.org) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM drive_versions').fetchone()[0],11)


if __name__=='__main__':
    unittest.main()
