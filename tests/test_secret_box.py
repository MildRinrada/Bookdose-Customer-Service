"""Stored secrets are sealed (utils/secret_box): channel and OpenAI tokens, the platform's SMTP password and the shared
secret of two-factor sign-in never sit on disk in plain text; a sealed value opens only with the key and in its own
place; files and rows from before encryption are sealed at start; an old key still opens values while the key changes.
Nothing leaves the machine."""
import base64
import json
import os
import secrets
import unittest
from unittest.mock import patch

import test_app as base
from test_app import D
from backend.utils import secret_box


def new_key():
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()


class SecretBoxTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    customer = base.IntegrationTests.customer
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD

    def test_a_sealed_value_opens_only_in_its_place_and_with_its_key(self):
        sealed = secret_box.seal('line-token-123','a.line.json')
        self.assertTrue(sealed.startswith('bdsec1.'))
        self.assertNotIn('line-token-123',sealed)
        self.assertNotEqual(sealed,secret_box.seal('line-token-123','a.line.json'))    # a new nonce every time
        self.assertEqual(secret_box.unseal(sealed,'a.line.json'),('line-token-123',False))
        # Copied into another organization's file: refused.
        with self.assertRaises(secret_box.SecretError):
            secret_box.unseal(sealed,'b.line.json')
        # Changed by one character: refused.
        with self.assertRaises(secret_box.SecretError):
            secret_box.unseal(sealed[:-2]+('A' if sealed[-2]!='A' else 'B')+sealed[-1],'a.line.json')
        # Another key: refused, never read as plain text.
        with patch.dict(os.environ,{'BOOKDOSE_SECRET_KEY':new_key()}):
            with self.assertRaises(secret_box.SecretError):
                secret_box.unseal(sealed,'a.line.json')
        with patch.dict(os.environ,{'BOOKDOSE_SECRET_KEY':'too-short'}):
            with self.assertRaises(secret_box.SecretError):
                secret_box.seal('x','a')

    def test_changing_the_key_keeps_old_values_readable_and_seals_them_again(self):
        old,new = new_key(),new_key()
        path = D.DATA/'secrets'/'rotate.json'
        with patch.dict(os.environ,{'BOOKDOSE_SECRET_KEY':old}):
            secret_box.write_file(path,'{"token":"abc"}')
        with patch.dict(os.environ,{'BOOKDOSE_SECRET_KEY':new}):
            # Without the old key the file does not open (and is treated as not set up).
            self.assertEqual(secret_box.read_file(path),'')
        with patch.dict(os.environ,{'BOOKDOSE_SECRET_KEY':new,'BOOKDOSE_SECRET_KEY_OLD':old}):
            self.assertEqual(secret_box.read_file(path),'{"token":"abc"}')
            self.assertEqual(path.read_text().split('.')[1],secret_box.key_id(base64.urlsafe_b64decode(new)))
        with patch.dict(os.environ,{'BOOKDOSE_SECRET_KEY':new}):
            self.assertEqual(secret_box.read_file(path),'{"token":"abc"}')

    def test_credentials_are_sealed_on_disk_and_still_work(self):
        from backend.modules.ai import repository as ai
        from backend.modules.channels import facebook, repository as channels
        channels.write_secret(self.org,'line',{'channel_secret':'s'*32,'access_token':'line-access-token-xyz'})
        facebook.write_secret(self.org,{'page_access_token':'fb-page-token-xyz','app_secret':'fb-app-secret'})
        ai.write_key(self.org,'sk-proj-plaintext-key-123')
        self.customer_mail()      # the platform's SMTP password, saved through the platform settings API
        files = {p.name:p.read_text() for p in (D.DATA/'secrets').iterdir()}
        self.assertEqual(len(files),4)
        for name,content in files.items():
            self.assertTrue(content.startswith('bdsec1.'),name)
            for plain in ('line-access-token-xyz','s'*32,'fb-page-token-xyz','fb-app-secret','sk-proj-plaintext-key-123','password'):
                self.assertNotIn(plain,content,name)
        self.assertEqual(ai.read_key(self.org),'sk-proj-plaintext-key-123')
        self.assertEqual(channels.read_secret(self.org,'line')['access_token'],'line-access-token-xyz')
        self.assertEqual(facebook.read_secret(self.org)['app_secret'],'fb-app-secret')
        # A file moved to another organization's name does not open there.
        other = 'e'*32
        (D.DATA/'secrets'/f'{self.org}.line.json').rename(D.DATA/'secrets'/f'{other}.line.json')
        (D.DATA/'tenants'/f'{other}.sqlite3').touch()
        self.assertEqual(channels.read_secret(other,'line'),{})
        # The key lives apart from the secrets folder.
        self.assertTrue((D.DATA/'keys'/'secret.key').is_file())

    def test_files_and_two_factor_secrets_from_before_encryption_are_sealed_at_start(self):
        folder = D.DATA/'secrets'
        folder.mkdir(parents=True,exist_ok=True)
        (folder/f'{self.org}.line.json').write_text(json.dumps({'channel_secret':'old-secret','access_token':'old-token'}))
        (folder/f'{self.org}.openai-key').write_text('sk-old-key')
        self.customer()
        with D.control() as cd:
            account = {'id':cd.execute("SELECT id FROM customer_accounts WHERE email='visitor@example.com'").fetchone()[0]}
            cd.execute("INSERT INTO customer_totp(account_id,secret,confirmed_at,last_step,created_at) VALUES(?,?,NULL,0,'2026-01-01')",
                       (account['id'],'JBSWY3DPEHPK3PXP'))
        D.init()
        self.assertTrue((folder/f'{self.org}.line.json').read_text().startswith('bdsec1.'))
        self.assertTrue((folder/f'{self.org}.openai-key').read_text().startswith('bdsec1.'))
        from backend.modules.ai import repository as ai
        from backend.modules.channels import repository as channels
        from backend.modules.customer_security import repository as security
        self.assertEqual(ai.read_key(self.org),'sk-old-key')
        self.assertEqual(channels.read_secret(self.org,'line')['access_token'],'old-token')
        with D.control() as cd:
            stored = cd.execute('SELECT secret FROM customer_totp WHERE account_id=?',(account['id'],)).fetchone()[0]
            self.assertTrue(stored.startswith('bdsec1.'))
            self.assertEqual(security.totp(cd,account['id'])['secret'],'JBSWY3DPEHPK3PXP')
            # Moved to another account's row, the secret does not open.
            cd.execute('UPDATE customer_totp SET account_id=? WHERE account_id=?',('f'*32,account['id']))
            with self.assertRaises(secret_box.SecretError):
                security.totp(cd,'f'*32)


if __name__=='__main__':
    unittest.main()
