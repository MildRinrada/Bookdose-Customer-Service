"""HTTP integration tests; each test uses a disposable database, never real data."""
import base64
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import http.cookiejar
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import zipfile

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app
import database as D


class Client:
    def __init__(self,base):
        self.base=base
        self.jar=http.cookiejar.CookieJar()
        self.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf=''
        self.tenant=''
        self.portal=''

    def call(self,path,body=None,method=None,headers=None):
        hs={'X-CSRF-Token':self.csrf,'X-Tenant-ID':self.tenant,'X-Portal-Token':self.portal}
        if body is not None:
            hs['Content-Type']='application/json'
        hs.update(headers or {})
        request=urllib.request.Request(self.base+path,data=None if body is None else json.dumps(body).encode(),headers=hs,method=method or ('GET' if body is None else 'POST'))
        try:
            response=self.opener.open(request,timeout=20)
        except urllib.error.HTTPError as error:
            response=error
        with response:
            data=response.read()
            return response.status,json.loads(data) if 'application/json' in response.headers.get('Content-Type','') else data

    def boot(self):
        status,result=self.call('/api/bootstrap')
        assert status==200,result
        self.csrf=result['csrf'] or ''
        self.tenant=result['tenant_id'] or ''
        return result

    def login(self,email,password='Test-password-123!'):
        status,result=self.call('/api/login',{'email':email,'password':password})
        assert status==200,result
        return self.boot()

    def switch(self,tenant_id):
        status,result=self.call('/api/session/tenant',{'tenant_id':tenant_id})
        assert status==200,result
        self.boot()


class QuietHandler(app.Handler):
    def log_message(self,*args):
        pass


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory(prefix='bookdose-test-')
        self.original_data=D.DATA
        D.DATA=Path(self.temporary.name)/'data'
        D.init()
        app.RATES.clear()
        self.server=app.ThreadingHTTPServer(('127.0.0.1',0),QuietHandler)
        self.server.daemon_threads=True
        self.server.secure_cookies=False
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.base=f'http://127.0.0.1:{self.server.server_port}'
        self.admin=Client(self.base)
        self.assertEqual(self.admin.call('/api/setup',{'name':'เจ้าของระบบ','email':'admin@example.com','password':'Test-password-123!','organization':'องค์กร A','slug':'alpha','demo':True})[0],200)
        self.boot=self.admin.boot()
        self.org=self.admin.tenant
        self.work=self.ok(self.admin,'/api/workspace')
        self.team=self.work['team_id']

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        D.DATA=self.original_data
        self.temporary.cleanup()

    def ok(self,client,path,body=None,method=None):
        status,data=client.call(path,body,method)
        self.assertIn(status,(200,201),data)
        return data

    def visitor(self,slug='alpha',email='visitor@example.com'):
        client=Client(self.base)
        result=self.ok(client,f'/api/public/{slug}/conversations',{'name':'ลูกค้าทดสอบ','email':email,'subject':'ต้องการความช่วยเหลือ','body':'เปิดหนังสือไม่ได้'})
        client.portal=result['token']
        return client,result['conversation_id']

    def create_member(self,team=None,role='agent',email='agent@example.com'):
        user_id=self.ok(self.admin,'/api/members',{'name':'เจ้าหน้าที่ทดสอบ','email':email,'password':'Test-password-123!','role':role,'team_id':team or self.team})['id']
        client=Client(self.base)
        client.login(email)
        return client,user_id

    def test_portal_ticket_reply_note_attachment_and_reopening(self):
        visitor,conversation=self.visitor()
        self.assertNotIn('portal_token',self.ok(self.admin,f'/api/conversations/{conversation}')['conversation'])
        before=len(self.ok(self.admin,'/api/tickets')['tickets'])
        ticket=self.ok(self.admin,f'/api/conversations/{conversation}/ticket',{})['id']
        self.assertEqual(len(self.ok(self.admin,'/api/tickets')['tickets']),before+1)
        self.assertEqual(self.admin.call(f'/api/conversations/{conversation}/ticket',{})[0],409)
        file={'name':'บันทึก.txt','data':base64.b64encode('ลับสำหรับทีม'.encode()).decode()}
        self.ok(self.admin,f'/api/conversations/{conversation}/messages',{'kind':'note','body':'PRIVATE INTERNAL NOTE','attachments':[file]})
        note=self.ok(self.admin,f'/api/conversations/{conversation}')['messages'][-1]
        file_id=note['attachments'][0]['id']
        public=self.ok(visitor,'/api/public/alpha/session')
        self.assertNotIn('PRIVATE INTERNAL NOTE',json.dumps(public))
        self.assertEqual(visitor.call(f'/api/public/alpha/attachments/{file_id}')[0],404)
        self.assertEqual(self.admin.call(f'/api/attachments/{file_id}')[1],'ลับสำหรับทีม'.encode())
        self.ok(self.admin,f'/api/conversations/{conversation}/messages',{'kind':'reply','body':'ช่วยเหลือเรียบร้อยแล้ว','attachments':[{'name':'guide.txt','data':base64.b64encode(b'Public guide').decode()}]})
        public=self.ok(visitor,'/api/public/alpha/session')
        self.assertEqual(public['messages'][-1]['body'],'ช่วยเหลือเรียบร้อยแล้ว')
        public_file=public['messages'][-1]['attachments'][0]['id']
        self.assertEqual(visitor.call(f'/api/public/alpha/attachments/{public_file}')[1],b'Public guide')
        self.assertIsNotNone(self.ok(self.admin,f'/api/tickets/{ticket}')['ticket']['first_response_at'])
        self.ok(self.admin,f'/api/tickets/{ticket}',{'status':'resolved'},'PATCH')
        self.assertEqual(self.ok(visitor,'/api/public/alpha/session')['ticket']['status'],'resolved')
        self.ok(visitor,'/api/public/alpha/messages',{'body':'ยังต้องการความช่วยเหลืออีกนิด'})
        reopened=self.ok(self.admin,f'/api/tickets/{ticket}')['ticket']
        self.assertEqual(reopened['status'],'open')
        self.assertIsNone(reopened['resolved_at'])

    def test_tenant_isolation_ids_export_and_backup(self):
        original=self.ok(self.admin,'/api/tickets')['tickets'][0]
        visitor,conv=self.visitor()
        self.ok(self.admin,f'/api/conversations/{conv}/messages',{'kind':'note','body':'TENANT A ONLY','attachments':[{'name':'a.txt','data':base64.b64encode(b'A secret').decode()}]})
        attachment=self.ok(self.admin,f'/api/conversations/{conv}')['messages'][-1]['attachments'][0]['id']
        second=self.ok(self.admin,'/api/platform/tenants',{'name':'องค์กร B','slug':'beta','email':'admin@example.com'})['id']
        self.admin.switch(second)
        self.assertEqual(self.ok(self.admin,'/api/tickets')['tickets'],[])
        self.assertEqual(self.admin.call('/api/tickets/'+original['id'])[0],404)
        self.assertEqual(self.admin.call('/api/tickets/'+original['id'],{'status':'closed'},'PATCH')[0],404)
        self.assertEqual(self.admin.call('/api/conversations/'+conv)[0],404)
        self.assertEqual(self.admin.call('/api/attachments/'+attachment)[0],404)
        self.assertEqual(self.admin.call('/api/tickets',{'subject':'Cross tenant','contact_id':original['contact_id'],'team_id':self.work['team_id']})[0],404)
        self.assertNotIn(original['subject'].encode(),self.admin.call('/api/export/tickets.csv')[1])
        backup=self.admin.call('/api/backup')[1]
        with zipfile.ZipFile(io.BytesIO(backup)) as archive:
            self.assertIn(f'tenants/{second}.sqlite3',archive.namelist())
            self.assertNotIn(f'tenants/{self.org}.sqlite3',archive.namelist())
            self.assertFalse(any(name.startswith('files/') for name in archive.namelist()))
        self.assertEqual(visitor.call('/api/public/beta/session')[0],404)
        self.admin.switch(self.org)
        self.assertEqual(self.ok(self.admin,'/api/tickets/'+original['id'])['ticket']['subject'],original['subject'])

    def test_platform_role_does_not_grant_tenant_data(self):
        other=self.ok(self.admin,'/api/platform/tenants',{'name':'Private Org','slug':'private','email':'private@example.com','admin_name':'ผู้ดูแลส่วนตัว','password':'Test-password-123!'})['id']
        self.assertEqual(self.admin.call('/api/session/tenant',{'tenant_id':other})[0],403)
        self.assertEqual(self.admin.call('/api/tickets',headers={'X-Tenant-ID':other})[0],409)
        tenant_admin=Client(self.base);tenant_admin.login('private@example.com')
        self.assertEqual(tenant_admin.call('/api/platform/tenants')[0],403)
        self.assertEqual(self.ok(tenant_admin,'/api/tickets')['tickets'],[])

    def test_team_boundaries_and_live_revocation(self):
        other_team=self.ok(self.admin,'/api/teams',{'name':'ทีมเทคนิค'})['id']
        agent,user_id=self.create_member(other_team)
        ticket=self.ok(self.admin,'/api/tickets')['tickets'][0]
        self.assertEqual(self.ok(agent,'/api/tickets')['tickets'],[])
        self.assertEqual(self.ok(agent,'/api/contacts')['contacts'],[])
        self.assertEqual(self.ok(agent,'/api/conversations')['conversations'],[])
        self.assertEqual(agent.call('/api/tickets/'+ticket['id'])[0],404)
        self.assertEqual(agent.call('/api/settings',{},'PATCH')[0],403)
        self.assertEqual(agent.call('/api/backup')[0],403)
        self.assertEqual(agent.call('/api/audit')[0],403)
        self.assertNotIn(ticket['subject'].encode(),agent.call('/api/export/tickets.csv')[1])
        self.ok(self.admin,'/api/tickets/'+ticket['id'],{'team_id':other_team,'assignee_id':user_id},'PATCH')
        self.assertEqual(len(self.ok(agent,'/api/tickets')['tickets']),1)
        self.assertEqual(agent.call('/api/tickets/'+ticket['id'],{'team_id':self.team,'assignee_id':None},'PATCH')[0],403)
        self.ok(self.admin,'/api/members/'+user_id,{'team_id':other_team,'role':'agent','active':False},'PATCH')
        self.assertEqual(agent.call('/api/tickets')[0],403)
        self.assertIsNone(self.ok(self.admin,'/api/tickets/'+ticket['id'])['ticket']['assignee_id'])

    def test_suspension_blocks_staff_and_public_then_recovers(self):
        visitor,_=self.visitor()
        agent,_=self.create_member()
        self.ok(self.admin,'/api/platform/tenants/'+self.org,{'status':'suspended'},'PATCH')
        self.assertEqual(agent.call('/api/tickets')[0],403)
        self.assertEqual(self.admin.call('/api/tickets')[0],403)
        self.assertEqual(visitor.call('/api/public/alpha/session')[0],404)
        self.ok(self.admin,'/api/platform/tenants/'+self.org,{'status':'active'},'PATCH')
        self.assertEqual(agent.call('/api/tickets')[0],200)
        self.assertEqual(visitor.call('/api/public/alpha/session')[0],200)

    def test_csrf_origin_session_and_stale_tab(self):
        self.assertEqual(Client(self.base).call('/api/tickets')[0],401)
        self.assertEqual(self.admin.call('/api/teams',{'name':'Bad'},headers={'X-CSRF-Token':''})[0],403)
        self.assertEqual(self.admin.call('/api/teams',{'name':'Bad'},headers={'Origin':'https://evil.example'})[0],403)
        self.assertEqual(self.admin.call('/api/tickets',headers={'X-Tenant-ID':'0'*32})[0],409)
        self.assertEqual(self.admin.call('/api/setup',{})[0],409)
        self.assertEqual(self.admin.call('/api/teams',{'name':'Good'})[0],201)

    def test_public_tokens_isolate_customers_with_same_email(self):
        first,c1=self.visitor(email='same@example.com')
        second,c2=self.visitor(email='same@example.com')
        self.assertNotEqual(c1,c2)
        one=self.ok(self.admin,'/api/conversations/'+c1)
        two=self.ok(self.admin,'/api/conversations/'+c2)
        self.assertNotEqual(one['contact']['id'],two['contact']['id'])
        self.ok(first,'/api/public/alpha/messages',{'body':'CUSTOMER ONE ONLY'})
        self.assertNotIn('CUSTOMER ONE ONLY',json.dumps(self.ok(second,'/api/public/alpha/session')))
        fake=Client(self.base);fake.portal='z'*43
        self.assertEqual(fake.call('/api/public/alpha/session')[0],404)

    def test_knowledge_visibility_and_agent_permissions(self):
        public=Client(self.base)
        self.assertEqual(self.ok(public,'/api/public/alpha')['articles'],[])
        article=self.ok(self.admin,'/api/articles',{'title':'คู่มือ','category':'ทดสอบ','body':'Internal instructions','visibility':'internal'})['id']
        self.assertEqual(self.ok(public,'/api/public/alpha')['articles'],[])
        self.ok(self.admin,'/api/articles/'+article,{'title':'คู่มือ','category':'ทดสอบ','body':'Published instructions','visibility':'public'},'PATCH')
        self.assertEqual(self.ok(public,'/api/public/alpha')['articles'][0]['body'],'Published instructions')
        agent,_=self.create_member()
        self.assertEqual(agent.call('/api/articles',{'title':'Unauthorized'})[0],403)

    def test_password_change_invalidates_other_sessions(self):
        other=Client(self.base);other.login('admin@example.com')
        self.ok(self.admin,'/api/account/password',{'current_password':'Test-password-123!','password':' New-password-456! '})
        self.admin.boot()
        self.assertEqual(other.call('/api/tickets')[0],401)
        self.assertEqual(self.admin.call('/api/tickets')[0],200)
        fresh=Client(self.base)
        self.assertEqual(fresh.call('/api/login',{'email':'admin@example.com','password':'Test-password-123!'})[0],401)
        fresh.login('admin@example.com',' New-password-456! ')

    def test_validation_attachments_and_manual_channel(self):
        visitor,conversation=self.visitor()
        self.assertEqual(self.admin.call('/api/conversations/'+conversation+'/messages',{'body':'x','attachments':[{'name':'bad.html','data':base64.b64encode(b'<script>bad</script>').decode()}]})[0],400)
        self.assertEqual(self.admin.call('/api/conversations/'+conversation+'/messages',{'body':'x','attachments':[{'name':'fake.png','data':base64.b64encode(b'not png').decode()}]})[0],400)
        self.assertEqual(len(self.ok(visitor,'/api/public/alpha/session')['messages']),1)
        contact=self.ok(self.admin,'/api/contacts')['contacts'][0]
        ticket=self.ok(self.admin,'/api/tickets',{'subject':'Manual work','contact_id':contact['id'],'body':'staff record'})['id']
        data=self.ok(self.admin,'/api/tickets/'+ticket)
        conv=data['conversations'][0]['id']
        self.assertEqual(self.admin.call('/api/conversations/'+conv+'/messages',{'kind':'reply','body':'cannot deliver'})[0],400)
        self.ok(self.admin,'/api/conversations/'+conv+'/messages',{'kind':'note','body':'internal is fine'})
        self.assertEqual(self.admin.call('/api/tickets/'+ticket,{'status':'hacked'},'PATCH')[0],400)
        self.assertEqual(self.admin.call('/api/settings',{'response_hours':'nan','resolution_hours':'24','welcome':'a','canned_reply':'b'},'PATCH')[0],400)

    def test_csv_formula_escaping_and_concurrent_ticket_numbers(self):
        contact=self.ok(self.admin,'/api/contacts',{'name':'Formula customer'})['id']
        self.ok(self.admin,'/api/tickets',{'subject':'=HYPERLINK("evil")','contact_id':contact})
        csv_data=self.admin.call('/api/export/tickets.csv')[1].decode('utf-8-sig')
        self.assertIn("'=HYPERLINK",csv_data)
        def create(index):
            client=Client(self.base)
            client.opener=self.admin.opener
            client.csrf=self.admin.csrf;client.tenant=self.admin.tenant
            return client.call('/api/tickets',{'subject':f'Concurrent {index}','contact_id':contact})
        with ThreadPoolExecutor(max_workers=6) as executor:
            results=list(executor.map(create,range(6)))
        self.assertTrue(all(r[0]==201 for r in results),results)
        numbers=[t['number'] for t in self.ok(self.admin,'/api/tickets')['tickets']]
        self.assertEqual(len(numbers),len(set(numbers)))

    def test_full_backup_restore_retains_data_and_clears_sessions(self):
        visitor,conv=self.visitor()
        self.ok(visitor,'/api/public/alpha/messages',{'body':'restore this','attachments':[{'name':'restore.txt','data':base64.b64encode(b'round trip').decode()}]})
        archive=Path(self.temporary.name)/'backup.zip'
        archive.write_bytes(app.make_backup())
        restore_dir=Path(self.temporary.name)/'restored'
        env={**os.environ,'BOOKDOSE_DATA':str(restore_dir)}
        result=subprocess.run([sys.executable,str(app.ROOT/'app.py'),'--restore',str(archive)],env=env,capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        with closing(sqlite3.connect(restore_dir/'control.sqlite3')) as cd:
            self.assertEqual(cd.execute('SELECT COUNT(*) FROM sessions').fetchone()[0],0)
            self.assertEqual(cd.execute('SELECT COUNT(*) FROM tenants').fetchone()[0],1)
        with closing(sqlite3.connect(restore_dir/'tenants'/f'{self.org}.sqlite3')) as td:
            self.assertEqual(td.execute('SELECT COUNT(*) FROM tickets').fetchone()[0],5)
            key=td.execute('SELECT storage_key FROM attachments').fetchone()[0]
        self.assertEqual((restore_dir/'files'/self.org/key).read_bytes(),b'round trip')
        again=subprocess.run([sys.executable,str(app.ROOT/'app.py'),'--restore',str(archive)],env=env,capture_output=True)
        self.assertNotEqual(again.returncode,0)


if __name__=='__main__':
    unittest.main(verbosity=2)
