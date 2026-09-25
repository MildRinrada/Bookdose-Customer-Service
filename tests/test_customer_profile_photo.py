"""รูปโปรไฟล์ of a customer account: set, kept when a save leaves it out, removed, and refused when it is not a small
PNG (the same rules as a staff member's picture)."""
import base64
import struct
import unittest
import zlib

import test_app as base


def png(width=1, height=1):
    def chunk(kind, data):
        return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    raw = b''.join(b'\x00'+b'\xff\x00\x00'*width for _ in range(height))
    body = b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')
    return 'data:image/png;base64,'+base64.b64encode(body).decode()


class CustomerProfilePhotoTests(unittest.TestCase):
    def test_set_kept_removed_and_checked(self):
        customer = self.customer()
        self.assertEqual(self.ok(customer,'/api/customer/account')['avatar'],'')
        picture = png()
        self.ok(customer,'/api/customer/profile',{'name':'ลูกค้าทดสอบ','phone':'','avatar':picture})
        self.assertEqual(self.ok(customer,'/api/customer/account')['avatar'],picture)
        # A save without the picture keeps it.
        self.ok(customer,'/api/customer/profile',{'name':'ลูกค้าคนเดิม','phone':''})
        account = self.ok(customer,'/api/customer/account')
        self.assertEqual((account['name'],account['avatar']),('ลูกค้าคนเดิม',picture))
        # Not a picture, or too large: refused, and the one there stays.
        self.assertEqual(customer.call('/api/customer/profile',{'name':'ลูกค้า','phone':'','avatar':'data:image/png;base64,AAAA'})[0],400)
        self.assertEqual(customer.call('/api/customer/profile',{'name':'ลูกค้า','phone':'','avatar':png(600,600)})[0],400)
        self.assertEqual(self.ok(customer,'/api/customer/account')['avatar'],picture)
        self.ok(customer,'/api/customer/profile',{'name':'ลูกค้า','phone':'','avatar':''})
        self.assertEqual(self.ok(customer,'/api/customer/account')['avatar'],'')


# The setUp, the sign-ins and the helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(CustomerProfilePhotoTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
