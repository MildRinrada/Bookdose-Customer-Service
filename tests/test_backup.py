"""Backups and the platform's secret key (backend/database/backup.py): a platform backup carries every credential file
sealed and names the key that opens them, never the key; an organization's own backup carries none; a restore puts the
credentials back only on a server that holds that key, and without it writes nothing unless --new-key says to go on
without them. Email and the SMS provider are mocked; nothing leaves the machine."""
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
import zipfile

import test_app as base
from test_app import D, app
from backend.extensions import sms
from backend.utils import secret_box

SMS = {'provider':'thaibulksms','sender':'BOOKDOSE','key':'tbs-key-1234567890','secret':'tbs-secret-abcdefghij'}


class BackupTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    enable_registration_mail = base.IntegrationTests.enable_registration_mail

    def credentials(self):
        self.enable_registration_mail()
        self.ok(self.admin,'/api/platform/sms',SMS)
        return app.make_backup()

    def restore(self, raw, key=True, *flags):
        """Restore `raw` into a new data folder with python app.py --restore (the key put back first when `key`)."""
        target = Path(self.temporary.name)/f'restored-{len(os.listdir(self.temporary.name))}'
        archive = Path(self.temporary.name)/f'{target.name}.zip'
        archive.write_bytes(raw)
        if key:
            (target/'keys').mkdir(parents=True)
            (target/'keys'/'secret.key').write_bytes((D.DATA/'keys'/'secret.key').read_bytes())
        env = {k:v for k,v in os.environ.items() if not k.startswith('BOOKDOSE_SECRET_KEY')}
        env['BOOKDOSE_DATA'] = str(target)
        result = subprocess.run([sys.executable,app.__file__,'--restore',str(archive),*flags],env=env,capture_output=True,
                                text=True,encoding='utf-8')
        return target,result

    def opened_in(self, folder):
        """The SMS credentials as the restored server reads them."""
        original = D.DATA
        try:
            D.DATA = folder
            return sms.read_secret().get('thaibulksms',{}).get('secret')
        finally:
            D.DATA = original

    def test_a_platform_backup_carries_the_credentials_sealed_and_names_the_key(self):
        raw = self.credentials()
        names = base.assert_sealed_backup(self,raw,SMS['key'],SMS['secret'],'Secret-smtp-password')
        self.assertTrue({'secrets/sms.json','secrets/registration-smtp.json'}<=set(names))
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            manifest = json.loads(archive.read('manifest.json'))
        self.assertEqual((manifest['secret_key_id'],manifest['secret_files']),(secret_box.current_key_id(),2))
        # The key itself goes nowhere near it.
        key = (D.DATA/'keys'/'secret.key').read_text().strip()
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            self.assertFalse(any(key.encode() in archive.read(n) for n in archive.namelist()))

    def test_an_organizations_own_backup_has_no_credentials(self):
        self.credentials()
        status,_ = self.admin.call('/api/backup')
        self.assertEqual(status,200)
        with zipfile.ZipFile(io.BytesIO(app.make_backup(self.org))) as archive:
            self.assertFalse(any(n.startswith('secrets/') for n in archive.namelist()))
            self.assertNotIn('secret_key_id',json.loads(archive.read('manifest.json')))

    def test_with_the_key_back_in_place_the_credentials_open_after_a_restore(self):
        raw = self.credentials()
        folder,result = self.restore(raw)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('2 credential files restored',result.stdout)
        self.assertEqual(self.opened_in(folder),SMS['secret'])

    def test_without_the_key_nothing_is_written_unless_told_to_go_on(self):
        raw = self.credentials()
        folder,result = self.restore(raw,key=False)
        self.assertNotEqual(result.returncode,0)
        self.assertIn(secret_box.current_key_id(),result.stderr)
        self.assertFalse((folder/'control.sqlite3').exists())
        # The key is lost for good: the data comes back, the credentials are to be entered again.
        folder,result = self.restore(raw,False,'--new-key')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('2 credential files were left out',result.stdout)
        self.assertTrue((folder/'control.sqlite3').exists())
        self.assertFalse((folder/'secrets').exists() and any((folder/'secrets').iterdir()))

    def test_a_backup_from_before_the_key_restores_as_before(self):
        # Backups made before this change name no key and carry no credentials: nothing to check, nothing to skip.
        raw = self.credentials()
        rebuilt = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(raw)) as old, zipfile.ZipFile(rebuilt,'w') as new:
            for name in old.namelist():
                if name.startswith('secrets/'):
                    continue
                content = old.read(name)
                if name=='manifest.json':
                    manifest = json.loads(content)
                    manifest.pop('secret_key_id'),manifest.pop('secret_files')
                    content = json.dumps(manifest).encode()
                new.writestr(name,content)
        _,result = self.restore(rebuilt.getvalue(),key=False)
        self.assertEqual(result.returncode,0,result.stderr)


if __name__=='__main__':
    unittest.main()
