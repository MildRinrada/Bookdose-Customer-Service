"""Contracts / TOR between an organization and its customer: templates, drafts, versions after a change request, the
chat linked to a document, signing with a one-time code (or the password without email), the countersignature, the
sealing hash and its check by the platform, milestones and payment proofs, importing documents, and who may see what.
Email is mocked; nothing leaves the machine."""
import base64
import io
import re
import unittest
import zipfile

import test_app as base
from test_app import Client, D

PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
PDF = base64.b64encode(b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n').decode()
STAFF_PASSWORD = 'Test-password-123!'


def docx(paragraphs):
    """A minimal Word file: [(style, text, bold)]."""
    ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    body = ''
    for style,text,bold in paragraphs:
        props = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ''
        run = f'<w:r>{"<w:rPr><w:b/></w:rPr>" if bold else ""}<w:t>{text}</w:t></w:r>'
        body += f'<w:p>{props}{run}</w:p>'
    xml = f'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="{ns}"><w:body>{body}</w:body></w:document>'
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer,'w') as archive:
        archive.writestr('word/document.xml',xml)
    return base64.b64encode(buffer.getvalue()).decode()


class ContractTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    visitor = base.IntegrationTests.visitor
    customer = base.IntegrationTests.customer
    create_member = base.IntegrationTests.create_member
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD

    def draft(self, customer_email='visitor@example.com', kind='tor'):
        """A customer connected with the organization and a draft made from the platform's standard template."""
        client,_ = self.visitor(email=customer_email)
        account = next(c for c in self.ok(self.admin,'/api/contract-customers')['customers'] if c['email']==customer_email)
        template = next(t for t in self.ok(self.admin,'/api/contract-templates')['platform'] if t['kind']==kind)
        contract = self.ok(self.admin,'/api/contracts',{'kind':kind,'title':'ระบบห้องสมุดดิจิทัล','account_id':account['id'],
                                                         'template_scope':'platform','template_id':template['id']})['id']
        return client,contract

    def sign_mark(self, method='type'):
        return 'สมชาย ใจดี' if method=='type' else 'data:image/png;base64,'+PNG

    def test_draft_to_sealed_contract_with_a_change_request(self):
        customer,contract = self.draft()
        agent,_ = self.create_member()
        self.assertEqual(agent.call('/api/contracts')[0],403)
        detail = self.ok(self.admin,f'/api/contracts/{contract}')
        self.assertEqual((detail['contract']['status'],detail['document']['version'],detail['document']['editable']),('draft','1.0',True))
        self.assertIn('ลูกค้าทดสอบ',detail['document']['body'])          # the template's {customer_name}
        self.assertIn(detail['contract']['reference'],detail['document']['body'])
        # Not sent yet: the customer does not see it.
        self.assertEqual(customer.call(f'/api/public/alpha/contracts/{contract}')[0],404)
        milestones = [{'kind':'delivery','title':'ส่งมอบระบบ','due_date':'2026-12-01','amount':''},
                      {'kind':'payment','title':'งวดที่ 1','due_date':'2026-12-15','amount':'50,000.50'}]
        self.assertEqual(self.admin.call(f'/api/contracts/{contract}',{'title':'x','body':'y','milestones':[{'kind':'payment','title':'x','amount':'abc'}]},'PATCH')[0],400)
        self.ok(self.admin,f'/api/contracts/{contract}',{'title':'ระบบห้องสมุดดิจิทัล','body':'ขอบเขตงานเวอร์ชันแรก','milestones':milestones},'PATCH')
        self.ok(self.admin,f'/api/contracts/{contract}/files',{'files':[{'name':'แบบร่าง.pdf','data':PDF}]})
        self.assertEqual(self.admin.call(f'/api/contracts/{contract}/files',{'files':[{'name':'virus.exe','data':PDF}]})[0],400)
        self.ok(self.admin,f'/api/contracts/{contract}/send',{})
        self.assertEqual(self.admin.call(f'/api/contracts/{contract}',{'title':'x','body':'y','milestones':[]},'PATCH')[0],409)
        # The customer reads version 1.0, and the reading is recorded with the IP address for the team only.
        seen = self.ok(customer,f'/api/public/alpha/contracts/{contract}')
        self.assertEqual((seen['document']['version'],seen['document']['body'],seen['contract']['status']),('1.0','ขอบเขตงานเวอร์ชันแรก','review'))
        self.assertEqual(seen['document']['milestones'][1]['amount'],'50000.50')
        file_id = seen['files'][0]['id']
        self.assertEqual(customer.call(f'/api/public/alpha/contracts/{contract}/files/{file_id}')[0],200)
        self.assertNotIn('ip',seen['events'][-1])
        self.assertIn('viewed',[e['action'] for e in self.ok(self.admin,f'/api/contracts/{contract}')['events']])
        self.assertTrue(all('ip' in e for e in self.ok(self.admin,f'/api/contracts/{contract}')['events']))
        overview = self.ok(customer,'/api/customer/overview')
        self.assertEqual([(c['id'],c['status'],c['org_slug']) for c in overview['contracts']],[(contract,'review','alpha')])
        self.assertIn('contract',[a['kind'] for a in overview['alerts'] if a['action']])
        # Asking for a change writes in the chat linked to the document; the team makes version 1.1.
        chat = self.ok(customer,f'/api/public/alpha/contracts/{contract}/changes',{'note':'ขอเลื่อนงวดที่ 1 เป็นสิ้นเดือน'})['conversation_id']
        self.assertIn('ขอเลื่อนงวดที่ 1',self.ok(self.admin,f'/api/conversations/{chat}')['messages'][-1]['body'])
        self.assertEqual(self.ok(customer,f'/api/public/alpha/contracts/{contract}/ask',{'body':'ต้องแนบอะไรเพิ่มไหม'})['conversation_id'],chat)
        self.assertEqual(customer.call(f'/api/public/alpha/contracts/{contract}/sign',{'agree':True,'name':'x','method':'type','mark':'x','password':'x'})[0],409)
        self.assertEqual(self.ok(self.admin,f'/api/contracts/{contract}/revise',{'note':'เลื่อนงวดตามคำขอ'})['version'],'1.1')
        milestones[1]['due_date'] = '2026-12-31'
        self.ok(self.admin,f'/api/contracts/{contract}',{'title':'ระบบห้องสมุดดิจิทัล','body':'ขอบเขตงานเวอร์ชันสอง','milestones':milestones},'PATCH')
        self.ok(self.admin,f'/api/contracts/{contract}/send',{})
        seen = self.ok(customer,f'/api/public/alpha/contracts/{contract}')
        self.assertEqual((seen['document']['version'],len(seen['files'])),('1.1',1))
        self.assertEqual([v['version'] for v in seen['versions']],['1.0','1.1'])
        # Without platform email the account password confirms the signer.
        self.ok(self.admin,'/api/platform/registration',{'enabled':False,'smtp_host':'','username':'','address':'','public_base_url':'','smtp_port':465})
        self.assertEqual(self.ok(customer,f'/api/public/alpha/contracts/{contract}/otp',{})['method'],'password')
        sign = {'agree':True,'name':'สมชาย ใจดี','method':'type','mark':self.sign_mark()}
        self.assertEqual(customer.call(f'/api/public/alpha/contracts/{contract}/sign',{**sign,'password':'Wrong-pass-123'})[0],403)
        self.assertEqual(customer.call(f'/api/public/alpha/contracts/{contract}/sign',{**sign,'agree':False,'password':self.CUSTOMER_PASSWORD})[0],400)
        self.ok(customer,f'/api/public/alpha/contracts/{contract}/sign',{**sign,'password':self.CUSTOMER_PASSWORD})
        self.assertEqual(self.ok(customer,f'/api/public/alpha/contracts/{contract}')['contract']['status'],'awaiting_org')
        # Only an organization admin countersigns.
        manager,_ = self.create_member(role='manager',email='manager@example.com')
        self.assertEqual(manager.call(f'/api/contracts/{contract}/sign',{**sign,'password':STAFF_PASSWORD})[0],403)
        org_sign = {'agree':True,'name':'เจ้าของระบบ','method':'draw','mark':self.sign_mark('draw'),'password':STAFF_PASSWORD}
        document_hash = self.ok(self.admin,f'/api/contracts/{contract}/sign',org_sign)['document_hash']
        self.assertRegex(document_hash,r'^[a-f0-9]{64}$')
        done = self.ok(customer,f'/api/public/alpha/contracts/{contract}')
        self.assertEqual((done['contract']['status'],done['contract']['document_hash']),('completed',document_hash))
        self.assertEqual({s['party'] for s in done['signatures']},{'customer','org'})
        self.assertEqual([m['title'] for m in done['project']['milestones']],['ส่งมอบระบบ','งวดที่ 1'])
        # Sealed: nothing changes it any more, and the platform can check the hash.
        self.assertEqual(self.admin.call(f'/api/contracts/{contract}/revise',{})[0],409)
        self.assertEqual(self.admin.call(f'/api/contracts/{contract}/cancel',{})[0],409)
        check = self.ok(self.admin,'/api/platform/contracts/verify',{'hash':document_hash})
        self.assertEqual((check['found'],check['valid'],check['organization']),(True,True,'องค์กร A'))
        self.assertEqual(agent.call('/api/platform/contracts/verify',{'hash':document_hash})[0],403)
        self.assertFalse(self.ok(self.admin,'/api/platform/contracts/verify',{'hash':'0'*64})['found'])
        with D.tenant(self.org) as db:
            db.execute("UPDATE contract_versions SET body='แก้ภายหลัง' WHERE version='1.1'")
        self.assertFalse(self.ok(self.admin,'/api/platform/contracts/verify',{'hash':document_hash})['valid'])

    def test_one_time_code_by_email_before_signing(self):
        customer,contract = self.draft()
        self.customer_mail()
        self.ok(self.admin,f'/api/contracts/{contract}/send',{})
        self.assertEqual(self.ok(customer,f'/api/public/alpha/contracts/{contract}/otp',{}),{'method':'email','sent_to':'v***@example.com'})
        code = re.search(r'คือ (\d{6})',self.mailer.call_args.args[3].get_content())[1]
        sign = {'agree':True,'name':'สมชาย ใจดี','method':'upload','mark':self.sign_mark('upload')}
        wrong = '000000' if code!='000000' else '111111'
        self.assertEqual(customer.call(f'/api/public/alpha/contracts/{contract}/sign',{**sign,'code':wrong})[0],403)
        # The account password is not a way around the code once email works.
        self.assertEqual(customer.call(f'/api/public/alpha/contracts/{contract}/sign',{**sign,'code':self.CUSTOMER_PASSWORD})[0],403)
        self.ok(customer,f'/api/public/alpha/contracts/{contract}/sign',{**sign,'code':code})
        events = self.ok(self.admin,f'/api/contracts/{contract}')['events']
        self.assertIn('รหัส OTP ทางอีเมล',next(e for e in events if e['action']=='signed')['detail'])
        # The code is used once.
        self.assertEqual(self.ok(self.admin,f'/api/contracts/{contract}/otp',{})['method'],'email')

    def test_customers_see_only_their_own_documents(self):
        customer,contract = self.draft()
        self.ok(self.admin,f'/api/contracts/{contract}/send',{})
        other = self.customer(email='other@example.com')
        self.assertEqual(other.call(f'/api/public/alpha/contracts/{contract}')[0],404)
        self.assertEqual(Client(self.base).call(f'/api/public/alpha/contracts/{contract}')[0],401)
        self.assertEqual(self.ok(other,'/api/customer/overview')['contracts'],[])
        # A contract goes only to a customer connected with the organization.
        self.assertEqual(self.admin.call('/api/contracts',{'kind':'contract','title':'x','account_id':'0'*32})[0],400)

    def test_templates_of_the_platform_and_of_the_organization(self):
        agent,_ = self.create_member()
        self.assertEqual(agent.call('/api/platform/contract-templates')[0],403)
        platform_id = self.ok(self.admin,'/api/platform/contract-templates',{'title':'สัญญาบำรุงรักษา','kind':'contract','body':'ผู้ว่าจ้าง {customer_name}'})['id']
        self.assertEqual(self.admin.call('/api/platform/contract-templates',{'title':'x','kind':'lease','body':'y'})[0],400)
        own = self.ok(self.admin,'/api/contract-templates',{'title':'TOR ของเรา','kind':'tor','body':'ขอบเขตสำหรับ {organization}'})['id']
        templates = self.ok(self.admin,'/api/contract-templates')
        self.assertIn(platform_id,[t['id'] for t in templates['platform']])
        self.assertEqual([t['id'] for t in templates['organization']],[own])
        self.assertIn('customer_name',templates['placeholders'])
        self.ok(self.admin,f'/api/contract-templates/{own}',{'title':'TOR ของเรา v2','kind':'tor','body':'ใหม่'},'PATCH')
        self.ok(self.admin,f'/api/contract-templates/{own}',None,'DELETE')
        self.assertEqual(self.ok(self.admin,'/api/contract-templates')['organization'],[])
        self.ok(self.admin,f'/api/platform/contract-templates/{platform_id}',None,'DELETE')

    def test_documents_written_elsewhere_become_editable_text(self):
        word = docx([('Title','สัญญาจ้างพัฒนาเว็บไซต์',False),('','ผู้ว่าจ้างตกลงจ้าง',True),('Heading2','ขอบเขต',False),('','หน้าแรกและระบบค้นหา',False)])
        body = self.ok(self.admin,'/api/contracts/import',{'name':'สัญญา.docx','data':word})['body']
        self.assertEqual(body.split('\n'),['# สัญญาจ้างพัฒนาเว็บไซต์','**ผู้ว่าจ้างตกลงจ้าง**','## ขอบเขต','หน้าแรกและระบบค้นหา'])
        text = base64.b64encode('บรรทัดแรก\r\nบรรทัดสอง'.encode()).decode()
        self.assertEqual(self.ok(self.admin,'/api/contracts/import',{'name':'note.txt','data':text})['body'],'บรรทัดแรก\nบรรทัดสอง')
        self.assertEqual(self.admin.call('/api/contracts/import',{'name':'scan.pdf','data':PDF})[0],400)
        self.assertEqual(self.admin.call('/api/contracts/import',{'name':'bad.docx','data':PDF})[0],400)
        # The imported text starts a contract.
        client,_ = self.visitor()
        account = self.ok(self.admin,'/api/contract-customers')['customers'][0]['id']
        contract = self.ok(self.admin,'/api/contracts',{'kind':'contract','title':'นำเข้า','account_id':account,'body':body})['id']
        self.assertEqual(self.ok(self.admin,f'/api/contracts/{contract}')['document']['body'],body)

    # The project after the signing
    def no_email(self):
        self.ok(self.admin,'/api/platform/registration',{'enabled':False,'smtp_host':'','username':'','address':'','public_base_url':'','smtp_port':465})

    def signed(self, milestones, warranty=180, customer_email='visitor@example.com', renews=None):
        """A contract both sides signed (the password confirms the signers: no platform email)."""
        if renews:
            customer,_ = renews
            account = next(c for c in self.ok(self.admin,'/api/contract-customers')['customers'] if c['email']==customer_email)
            contract = self.ok(self.admin,'/api/contracts',{'kind':'contract','title':'MA ระบบห้องสมุด','account_id':account['id'],'renews_id':renews[1]})['id']
        else:
            customer,contract = self.draft(customer_email=customer_email)
        self.ok(self.admin,f'/api/contracts/{contract}',{'title':'ระบบห้องสมุดดิจิทัล','body':'ขอบเขตงาน','milestones':milestones,
                                                         'warranty_days':warranty,'support_terms':'ตอบกลับภายใน 1 วันทำการ'},'PATCH')
        self.ok(self.admin,f'/api/contracts/{contract}/send',{})
        self.no_email()
        self.ok(customer,f'/api/public/alpha/contracts/{contract}/sign',{'agree':True,'name':'สมชาย','method':'type','mark':'สมชาย','password':self.CUSTOMER_PASSWORD})
        self.ok(self.admin,f'/api/contracts/{contract}/sign',{'agree':True,'name':'เจ้าของ','method':'type','mark':'เจ้าของ','password':STAFF_PASSWORD})
        return customer,contract

    def project(self, client, contract, staff=False):
        path = f'/api/contracts/{contract}' if staff else f'/api/public/alpha/contracts/{contract}'
        return self.ok(client,path)['project']

    def test_deliveries_invoices_and_receipts(self):
        other = self.customer(email='other@example.com')          # before email is turned off for the signing
        agent,_ = self.create_member()
        manager,_ = self.create_member(role='manager',email='manager@example.com')
        billing = {'pay_bank':'กสิกรไทย','pay_account_name':'องค์กร A จำกัด','pay_account_number':'123-4-56789-0','pay_promptpay':'081-234-5678',
                   'vat_registered':True,'tax_id':'0105551234567','tax_branch':'สำนักงานใหญ่','org_address':'1 ถนนสุขุมวิท กรุงเทพฯ','invoice_due_days':15}
        self.assertEqual(agent.call('/api/contract-billing')[0],403)
        self.assertEqual(manager.call('/api/contract-billing',billing)[0],403)
        self.assertEqual(self.admin.call('/api/contract-billing',{**billing,'tax_id':'0105551234560'})[0],400)
        self.assertEqual(self.admin.call('/api/contract-billing',{**billing,'pay_promptpay':'12345'})[0],400)
        self.assertEqual(self.admin.call('/api/contract-billing',{**billing,'org_address':''})[0],400)
        self.ok(self.admin,'/api/contract-billing',billing)
        self.assertEqual(self.ok(manager,'/api/contract-billing')['settings']['pay_promptpay'],'0812345678')
        customer,contract = self.signed([{'kind':'payment','title':'มัดจำ','due_date':'','amount':'50000'},
                                          {'kind':'delivery','title':'ออกแบบระบบ','due_date':'2026-11-30','amount':'100,000'},
                                          {'kind':'delivery','title':'พัฒนาระบบ','due_date':'2026-12-31','amount':'300000'}])
        project = self.project(customer,contract)
        self.assertEqual((project['progress'],project['coverage']['state'],project['warranty_days']),(0,'waiting',180))
        deposit,design,build = project['milestones']
        base = f'/api/contracts/{contract}/milestones'
        # The team works on the design and sends it for inspection.
        self.ok(self.admin,f'{base}/{design["id"]}/start',{})
        self.ok(self.admin,f'{base}/{design["id"]}/progress',{'progress':50})
        self.assertEqual(self.project(customer,contract)['progress'],12)        # 50% of 100,000 out of 400,000
        self.assertEqual(customer.call(f'/api/public/alpha/contracts/{contract}/milestones/{design["id"]}/accept',{})[0],409)
        self.assertEqual(self.admin.call(f'{base}/{design["id"]}/deliver',{'note':'x','links':['javascript:alert(1)']})[0],400)
        self.assertEqual(self.admin.call(f'{base}/{design["id"]}/deliver',{})[0],400)
        self.ok(self.admin,f'{base}/{design["id"]}/deliver',{'note':'แบบหน้าจอทั้งหมด','links':['https://preview.example.com/design'],
                                                              'files':[{'name':'design.pdf','data':PDF}]})
        seen = self.project(customer,contract)
        delivery = seen['deliveries'][0]
        self.assertEqual((delivery['round'],delivery['links'],delivery['decision']),(1,['https://preview.example.com/design'],'pending'))
        self.assertEqual(customer.call(f'/api/public/alpha/contracts/{contract}/files/{delivery["files"][0]["id"]}')[0],200)
        self.assertIn('delivery',[a['kind'] for a in self.ok(customer,'/api/customer/overview')['alerts'] if a['action']])
        # Sent back with a remark (written in the document's chat), then accepted on the second round.
        self.assertEqual(customer.call(f'/api/public/alpha/contracts/{contract}/milestones/{design["id"]}/reject',{'remark':''})[0],400)
        chat = self.ok(customer,f'/api/public/alpha/contracts/{contract}/milestones/{design["id"]}/reject',{'remark':'ขอปรับสีหน้าแรก'})['conversation_id']
        self.assertIn('ขอปรับสีหน้าแรก',self.ok(self.admin,f'/api/conversations/{chat}')['messages'][-1]['body'])
        self.assertEqual(self.project(self.admin,contract,True)['milestones'][1]['status'],'revision')
        self.assertEqual(self.ok(self.admin,'/api/contracts')['contracts'][0]['revisions'],1)
        self.ok(self.admin,f'{base}/{design["id"]}/deliver',{'note':'ปรับสีแล้ว'})
        invoice_id = self.ok(customer,f'/api/public/alpha/contracts/{contract}/milestones/{design["id"]}/accept',{'remark':'เรียบร้อย'})['invoice_id']
        project = self.project(customer,contract)
        self.assertEqual([d['decision'] for d in project['deliveries']],['rejected','accepted'])
        self.assertEqual(project['progress'],25)
        # Accepting billed it: VAT 7%, the organization's bank account and a PromptPay QR for the exact amount.
        invoice = self.ok(customer,f'/api/public/alpha/contracts/{contract}/invoices/{invoice_id}')
        self.assertEqual((invoice['invoice']['subtotal'],invoice['invoice']['vat'],invoice['invoice']['total'],invoice['invoice']['status']),
                         ('100000.00','7000.00','107000.00','unpaid'))
        self.assertEqual((invoice['invoice']['reference'],invoice['seller']['vat'],invoice['seller']['tax_id']),('INV-000001',True,'0105551234567'))
        self.assertEqual(invoice['total_words'],'หนึ่งแสนเจ็ดพันบาทถ้วน')
        self.assertTrue(invoice['qr'].startswith('data:image/svg+xml;base64,'))
        self.assertEqual(self.ok(customer,f'/api/public/alpha/invoices/{invoice_id}')['invoice']['id'],invoice_id)
        self.assertIn('invoice',[a['kind'] for a in self.ok(customer,'/api/customer/overview')['alerts'] if a['action']])
        self.assertEqual(other.call(f'/api/public/alpha/invoices/{invoice_id}')[0],404)
        # The slip: rejected once with a reason, then confirmed; the receipt carries the buyer's tax details.
        self.assertEqual(customer.call(f'/api/public/alpha/contracts/{contract}/buyer',{'name':'บริษัท ลูกค้า จำกัด','tax_id':'123'})[0],400)
        self.ok(customer,f'/api/public/alpha/contracts/{contract}/buyer',{'name':'บริษัท ลูกค้า จำกัด','address':'2 ถนนพหลโยธิน','tax_id':'0105551234567','branch':'สำนักงานใหญ่'})
        slip = f'/api/public/alpha/contracts/{contract}/invoices/{invoice_id}/slip'
        self.ok(customer,slip,{'files':[{'name':'slip.png','data':PNG}],'note':'โอนจากกสิกร'})
        self.assertEqual(self.ok(self.admin,'/api/contracts')['contracts'][0]['slips_waiting'],1)
        self.assertEqual(self.admin.call(f'/api/contracts/{contract}/invoices/{invoice_id}/reject',{})[0],400)
        self.ok(self.admin,f'/api/contracts/{contract}/invoices/{invoice_id}/reject',{'reason':'ยอดไม่ครบ'})
        self.assertEqual(self.ok(customer,f'/api/public/alpha/invoices/{invoice_id}')['invoice']['reject_reason'],'ยอดไม่ครบ')
        self.ok(customer,slip,{'files':[{'name':'slip2.png','data':PNG}]})
        self.assertEqual(self.ok(self.admin,f'/api/contracts/{contract}/invoices/{invoice_id}/confirm',{})['receipt'],'RC-000001')
        paid = self.ok(customer,f'/api/public/alpha/invoices/{invoice_id}')
        self.assertEqual((paid['invoice']['status'],paid['invoice']['receipt_reference'],paid['buyer']['tax_id'],paid['qr'],len(paid['slips'])),
                         ('paid','RC-000001','0105551234567','',2))
        self.assertEqual(self.admin.call(f'/api/contracts/{contract}/invoices/{invoice_id}/confirm',{})[0],409)
        # A payment milestone is billed by the team; a void invoice can be issued again; a delivery waits for acceptance.
        self.assertEqual(self.admin.call(f'{base}/{build["id"]}/invoice',{})[0],409)
        deposit_invoice = self.ok(self.admin,f'{base}/{deposit["id"]}/invoice',{})['id']
        self.assertEqual(self.admin.call(f'{base}/{deposit["id"]}/invoice',{})[0],409)
        self.ok(self.admin,f'/api/contracts/{contract}/invoices/{deposit_invoice}/void',{'reason':'ออกผิดยอด'})
        self.assertEqual(customer.call(f'/api/public/alpha/invoices/{deposit_invoice}')[0],404)
        again = self.ok(self.admin,f'{base}/{deposit["id"]}/invoice',{})['id']
        self.ok(self.admin,f'/api/contracts/{contract}/invoices/{again}/confirm',{})
        self.assertEqual(self.project(customer,contract)['milestones'][0]['status'],'done')
        # The last delivery accepted: 100%, and the 180-day warranty starts.
        self.ok(self.admin,f'{base}/{build["id"]}/deliver',{'links':['https://preview.example.com/app']})
        self.ok(customer,f'/api/public/alpha/contracts/{contract}/milestones/{build["id"]}/accept',{})
        project = self.project(customer,contract)
        self.assertEqual((project['progress'],project['coverage']['state'],project['coverage']['days_left']),(100,'active',180))
        self.assertEqual(project['totals'],{'contract':'450000.00','billed':'481500.00','paid':'160500.00'})
        self.assertEqual([i['reference'] for i in project['invoices']],['INV-000001','INV-000003','INV-000004'])
        self.assertEqual(len(self.project(self.admin,contract,True)['invoices']),4)   # the team also sees the void one
        overview = self.ok(customer,'/api/customer/overview')
        self.assertEqual(overview['contracts'][0]['progress'],100)
        self.assertEqual(sorted(i['status'] for i in overview['invoices']),['paid','paid','unpaid'])

    def test_issues_warranty_and_ma_renewal(self):
        _,other_contract = self.draft(customer_email='other@example.com')   # before email is turned off for the signing
        customer,contract = self.signed([{'kind':'delivery','title':'ติดตั้งระบบ','due_date':'','amount':''}],warranty=30)
        milestone = self.project(customer,contract)['milestones'][0]
        self.assertEqual(customer.call(f'/api/public/alpha/contracts/{contract}/renewal',{})[0],409)   # nothing delivered yet
        self.ok(self.admin,f'/api/contracts/{contract}/milestones/{milestone["id"]}/deliver',{'note':'ติดตั้งแล้ว'})
        self.ok(customer,f'/api/public/alpha/contracts/{contract}/milestones/{milestone["id"]}/accept',{})
        cover = self.project(customer,contract)['coverage']
        self.assertEqual((cover['state'],cover['days_left'],self.project(customer,contract)['progress']),('active',30,100))
        self.assertIn('warranty',[a['kind'] for a in self.ok(customer,'/api/customer/overview')['alerts'] if a['action']])
        # A bug report is a case linked to the project and its milestone; the customer sees it in their cases too.
        self.assertEqual(customer.call(f'/api/public/alpha/contracts/{contract}/issues',{'kind':'other','subject':'x','body':'y'})[0],400)
        issue = self.ok(customer,f'/api/public/alpha/contracts/{contract}/issues',{'kind':'bug','milestone_id':milestone['id'],
                                                                                   'subject':'ค้นหาหนังสือไม่เจอ','body':'พิมพ์ชื่อแล้วไม่มีผล'})
        case = self.ok(self.admin,f'/api/tickets/{issue["ticket_id"]}')
        self.assertEqual((case['ticket']['priority'],case['ticket']['category']),('high','แจ้งปัญหา (Bug)'))
        logged = self.project(customer,contract)['issues']
        self.assertEqual((logged[0]['kind'],logged[0]['milestone_id'],logged[0]['number']),('bug',milestone['id'],case['ticket']['number']))
        self.assertIn(issue['ticket_id'],[c['id'] for c in self.ok(customer,'/api/customer/overview')['cases']])
        self.assertEqual(self.ok(self.admin,'/api/contracts')['contracts'][0]['open_issues'],1)
        # ขอต่อ MA: once; the team then sends an MA contract that continues the cover from the day it ends.
        self.ok(customer,f'/api/public/alpha/contracts/{contract}/renewal',{'note':'ต่อ 1 ปี'})
        self.assertEqual(customer.call(f'/api/public/alpha/contracts/{contract}/renewal',{})[0],409)
        self.assertNotIn('warranty',[a['kind'] for a in self.ok(customer,'/api/customer/overview')['alerts']])
        self.assertTrue(self.project(self.admin,contract,True)['ma_requested_at'])
        account = next(c for c in self.ok(self.admin,'/api/contract-customers')['customers'] if c['email']=='visitor@example.com')
        self.assertEqual(self.admin.call('/api/contracts',{'kind':'contract','title':'x','account_id':account['id'],'renews_id':other_contract})[0],400)
        _,ma = self.signed([{'kind':'payment','title':'ค่าบริการปีแรก','due_date':'','amount':'24000'}],warranty=365,renews=(customer,contract))
        ma_view = self.ok(customer,f'/api/public/alpha/contracts/{ma}')
        self.assertEqual(ma_view['renews']['id'],contract)
        self.assertEqual(ma_view['project']['coverage']['start'],cover['end'])
        project = self.project(customer,contract)
        self.assertEqual((project['coverage']['renewed'],project['coverage']['end'],project['ma_requested_at']),
                         (True,ma_view['project']['coverage']['end'],None))
        self.assertEqual(project['coverage']['days_left'],30+365)
        self.assertEqual([r['id'] for r in project['renewals']],[ma])

    def test_old_milestone_table_is_upgraded(self):
        from backend.database import schema
        with D.tenant(self.org) as db:
            db.executescript('''DROP TABLE contract_milestones;
                CREATE TABLE contract_milestones (id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, seq INTEGER NOT NULL,
                    kind TEXT NOT NULL CHECK(kind IN ('delivery','payment')), title TEXT NOT NULL, due_date TEXT NOT NULL DEFAULT '',
                    amount TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','submitted','done')),
                    done_at TEXT, done_by TEXT);
                INSERT INTO contract_milestones(id,contract_id,seq,kind,title,status) VALUES('m1','c1',1,'payment','งวดเดิม','done');''')
            schema.upgrade_tenant(db)
            db.execute("UPDATE contract_milestones SET status='in_progress',progress=40 WHERE id='m1'")
            self.assertEqual(tuple(db.execute("SELECT title,status,progress FROM contract_milestones").fetchone()),('งวดเดิม','in_progress',40))

    def test_payment_texts(self):
        from backend.utils import promptpay, qrcode, thaibaht
        self.assertEqual(promptpay.crc16('123456789'),'29B1')
        text = promptpay.payload('081-234-5678','107000')
        self.assertTrue(text.startswith('000201010212') and '0113006681234567' in text and '5409107000.00' in text)
        self.assertEqual(text[-4:],promptpay.crc16(text[:-4]))
        self.assertEqual(len(qrcode.matrix(text)),41)                       # version 6
        self.assertEqual(thaibaht.baht_text('1250.50'),'หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์')
        self.assertEqual(thaibaht.baht_text('1000001'),'หนึ่งล้านเอ็ดบาทถ้วน')

    def test_cancelled_documents_stop_at_once(self):
        customer,contract = self.draft()
        self.ok(self.admin,f'/api/contracts/{contract}/send',{})
        self.ok(self.admin,f'/api/contracts/{contract}/cancel',{})
        self.assertEqual(self.ok(customer,f'/api/public/alpha/contracts/{contract}')['contract']['status'],'cancelled')
        self.assertEqual(customer.call(f'/api/public/alpha/contracts/{contract}/otp',{})[0],409)


if __name__=='__main__':
    unittest.main()
