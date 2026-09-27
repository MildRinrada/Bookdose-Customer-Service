"""ช่องข้อมูลเพิ่มเติมของเคส (tickets/fields.py): the organization's own fields on its cases - set by the owner, filled by
the team, required before a member closes a case, in the case list, the CSV and the recycle bin, and seen and filled by
the AI assistant (with the member's confirmation). Each test uses a disposable database; the provider is mocked."""
import json
import unittest
from unittest.mock import patch

import test_ai
import test_app as base
from backend.extensions import openai_client as OpenAI
from backend.modules.ai import service as AI
from test_ai_assistant_actions import act

FIELDS = '/api/settings/fields'


class CaseFieldTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    create_member = base.IntegrationTests.create_member
    visitor = base.IntegrationTests.visitor
    customer = base.IntegrationTests.customer
    customer_mail = base.IntegrationTests.customer_mail
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    mail_link = base.IntegrationTests.mail_link
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD
    enable = test_ai.AITests.enable

    def set_fields(self, *items):
        return self.ok(self.admin,FIELDS,{'fields':list(items)})

    def standard(self):
        """เลขคำสั่งซื้อ (required), จำนวน, วันที่ซื้อ, สาขา (a choice), ตรวจเอกสารแล้ว (a required tick): {name: id}."""
        saved = self.set_fields({'name':'เลขคำสั่งซื้อ','kind':'text','required':True},{'name':'จำนวน','kind':'number'},
                                {'name':'วันที่ซื้อ','kind':'date'},{'name':'สาขา','kind':'select','options':['บางนา','สีลม']},
                                {'name':'ตรวจเอกสารแล้ว','kind':'checkbox','required':True})
        return {f['name']:f['id'] for f in saved['fields']}

    def new_case(self, subject='ของมาไม่ครบ'):
        contact = self.ok(self.admin,'/api/contacts')['contacts'][0]['id']
        return self.ok(self.admin,'/api/tickets',{'subject':subject,'contact_id':contact})['id']

    def fill(self, client, tid, **values):
        return client.call(f'/api/tickets/{tid}/fields',{'values':values})

    def test_the_owner_sets_the_fields_and_each_kind_is_checked(self):
        agent,_ = self.create_member()
        self.assertEqual(agent.call(FIELDS,{'fields':[]})[0],403)
        for bad in ({'name':'ก','kind':'colour'},{'name':'สาขา','kind':'select','options':[]},{'name':'','kind':'text'},
                    {'name':'ก'*41,'kind':'text'},{'name':'รุ่น','kind':'text','required':'yes'}):
            self.assertEqual(self.admin.call(FIELDS,{'fields':[bad]})[0],400,bad)
        self.assertEqual(self.admin.call(FIELDS,{'fields':[{'name':'รุ่น','kind':'text'},{'name':'รุ่น ','kind':'number'}]})[0],400)
        ids = self.standard()
        # The kind of a field already there never changes; its name does, and it keeps its values.
        listed = self.ok(self.admin,FIELDS)['fields']
        changed = [{**f,'kind':'number'} if f['name']=='เลขคำสั่งซื้อ' else f for f in listed]
        self.assertEqual(self.admin.call(FIELDS,{'fields':changed})[0],400)
        self.assertIn('case_fields',self.ok(agent,'/api/workspace')['settings'])

        tid = self.new_case()
        for field,value in (('จำนวน','สิบ'),('วันที่ซื้อ','2026-02-30'),('สาขา','ลาดพร้าว'),('เลขคำสั่งซื้อ','ก'*201),('ตรวจเอกสารแล้ว','maybe')):
            self.assertEqual(self.fill(self.admin,tid,**{ids[field]:value})[0],400,field)
        self.assertEqual(self.fill(self.admin,tid,**{'f'*32:'x'})[0],400)
        saved = self.fill(agent,tid,**{ids['เลขคำสั่งซื้อ']:'  SO-1001 ',ids['จำนวน']:'1,200',ids['วันที่ซื้อ']:'2026-09-01',
                                        ids['สาขา']:'สีลม',ids['ตรวจเอกสารแล้ว']:True})[1]['fields']
        self.assertEqual(saved,{ids['เลขคำสั่งซื้อ']:'SO-1001',ids['จำนวน']:'1200',ids['วันที่ซื้อ']:'2026-09-01',ids['สาขา']:'สีลม',
                                ids['ตรวจเอกสารแล้ว']:'1'})
        # The case screen, the case list and the activity log.
        self.assertEqual(self.ok(self.admin,f'/api/tickets/{tid}')['ticket']['fields'],saved)
        self.assertEqual(next(t for t in self.ok(self.admin,'/api/tickets')['tickets'] if t['id']==tid)['fields'],saved)
        event = next(e for e in self.ok(self.admin,f'/api/tickets/{tid}')['events'] if e['action']=='ticket.fields')
        self.assertIn({'field':'ตรวจเอกสารแล้ว','before':'-','after':'ใช่'},json.loads(event['detail']))
        # A tick taken off, a value cleared.
        self.assertEqual(self.fill(self.admin,tid,**{ids['สาขา']:'',ids['ตรวจเอกสารแล้ว']:False})[1]['fields'],
                         {k:v for k,v in saved.items() if k not in (ids['สาขา'],ids['ตรวจเอกสารแล้ว'])})
        self.assertEqual(self.ok(self.admin,FIELDS)['counts'][ids['จำนวน']],1)

        # Renamed: the values stay. Taken off the list: its values go too.
        renamed = [{**f,'name':'ยอดสั่ง'} if f['id']==ids['จำนวน'] else f for f in self.ok(self.admin,FIELDS)['fields']]
        self.ok(self.admin,FIELDS,{'fields':renamed})
        self.assertEqual(self.ok(self.admin,f'/api/tickets/{tid}')['ticket']['fields'][ids['จำนวน']],'1200')
        self.ok(self.admin,FIELDS,{'fields':[f for f in renamed if f['id']!=ids['จำนวน']]})
        self.assertNotIn(ids['จำนวน'],self.ok(self.admin,f'/api/tickets/{tid}')['ticket']['fields'])
        self.assertNotIn(ids['จำนวน'],self.ok(self.admin,FIELDS)['counts'])

    def test_required_fields_are_filled_before_a_member_closes_the_case(self):
        ids = self.standard()
        tid = self.new_case()
        status,body = self.admin.call(f'/api/tickets/{tid}',{'status':'resolved'},'PATCH')
        self.assertEqual(status,400)
        self.assertEqual(body['error'],'กรอก เลขคำสั่งซื้อ, ตรวจเอกสารแล้ว ก่อนปิดเคส')
        # A macro that closes the case waits too, before it sends anything.
        macro = self.ok(self.admin,'/api/automation/macros',{'name':'ปิดเคส','reply':'ขอบคุณค่ะ','set_status':'closed','followup_hours':0})['id']
        self.assertEqual(self.admin.call(f'/api/macros/{macro}/run',{'ticket_id':tid})[0],400)
        # Other changes are not held up.
        self.ok(self.admin,f'/api/tickets/{tid}',{'priority':'high','status':'pending_customer'},'PATCH')
        self.fill(self.admin,tid,**{ids['เลขคำสั่งซื้อ']:'SO-1'})
        self.assertEqual(self.admin.call(f'/api/tickets/{tid}',{'status':'closed'},'PATCH')[1]['error'],'กรอก ตรวจเอกสารแล้ว ก่อนปิดเคส')
        self.fill(self.admin,tid,**{ids['ตรวจเอกสารแล้ว']:'yes'})
        self.ok(self.admin,f'/api/macros/{macro}/run',{'ticket_id':tid})
        self.assertEqual(self.ok(self.admin,f'/api/tickets/{tid}')['ticket']['status'],'closed')
        # Closed: a required field keeps its value; the others may still change.
        self.assertEqual(self.fill(self.admin,tid,**{ids['เลขคำสั่งซื้อ']:''})[0],400)
        self.assertEqual(self.fill(self.admin,tid,**{ids['สาขา']:'บางนา'})[0],200)

    def test_the_values_go_into_the_csv_and_come_back_from_the_bin(self):
        ids = self.standard()
        tid = self.new_case('เคสที่มีข้อมูล')
        self.fill(self.admin,tid,**{ids['เลขคำสั่งซื้อ']:'SO-77',ids['ตรวจเอกสารแล้ว']:True,ids['สาขา']:'บางนา'})
        csv_text = self.admin.call('/api/export/tickets.csv')[1].decode('utf-8-sig')
        header,*lines = csv_text.splitlines()
        self.assertTrue(header.endswith('เลขคำสั่งซื้อ,จำนวน,วันที่ซื้อ,สาขา,ตรวจเอกสารแล้ว'))
        row = next(line for line in lines if 'เคสที่มีข้อมูล' in line)
        self.assertTrue(row.endswith('SO-77,,,บางนา,ใช่'))
        self.ok(self.admin,f'/api/tickets/{tid}',None,'DELETE')
        item = next(i for i in self.ok(self.admin,'/api/trash')['items'] if i['kind']=='ticket')
        self.ok(self.admin,f"/api/trash/{item['id']}/restore",{})
        self.assertEqual(self.ok(self.admin,f'/api/tickets/{tid}')['ticket']['fields'][ids['เลขคำสั่งซื้อ']],'SO-77')

    def test_the_assistant_sees_the_fields_and_fills_them_before_it_closes_a_case(self):
        self.enable(chatbot_enabled=False)
        ids = self.standard()
        tid = self.new_case('ขอคืนสินค้า')
        number = f"BD-{self.ok(self.admin,f'/api/tickets/{tid}')['ticket']['number']}"
        self.fill(self.admin,tid,**{ids['สาขา']:'สีลม'})
        seen = {}

        def provider(key, cfg, payload, mode):
            seen['payload'] = payload
            ref = {f['name']:f['ref'] for f in payload['case_fields']}
            return {'answer':'กรอกข้อมูลแล้วปิดเคสได้','citations':[],'actions':[
                act('update_case',number,status='resolved'),
                act('set_fields',number,values=[{'field':ref['เลขคำสั่งซื้อ'],'value':'SO-9'},{'field':ref['ตรวจเอกสารแล้ว'],'value':'yes'},
                                                {'field':ref['สาขา'],'value':'ลาดพร้าว'},{'field':'f99','value':'x'}])]},{'input_tokens':1,'output_tokens':1}
        job = self.ok(self.admin,'/api/ai/assistant',{'question':f'{number} ลูกค้าส่งเลข SO-9 มาแล้ว ตรวจเอกสารครบ ปิดเคสให้หน่อย'})['id']
        with patch.object(OpenAI,'call_provider',side_effect=provider):
            AI.process_one(self.org)
        payload = seen['payload']
        fields = {f['name']:f for f in payload['case_fields']}
        self.assertEqual((fields['สาขา']['options'],fields['เลขคำสั่งซื้อ']['required_to_close']),(['บางนา','สีลม'],True))
        case = next(c for c in payload['cases'] if c['case']==number)
        self.assertEqual(case['fields'],{fields['สาขา']['ref']:'สีลม'})
        self.assertEqual(set(case['missing_to_close']),{fields['เลขคำสั่งซื้อ']['ref'],fields['ตรวจเอกสารแล้ว']['ref']})
        found = self.ok(self.admin,'/api/ai/jobs/'+job)['result']
        # The values go first; the option that is not on the list and the field it was not shown are left out.
        self.assertEqual([a['type'] for a in found['actions']],['set_fields','update_case'])
        self.assertEqual(found['actions'][0]['values'],{ids['เลขคำสั่งซื้อ']:'SO-9',ids['ตรวจเอกสารแล้ว']:'1'})
        results = self.ok(self.admin,f'/api/ai/assistant/{job}/run',{'picked':[0,1]})['results']
        self.assertEqual([r['ok'] for r in results],[True,True],results)
        self.assertEqual(self.ok(self.admin,f'/api/tickets/{tid}')['ticket']['status'],'resolved')


if __name__=='__main__':
    unittest.main()
