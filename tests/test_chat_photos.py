"""รูปทีมงานในแชทของลูกค้า (portal/photos.py): a team reply carries a key to its writer's photo rather than their id,
the key opens that photo for the customer, and a member who turns it off is obeyed on every reply. Disposable
databases."""
import unittest

import test_app as base

PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
OTHER_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII='


class ChatPhotoTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    visitor = base.IntegrationTests.visitor
    customer = base.IntegrationTests.customer
    customer_mail = base.IntegrationTests.customer_mail
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    mail_link = base.IntegrationTests.mail_link
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD

    def replies(self, client):
        return [m for m in self.ok(client,'/api/public/alpha/session')['messages'] if m['kind']=='reply']

    def test_a_reply_shows_its_writers_photo_until_they_turn_it_off(self):
        client,conv = self.visitor()
        self.ok(self.admin,f'/api/conversations/{conv}/messages',{'kind':'reply','body':'สวัสดีค่ะ ทีมงานรับเรื่องแล้ว'})
        # No picture yet: nothing to show, and never the writer's id.
        reply = self.replies(client)[0]
        self.assertIsNone(reply['photo'])
        self.assertNotIn('author_id',reply)
        self.ok(self.admin,'/api/account/profile',{'name':'ผู้ดูแลทดสอบ','avatar':PNG})
        key = self.replies(client)[0]['photo']
        self.assertRegex(key,r'^[a-f0-9]{32}$')
        status,photo = client.call(f'/api/public/alpha/team/{key}/photo')
        self.assertEqual((status,photo[:4]),(200,b'\x89PNG'))
        self.assertEqual(client.call(f'/api/public/alpha/team/{"0"*32}/photo')[0],404)
        # Turned off: the reply goes back to the initials and the key opens nothing.
        self.ok(self.admin,'/api/account/preferences',{'chat_photo':False})
        self.assertIsNone(self.replies(client)[0]['photo'])
        self.assertEqual(client.call(f'/api/public/alpha/team/{key}/photo')[0],404)
        self.assertEqual(self.admin.call('/api/account/preferences',{'chat_photo':'no'})[0],400)
        # On again with a new picture: a new key, so no browser shows the old one.
        self.ok(self.admin,'/api/account/preferences',{'chat_photo':True})
        self.ok(self.admin,'/api/account/profile',{'name':'ผู้ดูแลทดสอบ','avatar':OTHER_PNG})
        self.assertNotIn(self.replies(client)[0]['photo'],(None,key))


if __name__=='__main__':
    unittest.main()
