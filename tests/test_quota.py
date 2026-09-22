"""Storage quota per organization: the ceiling is kept, raising it gives the room back, and only uploads are refused."""
import base64
import unittest

import test_app as base


def file_of(kb):
    """A real PNG header with padding behind it: the content check passes and the size is the one we asked for."""
    return {'name':'photo.png','data':base64.b64encode(b'\x89PNG\r\n\x1a\n'+b'x'*(kb*1024)).decode()}


class QuotaTests(unittest.TestCase):
    def conversation(self):
        _, conversation = self.visitor()
        return conversation

    def test_new_organization_starts_with_a_ceiling(self):
        from backend.modules.platform import model
        orgs = self.ok(self.owner,'/api/platform/health')['usage']
        self.assertTrue(orgs)
        self.assertTrue(all(o['quota_mb']==model.NEW_TENANT_QUOTA_MB for o in orgs),
                        [o['quota_mb'] for o in orgs])

    def fill_to_the_brim(self, tenant):
        """Give the organization a ceiling just above what it already takes, so under 1 MB of room is left. The
        smallest ceiling the form allows is larger than a fresh test organization, so it is written straight to the
        control database: what is being tested is the check, not how the number got there."""
        from backend.database import db as D
        used = self.ok(self.admin,'/api/workspace')['storage']['used']
        with D.control() as cd:
            cd.execute('UPDATE tenants SET quota_mb=? WHERE id=?',(used//(1024*1024)+1,tenant))
            cd.commit()

    def test_only_a_platform_admin_may_change_a_ceiling(self):
        tenant = self.ok(self.admin,'/api/workspace')['tenant']['id']
        self.assertEqual(self.admin.call(f'/api/platform/tenants/{tenant}/quota',{'quota_mb':500},'PATCH')[0],403)
        self.ok(self.owner,f'/api/platform/tenants/{tenant}/quota',{'quota_mb':500},'PATCH')
        self.assertEqual(self.ok(self.admin,'/api/workspace')['storage']['quota'],500*1024*1024)

    def test_upload_refused_when_full_but_words_still_go(self):
        tenant = self.ok(self.admin,'/api/workspace')['tenant']['id']
        conversation = self.conversation()
        self.fill_to_the_brim(tenant)
        status,answer = self.admin.call(f'/api/conversations/{conversation}/messages',
                                        {'body':'ขอส่งไฟล์','attachments':[file_of(2048)]})
        self.assertEqual(status,507,answer)
        self.assertIn('พื้นที่จัดเก็บขององค์กรเต็ม',answer['error'])
        # Nothing half-saved: the refused upload left no message behind.
        self.assertTrue(all('ขอส่งไฟล์' not in (m['body'] or '')
                            for m in self.ok(self.admin,f'/api/conversations/{conversation}')['messages']))
        # Answering the customer never stops, whatever the disk says.
        self.assertEqual(self.admin.call(f'/api/conversations/{conversation}/messages',{'body':'ตอบด้วยข้อความเปล่า'})[0],201)
        # Raising the ceiling is all it takes: the same upload goes through straight away.
        self.ok(self.owner,f'/api/platform/tenants/{tenant}/quota',{'quota_mb':500},'PATCH')
        self.assertEqual(self.admin.call(f'/api/conversations/{conversation}/messages',
                                         {'body':'ส่งอีกครั้ง','attachments':[file_of(2048)]})[0],201)

    def test_customer_upload_is_refused_the_same_way(self):
        tenant = self.ok(self.admin,'/api/workspace')['tenant']['id']
        visitor,_ = self.visitor()
        self.fill_to_the_brim(tenant)
        status,answer = visitor.call('/api/public/alpha/messages',{'body':'ส่งสลิป','attachments':[file_of(2048)]})
        self.assertEqual(status,507,answer)

    def test_console_shows_what_each_organization_takes(self):
        tenant = self.ok(self.admin,'/api/workspace')['tenant']['id']
        self.ok(self.owner,f'/api/platform/tenants/{tenant}/quota',{'quota_mb':100},'PATCH')
        org = next(o for o in self.ok(self.owner,'/api/platform/health')['usage'] if o['id']==tenant)
        self.assertEqual(org['quota_mb'],100)
        self.assertGreater(org['used_bytes'],0)
        self.assertGreater(org['share'],0)

    def test_organization_sees_how_full_it_is(self):
        tenant = self.ok(self.admin,'/api/workspace')['tenant']['id']
        self.ok(self.owner,f'/api/platform/tenants/{tenant}/quota',{'quota_mb':100},'PATCH')
        storage = self.ok(self.admin,'/api/workspace')['storage']
        self.assertEqual(storage['quota'],100*1024*1024)
        self.assertGreater(storage['used'],0)
        self.assertFalse(storage['full'])

    def test_refused_quota_values(self):
        tenant = self.ok(self.admin,'/api/workspace')['tenant']['id']
        for bad in ({'quota_mb':5},{'quota_mb':-1},{'quota_mb':'100'},{'quota_mb':None},{}):
            self.assertEqual(self.owner.call(f'/api/platform/tenants/{tenant}/quota',bad,'PATCH')[0],400,bad)
        self.ok(self.owner,f'/api/platform/tenants/{tenant}/quota',{'quota_mb':0},'PATCH')


# The setUp, the sign-ins and the helpers of the main integration test, without its tests. test_team_snippets.py
# lists the four it needs one by one; this one needs the whole chain behind visitor(), which is too long to list.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(QuotaTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
