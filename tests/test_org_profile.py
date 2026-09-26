"""The organization's own name and picture. The name was set once at sign-up and after that nothing in the system
could change it, so a typo followed the organization onto every page its customers opened. What the tests hold to is
that only its owners may change it, that the picture is checked like any other picture, that both reach the places a
customer actually sees, and that a list of organizations carries whether there is a picture rather than the picture."""
import base64
import json
import struct
import unittest
import zlib

import test_app as base

PNG_MAGIC = b'\x89PNG\r\n\x1a\n'


def png(width=64, height=64):
    """The smallest valid PNG of that size, as the picture cropper would send it."""
    def chunk(kind, payload):
        body = kind+payload
        return struct.pack('>I',len(payload))+body+struct.pack('>I',zlib.crc32(body))
    header = struct.pack('>IIBBBBB',width,height,8,2,0,0,0)
    raw = b''.join(b'\x00'+b'\x00\x00\x00'*width for _ in range(height))
    data = PNG_MAGIC+chunk(b'IHDR',header)+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')
    return 'data:image/png;base64,'+base64.b64encode(data).decode()


class OrgProfileTests(unittest.TestCase):
    def profile(self, client=None, **body):
        return (client or self.admin).call('/api/settings/profile',body,'PATCH')

    def workspace(self):
        return self.ok(self.admin,'/api/workspace')['tenant']

    def with_logo(self, name='องค์กรทดสอบ'):
        self.ok(self.admin,'/api/settings/profile',{'name':name,'logo':png()},'PATCH')

    def test_the_owner_can_correct_the_name_it_signed_up_with(self):
        self.assertEqual(self.profile(name='ห้องสมุดริมน้ำ')[0],200)
        self.assertEqual(self.workspace()['name'],'ห้องสมุดริมน้ำ')

    def test_an_agent_cannot_rename_the_organization(self):
        agent,_ = self.create_member()
        self.assertEqual(self.profile(agent,name='ชื่อใหม่')[0],403)
        self.assertNotEqual(self.workspace()['name'],'ชื่อใหม่')

    def test_a_picture_is_kept_and_can_be_taken_off_again(self):
        self.assertEqual(self.profile(name=self.workspace()['name'],logo=png())[0],200)
        self.assertTrue(self.workspace()['logo'].startswith('data:image/png;base64,'))
        self.assertEqual(self.profile(name=self.workspace()['name'],logo='')[0],200)
        self.assertEqual(self.workspace()['logo'],'')

    def test_a_picture_that_is_not_a_png_is_refused(self):
        status,body = self.profile(name='องค์กรทดสอบ',logo='data:image/jpeg;base64,'+base64.b64encode(b'\xff\xd8\xff').decode())
        self.assertEqual(status,400)
        self.assertIn('PNG',body['error'])

    def test_a_picture_too_large_to_carry_inline_is_refused(self):
        self.assertEqual(self.profile(name='องค์กรทดสอบ',logo=png(900,900))[0],400)

    def test_an_empty_name_is_refused(self):
        before = self.workspace()['name']
        self.assertEqual(self.profile(name='   ')[0],400)
        self.assertEqual(self.workspace()['name'],before)

    def test_the_customers_page_shows_the_name_and_picture(self):
        self.with_logo('ห้องสมุดริมน้ำ')
        visitor,_ = self.visitor()
        org = self.ok(visitor,'/api/public/alpha')['organization']
        self.assertEqual(org['name'],'ห้องสมุดริมน้ำ')
        self.assertTrue(org['logo'].startswith('data:image/png;base64,'))

    def test_the_change_is_written_to_the_activity_log(self):
        self.with_logo('ห้องสมุดริมน้ำ')
        detail = ' '.join(e['detail'] or '' for e in self.ok(self.admin,'/api/audit')['events'])
        self.assertIn('ห้องสมุดริมน้ำ',detail)
        self.assertIn('โลโก้',detail)

    def test_another_organization_is_not_renamed_with_this_one(self):
        self.ok(self.admin,'/api/settings/profile',{'name':'ห้องสมุดริมน้ำ'},'PATCH')
        self.second_organization()          # the same account, now working in organization B
        self.assertNotEqual(self.workspace()['name'],'ห้องสมุดริมน้ำ')

    def test_a_list_says_there_is_a_picture_and_the_picture_comes_from_its_own_address(self):
        self.with_logo()
        listed = self.ok(self.owner,'/api/platform/tenants')['tenants']
        self.assertTrue(any(t['has_logo'] for t in listed))
        self.assertNotIn('data:image/png',json.dumps(listed))
        status,body = self.admin.call('/api/public/alpha/logo')
        self.assertEqual(status,200)
        self.assertTrue(body.startswith(PNG_MAGIC))

    def test_an_organization_without_a_picture_answers_404(self):
        self.assertEqual(self.admin.call('/api/public/alpha/logo')[0],404)

    def test_the_support_pages_banner_is_the_organizations_own_choice(self):
        """แบนเนอร์หน้าช่วยเหลือ: a line under the name and a colour from the set, set by the owner, shown on the public
        page (so a customer knows whom they are writing to); the default before anyone chooses."""
        visitor,_ = self.visitor()
        self.assertEqual(self.ok(visitor,'/api/public/alpha')['organization']['banner'],{'tagline':'','tone':'stone'})
        saved = self.ok(self.admin,'/api/settings/banner',{'tagline':'  ฝ่ายดูแลสมาชิก\nตอบทุกวัน  ','tone':'forest'})['support_banner']
        self.assertEqual(saved,{'tagline':'ฝ่ายดูแลสมาชิก ตอบทุกวัน','tone':'forest'})   # one line, trimmed
        self.assertEqual(self.ok(visitor,'/api/public/alpha')['organization']['banner'],saved)
        self.assertEqual(json.loads(self.ok(self.admin,'/api/workspace')['settings']['support_banner']),saved)
        detail = ' '.join(e['detail'] or '' for e in self.ok(self.admin,'/api/audit')['events'])
        self.assertIn('แบนเนอร์หน้าช่วยเหลือ (สีเขียวเข้ม · ฝ่ายดูแลสมาชิก ตอบทุกวัน)',detail)
        # Only the set's colours, a short line, and only the owner.
        for bad in ({'tagline':'','tone':'purple'},{'tagline':'','tone':'#ff00ff'},{'tagline':'ก'*81,'tone':'mint'},{'tagline':5,'tone':'mint'},{'tone':'mint','tagline':None}):
            self.assertEqual(self.admin.call('/api/settings/banner',bad)[0],400,bad)
        agent,_ = self.create_member()
        self.assertEqual(agent.call('/api/settings/banner',{'tagline':'','tone':'mint'})[0],403)
        self.assertEqual(self.ok(visitor,'/api/public/alpha')['organization']['banner'],saved)
        # Organization B keeps its own.
        self.second_organization()
        self.assertEqual(json.loads(self.ok(self.admin,'/api/workspace')['settings'].get('support_banner') or '{}').get('tone'),None)

    def test_the_members_own_list_of_organizations_says_which_have_a_picture(self):
        self.with_logo()
        joined = self.ok(self.admin,'/api/bootstrap')['memberships']
        self.assertTrue(any(m['has_logo'] for m in joined))
        self.assertNotIn('data:image/png',json.dumps(joined))


# The setUp, the sign-ins and the helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(OrgProfileTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
