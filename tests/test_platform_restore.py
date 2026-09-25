"""กู้คืนผ่านหน้าจอ: the platform console restores a backup - chosen from its list or sent from the admin's computer -
after showing what it would replace and the file's name typed out; a backup of how things were is taken first, and
everyone signs in again afterwards."""
import base64
import os
import tempfile
import unittest
from unittest.mock import patch

import test_app as base
from test_app import Client, D
from backend.database.backup import make_backup
from backend.modules.platform import restore

RESTORE = '/api/platform/restore'


class RestoreTests(unittest.TestCase):
    ok = base.IntegrationTests.ok
    visitor = base.IntegrationTests.visitor
    customer = base.IntegrationTests.customer
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD
    tearDown = base.IntegrationTests.tearDown

    def setUp(self):
        base.IntegrationTests.setUp(self)
        self.backup_dir = tempfile.TemporaryDirectory(prefix='bookdose-backups-')
        environment = patch.dict(os.environ,{'BOOKDOSE_BACKUP_DIR':self.backup_dir.name})
        environment.start()
        self.addCleanup(environment.stop)
        self.addCleanup(self.backup_dir.cleanup)

    def cases(self, tenant_id):
        with D.tenant(tenant_id) as db:
            return db.execute('SELECT COUNT(*) FROM tickets').fetchone()[0]

    def test_preview_confirm_restore_and_undo(self):
        made = self.ok(self.owner,'/api/platform/backups',{})['files'][0]['name']
        before = self.cases(self.org)
        # After the backup: a new case in องค์กร A, and a whole new organization.
        _,conv = self.visitor('alpha','later@example.com','หลังสำรอง','เรื่องใหม่หลังสำรองข้อมูล')
        self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})
        beta = self.ok(self.owner,'/api/platform/tenants',{'name':'องค์กร B','slug':'beta','email':'orgadmin@example.com'})['id']
        # What it would do, before anything changes.
        shown = self.ok(self.owner,RESTORE+'/preview',{'name':made})
        self.assertEqual(shown['confirm'],made[:-4])
        orgs = {o['slug']:o for o in shown['organizations']}
        self.assertEqual((orgs['alpha']['change'],orgs['alpha']['cases_now'],orgs['alpha']['cases_backup']),('replace',before+1,before))
        self.assertEqual((orgs['beta']['change'],orgs['beta']['cases_backup']),('remove',None))
        self.assertEqual(shown['organizations'][0]['slug'],'beta')   # what would disappear is listed first
        self.assertEqual((shown['totals']['replace'],shown['totals']['remove'],shown['totals']['add']),(1,1,0))
        self.assertEqual(shown['platform_admins'],['admin@example.com'])
        self.assertTrue(shown['secrets']['available'])
        self.assertEqual(self.cases(self.org),before+1)   # the preview changed nothing
        # Only the platform's admins, and only with the name typed out.
        self.assertEqual(self.admin.call(RESTORE,{'name':made,'confirm':made[:-4]})[0],403)
        self.assertEqual(self.owner.call(RESTORE,{'name':made,'confirm':'bookdose'})[0],400)
        self.assertEqual(self.owner.call(RESTORE,{'name':'../control.sqlite3','confirm':'x'})[0],404)
        done = self.ok(self.owner,RESTORE,{'name':made,'confirm':made[:-4]})
        self.assertTrue(done['safety_backup'].startswith('bookdose-before-'))
        self.assertEqual(self.cases(self.org),before)
        self.assertFalse(D.tenant_path(beta).exists())
        # Everyone signs in again, with the accounts in the backup.
        self.assertEqual(self.owner.call('/api/platform/backups')[0],401)
        owner = Client(self.base)
        owner.login('admin@example.com')
        names = [t['slug'] for t in self.ok(owner,'/api/platform/tenants')['tenants']]
        self.assertEqual(names,['alpha'])
        with D.control() as cd:
            self.assertEqual(cd.execute("SELECT COUNT(*) FROM audit_logs WHERE action='platform.restored'").fetchone()[0],1)
        # A wrong file is undone with the one taken just before.
        again = self.ok(owner,RESTORE,{'name':done['safety_backup'],'confirm':done['safety_backup'][:-4]})
        self.assertTrue(again['ok'])
        self.assertEqual(self.cases(self.org),before+1)
        self.assertTrue(D.tenant_path(beta).exists())

    def test_a_file_from_the_admins_computer_in_pieces(self):
        content = make_backup()
        # Three pieces, as a big file would come.
        with patch.object(restore,'CHUNK_MAX',len(content)//3+1):
            size = restore.CHUNK_MAX
            pieces = [content[i:i+size] for i in range(0,len(content),size)]
            upload,offset = None,0
            for index,piece in enumerate(pieces):
                answer = self.ok(self.owner,RESTORE+'/upload',{'upload':upload,'offset':offset,'data':base64.b64encode(piece).decode(),
                                                             'last':index==len(pieces)-1})
                upload,offset = answer.get('upload'),offset+len(piece)
        self.assertRegex(answer['name'],r'^bookdose-upload-\d{8}-\d{6}\.zip$')
        listed = [f['name'] for f in self.ok(self.owner,'/api/platform/backups')['files']]
        self.assertIn(answer['name'],listed)
        self.assertEqual(self.ok(self.owner,RESTORE+'/preview',{'name':answer['name']})['organizations'][0]['slug'],'alpha')
        # Not a backup: refused, and nothing is kept.
        status,data = self.owner.call(RESTORE+'/upload',{'upload':None,'offset':0,'data':base64.b64encode(b'not a zip').decode(),'last':True})
        self.assertEqual(status,400,data)
        self.assertEqual(len(self.ok(self.owner,'/api/platform/backups')['files']),1)


# The setUp and helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__', 'setUp', 'tearDown')) and not hasattr(RestoreTests,_name):
        setattr(RestoreTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
