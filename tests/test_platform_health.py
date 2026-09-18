"""The platform console's overview beyond the server's numbers (platform/health.py, backups.py, watch.py): the to-do
list and where each item leads, backups made on request and every day with only the last N automatic ones kept, every
organization's channels with their failures sent again from the console, how busy each organization is, security at
a glance, the announcement every organization sees, and the email to the platform admins when the server needs
someone. Providers and email are mocked; nothing leaves the machine."""
import datetime as dt
import io
import os
import tempfile
import unittest
import zipfile
from unittest.mock import patch

import test_app as base
import test_channels
from test_app import D
from backend.extensions import channel_transport as T, monitor
from backend.modules.channels import service as C
from backend.modules.platform import backups, watch
from backend.utils.dates import after

HEALTH = '/api/platform/health'


class PlatformHealthTests(unittest.TestCase):
    ok = base.IntegrationTests.ok
    visitor = base.IntegrationTests.visitor
    customer = base.IntegrationTests.customer
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD
    configure = test_channels.ChannelTests.configure
    webhook = test_channels.ChannelTests.webhook
    event = test_channels.ChannelTests.event
    incoming_line = test_channels.ChannelTests.incoming_line
    reply = test_channels.ChannelTests.reply
    job = test_channels.ChannelTests.job

    def setUp(self):
        base.IntegrationTests.setUp(self)
        # Backups go to a folder of this test only.
        self.backup_dir = tempfile.TemporaryDirectory(prefix='bookdose-backups-')
        environment = patch.dict(os.environ,{'BOOKDOSE_BACKUP_DIR':self.backup_dir.name})
        environment.start()
        self.addCleanup(environment.stop)
        self.addCleanup(self.backup_dir.cleanup)

    tearDown = base.IntegrationTests.tearDown

    def todo(self):
        return {item['key']:item for item in self.ok(self.owner,HEALTH)['todo']}

    def test_the_todo_list_says_what_is_missing_and_where_to_fix_it(self):
        items = self.todo()
        self.assertTrue({'mail','backup','two-factor','sms'}<=set(items),sorted(items))
        self.assertEqual(items['mail']['action']['href'],'/platform/settings#email')
        # Most urgent first.
        levels = [i['level'] for i in self.ok(self.owner,HEALTH)['todo']]
        self.assertEqual(levels,sorted(levels,key=['critical','warning','info'].index))
        # An organization nobody runs is the first thing to do.
        with D.control() as cd:
            cd.execute("UPDATE memberships SET active=0 WHERE tenant_id=? AND role='admin'",(self.org,))
        first = self.ok(self.owner,HEALTH)['todo'][0]
        self.assertEqual((first['key'],first['level']),(f'org-admin-{self.org}','critical'))
        self.assertEqual(first['action']['href'],f'/platform/organizations?admin={self.org}')
        # The key reminder stops once the owner says it is kept elsewhere; the mail item once email is set up.
        if 'key' in items:
            self.assertEqual(items['key']['action']['do'],'key-saved')
            self.ok(self.owner,'/api/platform/checklist/key-saved',{})
            self.assertNotIn('key',self.todo())
        self.enable_registration_mail()
        self.assertNotIn('mail',self.todo())
        # Only the platform admins see any of it.
        self.assertEqual(self.admin.call(HEALTH)[0],403)

    def test_a_backup_now_and_every_day_keeping_the_last_ones(self):
        view = self.ok(self.owner,'/api/platform/backups')
        self.assertEqual((view['files'],view['settings']['enabled']),([],False))
        made = self.ok(self.owner,'/api/platform/backups',{})
        self.assertEqual(len(made['files']),1)
        name = made['files'][0]['name']
        self.assertTrue(name.startswith('bookdose-manual-'))
        self.assertTrue(made['last']['ok'])
        self.assertNotIn('backup',self.todo())
        # The download is the archive itself, with the manifest naming the key.
        status,raw = self.owner.call(f'/api/platform/backups/{name}')
        self.assertEqual(status,200)
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            self.assertIn('manifest.json',archive.namelist())
        self.assertEqual(self.owner.call('/api/platform/backups/../control.sqlite3')[0],404)
        self.assertEqual(self.admin.call(f'/api/platform/backups/{name}')[0],403)
        # Daily: due once the hour has come, not again the same day; only `keep` automatic ones stay.
        for body in ({'enabled':True,'hour':24,'keep':3},{'enabled':'yes','hour':2,'keep':3},{'enabled':True,'hour':2,'keep':0}):
            self.assertEqual(self.owner.call('/api/platform/backups/settings',body)[0],400,body)
        self.ok(self.owner,'/api/platform/backups/settings',{'enabled':True,'hour':0,'keep':2})
        with D.control() as cd:
            self.assertTrue(backups.due(cd))
        for day in range(3):
            stamp = dt.datetime(2026,9,10+day,1,0,tzinfo=backups.THAI)
            (backups.folder()/f"bookdose-auto-{stamp.strftime('%Y%m%d-%H%M%S')}.zip").write_bytes(b'old')
        backups.auto_round()
        autos = [f['name'] for f in backups.files() if f['kind']=='auto']
        self.assertEqual(len(autos),2)
        self.assertTrue(autos[0].startswith('bookdose-auto-'+dt.datetime.now(backups.THAI).strftime('%Y%m%d')))
        self.assertIn(name,[f['name'] for f in backups.files()])          # one made by hand is never removed
        with D.control() as cd:
            self.assertFalse(backups.due(cd))

    def test_failing_channels_are_listed_with_why_and_sent_again(self):
        conv = self.incoming_line()
        mid = self.reply(conv)
        self.configure(enabled=False)
        self.assertEqual(self.job(mid)['status'],'failed')
        self.configure()
        health = self.ok(self.owner,HEALTH)
        alpha = next(o for o in health['channels'] if o['id']==self.org)
        line = next(c for c in alpha['channels'] if c['kind']=='line')
        self.assertEqual((alpha['status'],line['failed']),('error',1))
        self.assertTrue(line['last_failure'])
        self.assertIn(f'channels-{self.org}',{i['key'] for i in health['todo']})
        # Sent again from the console, still as the member who wrote it.
        answer = self.ok(self.owner,f'/api/platform/tenants/{self.org}/channels/retry',{})
        self.assertEqual((answer['retried'],answer['skipped']),(1,0))
        self.assertEqual((self.job(mid)['status'],self.job(mid)['actor_id']),('queued',self.boot['user']['id']))
        with patch.object(T,'send_line',return_value='accepted-id'):
            C.process_outbox(self.org)
        self.assertEqual(self.job(mid)['status'],'accepted')
        alpha = next(o for o in self.ok(self.owner,HEALTH)['channels'] if o['id']==self.org)
        self.assertEqual(alpha['status'],'ok')
        self.assertEqual(self.admin.call(f'/api/platform/tenants/{self.org}/channels/retry',{})[0],403)

    def test_usage_and_security_at_a_glance(self):
        visitor,conv = self.visitor()
        health = self.ok(self.owner,HEALTH)
        alpha = next(o for o in health['usage'] if o['id']==self.org)
        self.assertGreaterEqual(alpha['messages_7d'],1)
        self.assertGreaterEqual(alpha['open_cases'],1)
        self.assertEqual(alpha['members'],1)
        self.assertTrue(alpha['last_active'])
        base.rate_limit.RATES.clear()
        base.Client(self.base).call('/api/sign-in',{'email':'orgadmin@example.com','password':'Wrong-password-1'})
        self.assertGreaterEqual(self.ok(self.owner,HEALTH)['security']['failed_sign_ins'],1)

    def test_the_announcement_reaches_staff_and_customers_until_it_ends(self):
        visitor,_ = self.visitor()
        self.assertIsNone(self.ok(self.admin,'/api/bootstrap').get('announcement'))
        for body in ({'text':''},{'text':'x'*301},{'text':'ปิดปรับปรุง','level':'loud'},
                     {'text':'ปิดปรับปรุง','ends_at':'2000-01-01T00:00:00Z'},{'text':'ปิดปรับปรุง','ends_at':'พรุ่งนี้'}):
            self.assertEqual(self.owner.call('/api/platform/announcement',body)[0],400,body)
        self.ok(self.owner,'/api/platform/announcement',{'text':'ปิดปรับปรุงระบบคืนนี้ 22:00','level':'warning','audience':'staff',
                                                        'ends_at':after(hours=2)})
        shown = self.ok(self.admin,'/api/bootstrap')['announcement']
        self.assertEqual((shown['text'],shown['level']),('ปิดปรับปรุงระบบคืนนี้ 22:00','warning'))
        self.assertIsNone(self.ok(visitor,'/api/customer/account').get('announcement'))
        self.ok(self.owner,'/api/platform/announcement',{'text':'ปิดปรับปรุงระบบคืนนี้','audience':'all'})
        self.assertEqual(self.ok(visitor,'/api/customer/account')['announcement']['text'],'ปิดปรับปรุงระบบคืนนี้')
        # Not before it starts; gone once removed.
        self.ok(self.owner,'/api/platform/announcement',{'text':'ประกาศล่วงหน้า','starts_at':after(hours=3)})
        self.assertIsNone(self.ok(self.admin,'/api/bootstrap')['announcement'])
        self.ok(self.owner,'/api/platform/announcement',None,'DELETE')
        self.assertIsNone(self.ok(self.owner,'/api/platform/announcement')['announcement'])
        self.assertEqual(self.admin.call('/api/platform/announcement',{'text':'x'})[0],403)

    def test_the_platform_admins_hear_when_the_server_needs_someone(self):
        self.enable_registration_mail()
        # This test's disk is plenty; the one the tests run on may not be.
        plenty = patch.object(watch.shutil,'disk_usage',return_value=type('Disk',(),{'free':50,'total':100})())
        plenty.start()
        self.addCleanup(plenty.stop)
        # Workers of earlier tests left their last rounds in the monitor: this server has just started.
        for fresh in (patch.object(monitor,'_workers',{}),patch.object(monitor,'STARTED',monitor.time.time())):
            fresh.start()
            self.addCleanup(fresh.stop)
        admins = lambda: [c.args[2] for c in self.mailer.call_args_list if 'ต้องการการดูแล' in str(c.args[3]['Subject'])]
        with patch.object(monitor,'server_errors_since',return_value=0):
            self.assertEqual(watch.run(),[])
        with patch.object(monitor,'server_errors_since',return_value=watch.ERROR_LIMIT):
            self.assertEqual(watch.run(),['errors'])
            self.assertEqual(watch.run(),[])                  # not again while it lasts
        self.assertEqual(admins(),['admin@example.com'])
        # Once it clears it may be told again the next time.
        with patch.object(monitor,'server_errors_since',return_value=0):
            watch.run()
        with patch.object(monitor,'server_errors_since',return_value=watch.ERROR_LIMIT):
            self.assertEqual(watch.run(),['errors'])
        # A worker that has not had its first round right after a start is starting, not stopped.
        with patch.object(monitor,'STARTED',monitor.time.time()):
            self.assertTrue(all(w['running'] for w in monitor.snapshot()['workers']))

    def test_the_console_bell_has_the_todo_and_the_answers_to_support_requests(self):
        bell = lambda: {n['key']:n for n in self.ok(self.owner,'/api/platform/notifications')['items']}
        items = bell()
        # The to-do list, with the overview's own anchors made into links; advice (SMS) is listed but not counted.
        self.assertEqual(items['mail']['href'],'/platform/settings#email')
        self.assertTrue(items['mail']['notify'])
        self.assertFalse(items['sms']['notify'])
        self.assertTrue(items['backup']['href'].startswith('/platform/system#'))
        # A support request: waiting (not counted), then the organization's answer (counted, with the time it ends).
        self.enable_registration_mail()
        self.ok(self.owner,f'/api/platform/tenants/{self.org}/support-access',{'reason':'ตรวจสอบปัญหา #7','hours':4})
        waiting = next(n for n in bell().values() if n['kind']=='support')
        self.assertFalse(waiting['notify'])
        request = self.ok(self.admin,'/api/support-access')['requests'][0]['id']
        self.ok(self.admin,f'/api/support-access/{request}/approve',{'hours':4})
        answer = bell()[f'support-{request}']
        self.assertTrue(answer['notify'])
        self.assertIn('อนุมัติ',answer['title'])
        self.assertTrue(answer['until'])
        # Only the platform admins have it.
        self.assertEqual(self.admin.call('/api/platform/notifications')[0],403)


if __name__=='__main__':
    unittest.main()
