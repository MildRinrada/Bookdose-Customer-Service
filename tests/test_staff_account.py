"""A staff account's own settings (ตั้งค่าบัญชี, as a customer's): the devices it is signed in on - each with where it
was opened, one signed out or all the others, or every one including this browser - and the account's history, which
only the owner reads and which never holds a code or a password. Email is mocked; nothing leaves the machine."""
import json
import unittest

import test_app as base
from test_app import Client, D
from backend.middleware import rate_limit

PASSWORD = 'Test-password-123!'
SECURITY = '/api/account/security'


class StaffAccountTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    create_member = base.IntegrationTests.create_member

    def second_device(self, email, agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1'):
        rate_limit.RATES.clear()
        client = Client(self.base)
        status,answer = client.call('/api/sign-in',{'email':email,'password':PASSWORD},headers={'User-Agent':agent})
        self.assertEqual(status,200,answer)
        client.boot()
        return client

    def test_the_devices_list_names_each_browser_and_marks_this_one(self):
        agent,_ = self.create_member(email='agent@example.com')
        phone = self.second_device('agent@example.com')
        rows = self.ok(agent,SECURITY+'/sessions')['sessions']
        self.assertEqual(len(rows),2)
        self.assertEqual(sum(row['current'] for row in rows),1)
        other = next(row for row in rows if not row['current'])
        self.assertEqual(other['device'],'Safari บน iPhone')
        self.assertEqual(len(other['id']),32)
        # The session token never leaves the server.
        self.assertFalse({'token','csrf'} & set(other))
        # Signing that one out ends it there, not here; this browser's own row cannot be signed out from the list.
        current = next(row for row in rows if row['current'])
        self.assertEqual(agent.call(f"{SECURITY}/sessions/{current['id']}",method='DELETE')[0],404)
        self.assertEqual(len(self.ok(agent,f"{SECURITY}/sessions/{other['id']}",method='DELETE')['sessions']),1)
        self.assertEqual(phone.call('/api/session')[0],401)
        self.assertEqual(agent.call('/api/session')[0],200)

    def test_nobody_else_sees_or_ends_another_accounts_devices(self):
        agent,_ = self.create_member(email='agent@example.com')
        mine = self.ok(agent,SECURITY+'/sessions')['sessions'][0]['id']
        admin_rows = self.ok(self.admin,SECURITY+'/sessions')['sessions']
        self.assertNotIn(mine,[row['id'] for row in admin_rows])
        self.assertEqual(self.admin.call(f'{SECURITY}/sessions/{mine}',method='DELETE')[0],404)
        self.assertEqual(agent.call('/api/session')[0],200)
        self.assertEqual(Client(self.base).call(SECURITY+'/sessions')[0],401)
        self.assertEqual(Client(self.base).call(SECURITY+'/activity')[0],401)

    def test_signing_out_the_others_or_every_device(self):
        agent,_ = self.create_member(email='agent@example.com')
        phone = self.second_device('agent@example.com')
        self.ok(agent,SECURITY+'/sessions/sign-out-all',{'keep_current':True})
        self.assertEqual(phone.call('/api/session')[0],401)
        self.assertEqual(agent.call('/api/session')[0],200)
        phone = self.second_device('agent@example.com')
        answer = self.ok(agent,SECURITY+'/sessions/sign-out-all',{'keep_current':False})
        self.assertFalse(answer['kept_current'])
        self.assertEqual(agent.call('/api/session')[0],401)
        self.assertEqual(phone.call('/api/session')[0],401)

    def test_the_history_says_what_happened_and_from_where_never_a_secret(self):
        agent,_ = self.create_member(email='agent@example.com')
        rate_limit.RATES.clear()
        self.assertEqual(Client(self.base).call('/api/sign-in',{'email':'agent@example.com','password':'Wrong-password-99'})[0],401)
        self.ok(agent,'/api/account/profile',{'name':'ชื่อใหม่','avatar':''})
        self.ok(agent,'/api/account/password',{'current_password':PASSWORD,'password':'New-password-456!'})
        agent.boot()
        page = self.ok(agent,SECURITY+'/activity')
        actions = [item['action'] for item in page['items']]
        self.assertEqual(actions[:4],['password','profile','login_failed','login'])
        self.assertEqual(page['items'][0]['label'],'เปลี่ยนรหัสผ่าน')
        self.assertTrue(all(item['ip'] for item in page['items']))
        with D.control() as cd:
            stored = json.dumps([list(row) for row in cd.execute('SELECT * FROM staff_activity').fetchall()])
        for secret in (PASSWORD,'New-password-456!','Wrong-password-99'):
            self.assertNotIn(secret,stored)
        # Only the owner reads it; a sign-out is the last line of a session.
        self.assertNotIn('password',[item['action'] for item in self.ok(self.admin,SECURITY+'/activity')['items']])
        self.ok(agent,'/api/logout',{})
        agent.login('agent@example.com','New-password-456!')
        self.assertIn('logout',[item['action'] for item in self.ok(agent,SECURITY+'/activity')['items']])

    def test_sessions_from_before_the_upgrade_get_an_id(self):
        agent,_ = self.create_member(email='agent@example.com')
        with D.control() as cd:
            cd.execute("UPDATE sessions SET id='',ip='',user_agent=''")
        D.init()
        rows = self.ok(agent,SECURITY+'/sessions')['sessions']
        self.assertTrue(all(len(row['id'])==32 for row in rows))
        self.assertEqual(rows[0]['device'],'อุปกรณ์ที่ไม่ทราบชื่อ')


if __name__=='__main__':
    unittest.main()
