"""Security of a customer account (customer_security): two-factor sign-in with an authenticator app and recovery
codes, the second step of a sign-in, passkeys (WebAuthn) against a software authenticator that signs with P-256 in
pure Python, the signed-in devices, and the account's activity log.

The verifier is checked against published vectors first (RFC 6238 for TOTP, RFC 6979 A.2.5 for ECDSA P-256,
RFC 8017 EMSA-PKCS1-v1_5 for RSA), then the whole ceremony is played through the HTTP API. Email is mocked and
every test uses a disposable database; nothing leaves the machine."""
import base64
import hashlib
import hmac
import json
import secrets
import unittest

import test_app as base
from test_app import Client, D
from backend.middleware import rate_limit
from backend.modules.customer_security import cbor, p256, schema, totp, webauthn

PASSWORD = 'Customer-pass-123'
SECURITY = '/api/customer/security'
# RFC 6238 appendix B, the SHA-1 column: the shared secret "12345678901234567890" and the code at each time.
RFC6238_SECRET = base64.b32encode(b'12345678901234567890').decode()
RFC6238 = ((59,'287082'),(1111111109,'081804'),(1111111111,'050471'),(1234567890,'005924'),
           (2000000000,'279037'),(20000000000,'353130'))
# RFC 6979 A.2.5: the P-256 public key and the signatures over "sample" and "test" with SHA-256.
RFC6979_KEY = (0x60FED4BA255A9D31C961EB74C6356D68C049B8923B61FA6CE669622E60F29FB6,
               0x7903FE1008B8BC99A41AE9E95628BC64F2F1B20C2D7E9F5177A3C294D4462299)
RFC6979 = ((b'sample',0xEFD48B2AACB6A8FD1140DD9CD45E81D69D2C877B56AAF991C34D0EA84EAF3716,
            0xF7CB1C942D657C41D436C7A1B6E29F65F3E900DBB9AFF4064DC4AB2F843ACDA8),
           (b'test',0xF1ABB023518351CD71D881567B1EA663ED3EFCF6C5132B354F28D3B0B7D38367,
            0x019F4113742A2B14BD25926B49C649155F267E60D3814B4C0CC84250E46F0083))
# A fixed 2048-bit RSA key, made once for these tests only and used nowhere else (alg -257, Windows Hello).
RSA_N = int('bb334df121ca8d9bee407ee0ff0bdbb058638bfe40025f3435aaa596116e890df9a56589980f73267e7746365cc4b2ecfc21d65f6473'
            '6f2e842fd4b5fdbd9fc194c3dce89f8fa384271eeddf693ea1b5d996d61f45d920e2df5dba9a49301a417103c140cb3443ec004bc4b5'
            '4d898bdc45d01b2f8ed587ca17559d0c1c6a408c724ed430e148efb89f7cd81ee410bbc89d0dbd00ebbc7973d08a1aa9b176a021c393'
            '70de0285891e2807b4ad077acc7fe42668f450c7b0d80b55aab3de328edf31bc8acf1fe1e9d0f5dd7b20d2c660531749f393d34d3a87'
            'dbce9e3067f297850c29f336e2e7a8a68be4c06a95e1a258536207c8116125d0fa9954d7a34489c1',16)
RSA_D = int('17d9205bd0bf3a2d1c3c112ddeb0070bbf26e765bb87d1d317e7267328c35928739e538224e20afc636e147ec670b48ea64c35402fc'
            'ed8e2272ae4c14e9302b029a08e1b0080cf06fde8ddcaf1606e3f7979d2cb671d9327f3e6bfe7f9dcebeb5c576b1e3304f486333f73c'
            'ed912e5c3690d6af9330c16e172f9902943d171697b3aacab1f16ded1cbb81a53fc107c90e7b87fa1be28e3b83384a089c429bf05e6c'
            '604b94a81f4815c6e9a6689440aec1515e4728ffcd21dbc6d85c1305f539249f222742fa8fe42a841fb86e58fbe092be5d2d88659741'
            '3e214780ef15d9340541b9f1ebed1d522da1f6e418007161b8ab0f801004b9124142ed2e98a9cc2f1',16)
RSA_E = 65537


def b64(raw):
    return base64.urlsafe_b64encode(raw).decode().rstrip('=')


# A CBOR writer, only for building what an authenticator sends (the app itself only ever reads CBOR).
def cbor_write(value):
    def head(major, argument):
        if argument<24:
            return bytes([major<<5|argument])
        for info,size in ((24,1),(25,2),(26,4),(27,8)):
            if argument<1<<(8*size):
                return bytes([major<<5|info])+argument.to_bytes(size,'big')
        raise ValueError(argument)
    if isinstance(value,bool) or value is None:
        return bytes([0xE0|(22 if value is None else 21 if value else 20)])
    if isinstance(value,int):
        return head(0,value) if value>=0 else head(1,-1-value)
    if isinstance(value,bytes):
        return head(2,len(value))+value
    if isinstance(value,str):
        return head(3,len(value.encode()))+value.encode()
    if isinstance(value,list):
        return head(4,len(value))+b''.join(cbor_write(item) for item in value)
    if isinstance(value,dict):
        return head(5,len(value))+b''.join(cbor_write(k)+cbor_write(v) for k,v in value.items())
    raise ValueError(value)


def der(r, s):
    def integer(value):
        raw = value.to_bytes((value.bit_length()+8)//8,'big')
        return b'\x02'+bytes([len(raw)])+raw
    body = integer(r)+integer(s)
    return b'\x30'+bytes([len(body)])+body


class SoftwareAuthenticator:
    """A passkey living in this process: an ES256 (or RS256) key pair, a credential id and its own counter. It
    speaks exactly what a browser passes to the API, so the server's checks are exercised for real."""

    def __init__(self, rsa=False):
        self.rsa = rsa
        self.credential_id = secrets.token_bytes(32)
        self.sign_count = 0
        if rsa:
            self.cose = cbor_write({1:3,3:-257,-1:RSA_N.to_bytes(256,'big'),-2:RSA_E.to_bytes(3,'big')})
        else:
            self.private = secrets.randbelow(p256._N-1)+1
            point = p256._multiply(p256._G,self.private)
            self.cose = cbor_write({1:2,3:-7,-1:1,-2:point[0].to_bytes(32,'big'),-3:point[1].to_bytes(32,'big')})

    def _sign(self, message):
        if self.rsa:
            digest = hashlib.sha256(message).digest()
            block = b'\x00\x01'+b'\xff'*(256-3-len(p256.SHA256_PREFIX)-32)+b'\x00'+p256.SHA256_PREFIX+digest
            return pow(int.from_bytes(block,'big'),RSA_D,RSA_N).to_bytes(256,'big')
        digest = int.from_bytes(hashlib.sha256(message).digest(),'big')
        while True:
            k = secrets.randbelow(p256._N-1)+1
            r = p256._multiply(p256._G,k)[0]%p256._N
            s = pow(k,-1,p256._N)*(digest+r*self.private)%p256._N
            if r and s:
                return der(r,s)

    def client_data(self, kind, challenge, origin, cross_origin=False):
        return json.dumps({'type':kind,'challenge':challenge,'origin':origin,'crossOrigin':cross_origin}).encode()

    def authenticator_data(self, rp_id, flags, attested=False):
        data = hashlib.sha256(rp_id.encode()).digest()+bytes([flags])+self.sign_count.to_bytes(4,'big')
        if attested:
            data += bytes(16)+len(self.credential_id).to_bytes(2,'big')+self.credential_id+self.cose
        return data

    def create(self, options, origin, rp_id=None, flags=0x45, kind='webauthn.create', challenge=None, fmt='none'):
        """The answer of navigator.credentials.create(). Flags 0x45 = user present, user verified, attested data."""
        client = self.client_data(kind,challenge or options['challenge'],origin)
        authenticator = self.authenticator_data(rp_id or options['rp']['id'],flags,attested=True)
        attestation = cbor_write({'fmt':fmt,'attStmt':{},'authData':authenticator})
        return {'id':b64(self.credential_id),'rawId':b64(self.credential_id),'type':'public-key',
                'response':{'clientDataJSON':b64(client),'attestationObject':b64(attestation),'transports':['internal']}}

    def get(self, options, origin, rp_id=None, flags=0x05, kind='webauthn.get', challenge=None, count=None, broken=False):
        """The answer of navigator.credentials.get(). Flags 0x05 = user present and user verified."""
        self.sign_count = self.sign_count+1 if count is None else count
        client = self.client_data(kind,challenge or options['challenge'],origin)
        authenticator = self.authenticator_data(rp_id or options['rpId'],flags)
        signature = self._sign(authenticator+hashlib.sha256(client).digest())
        if broken:
            signature = signature[:-1]+bytes([signature[-1]^1])
        return {'id':b64(self.credential_id),'rawId':b64(self.credential_id),'type':'public-key',
                'response':{'clientDataJSON':b64(client),'authenticatorData':b64(authenticator),
                            'signature':b64(signature),'userHandle':b64(b'x')}}


class VerifierTests(unittest.TestCase):
    """The building blocks on their own, against published vectors."""

    def test_totp_matches_rfc_6238_and_never_repeats_a_step(self):
        for at,expected in RFC6238:
            self.assertEqual(totp.code(RFC6238_SECRET,totp.step_now(at)),expected,at)
        step = totp.step_now(1234567890)
        self.assertEqual(totp.check(RFC6238_SECRET,'005924',0,1234567890),step)
        # The step before and after are accepted, two steps away is not.
        for shift,ok in ((-30,True),(30,True),(-90,False),(90,False)):
            self.assertEqual(bool(totp.check(RFC6238_SECRET,'005924',0,1234567890+shift)),ok,shift)
        # A step already used is refused even though the code is right (replay inside the same 30 seconds).
        self.assertEqual(totp.check(RFC6238_SECRET,'005924',step,1234567890),0)
        for wrong in ('005925','',' 005924','00592','abcdef',None,'0059241'):
            self.assertEqual(totp.check(RFC6238_SECRET,wrong,0,1234567890),0,wrong)

    def test_p256_matches_rfc_6979_vectors_and_refuses_tampering(self):
        for message,r,s in RFC6979:
            self.assertTrue(p256.verify(RFC6979_KEY,message,der(r,s)))
            self.assertFalse(p256.verify(RFC6979_KEY,message+b'!',der(r,s)))
            self.assertFalse(p256.verify(RFC6979_KEY,message,der(r,s+1)))
            self.assertFalse(p256.verify(RFC6979_KEY,message,der(s,r)))
            self.assertFalse(p256.verify((RFC6979_KEY[0],RFC6979_KEY[1]+1),message,der(r,s)))
        self.assertFalse(p256.verify(RFC6979_KEY,b'sample',b''))
        self.assertFalse(p256.verify(RFC6979_KEY,b'sample',der(0,1)))
        self.assertFalse(p256.verify(RFC6979_KEY,b'sample',der(RFC6979[0][1],p256._N)))
        self.assertIsNone(p256.signature_parts(b'\x30\x06\x02\x01\x01\x02\x01'))
        self.assertFalse(p256.on_curve(*[RFC6979_KEY[0],RFC6979_KEY[1]+1]))

    def test_rsa_pkcs1_v15_follows_rfc_8017_and_refuses_a_changed_signature(self):
        message = b'authenticator data and client data hash'
        digest = hashlib.sha256(message).digest()
        block = b'\x00\x01'+b'\xff'*202+b'\x00'+bytes.fromhex('3031300d060960864801650304020105000420')+digest
        self.assertEqual(len(block),256)
        signature = pow(int.from_bytes(block,'big'),RSA_D,RSA_N).to_bytes(256,'big')
        self.assertTrue(p256.rsa_verify((RSA_N,RSA_E),message,signature))
        self.assertFalse(p256.rsa_verify((RSA_N,RSA_E),message+b'!',signature))
        self.assertFalse(p256.rsa_verify((RSA_N,RSA_E),message,signature[:-1]+bytes([signature[-1]^1])))
        self.assertFalse(p256.rsa_verify((RSA_N,RSA_E),message,signature[1:]))
        self.assertFalse(p256.rsa_verify((RSA_N,3),message,signature))

    def test_cbor_reads_what_an_authenticator_sends_and_refuses_the_rest(self):
        value = {'fmt':'none','attStmt':{},'authData':b'\x01\x02','n':-7,'list':[1,2,3],'yes':True,'null':None}
        self.assertEqual(cbor.loads(cbor_write(value)),value)
        self.assertEqual(cbor.decode(cbor_write(1)+b'tail'),(1,1))
        for bad in (b'',b'\x5f',b'\xa1\x01',b'\x42\x00',b'\xc0\x01',b'\xa2\x01\x01\x01\x02',b'\x63\xff\xff\xff'):
            with self.assertRaises(cbor.CBORError,msg=bad):
                cbor.loads(bad)
        with self.assertRaises(cbor.CBORError):
            cbor.loads(cbor_write(1)+b'\x01')
        # Nesting is bounded too: a tower of arrays is refused as malformed CBOR, never a RecursionError (which
        # would escape the handler as a 500 instead of the 400 the caller means).
        nested = 0
        for _ in range(cbor.MAX_DEPTH):
            nested = [nested]
        self.assertEqual(cbor.loads(b'\x81'*cbor.MAX_DEPTH+b'\x00'),nested)
        with self.assertRaises(cbor.CBORError):
            cbor.loads(b'\x81'*5000+b'\x00')

    def test_cose_keys_and_device_names(self):
        soft = SoftwareAuthenticator()
        self.assertEqual(webauthn.cose_key(soft.cose)[0],-7)
        self.assertEqual(webauthn.cose_key(SoftwareAuthenticator(rsa=True).cose)[1],(RSA_N,RSA_E))
        self.assertEqual(schema.device_name('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537'),'Chrome บน Windows')
        self.assertEqual(schema.device_name('Mozilla/5.0 (iPhone) Version/17 Safari/605'),'Safari บน iPhone')
        self.assertEqual(schema.device_name(''),'อุปกรณ์ที่ไม่ทราบชื่อ')


class AccountSecurityTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    customer = base.IntegrationTests.customer
    visitor = base.IntegrationTests.visitor
    create_member = base.IntegrationTests.create_member
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    CUSTOMER_PASSWORD = PASSWORD

    # Helpers
    @property
    def origin(self):
        return self.base

    def secret_of(self, client):
        return self.ok(client,SECURITY+'/totp/setup',{'password':PASSWORD})['secret']

    def enable_totp(self, client):
        """Turn two-factor sign-in on and return (secret, the ten recovery codes)."""
        secret = self.secret_of(client)
        codes = self.ok(client,SECURITY+'/totp/confirm',{'code':totp.code(secret,totp.step_now())})['recovery_codes']
        self.rewind()
        return secret,codes

    def rewind(self):
        """Let the clock move on: the step a code was last accepted for is behind us, so the next code counts.
        (Confirming or signing in uses up the step it was made for; this is how a test gets a fresh one.)"""
        with D.control() as cd:
            cd.execute('UPDATE customer_totp SET last_step=0')
            cd.commit()

    def code_now(self, secret, shift=0):
        return totp.code(secret,totp.step_now()+shift)

    def sign_in(self, email='visitor@example.com', password=PASSWORD):
        rate_limit.RATES.clear()
        client = Client(self.base)
        return client,client.call('/api/customer/login',{'email':email,'password':password})

    def add_passkey(self, client, soft=None, name='กุญแจทดสอบ', password=None):
        soft = soft or SoftwareAuthenticator()
        options = self.ok(client,SECURITY+'/passkeys/options',{'password':password or PASSWORD})
        self.ok(client,SECURITY+'/passkeys',{'name':name,'credential':soft.create(options,self.origin)})
        return soft,options

    # Two-factor sign-in
    def test_totp_setup_confirm_and_the_codes_it_refuses(self):
        client = self.customer()
        self.assertFalse(self.ok(client,SECURITY)['two_factor']['enabled'])
        setup = self.ok(client,SECURITY+'/totp/setup',{'password':PASSWORD})
        self.assertIn('otpauth://totp/',setup['otpauth_uri'])
        self.assertIn(setup['secret'],setup['otpauth_uri'])
        self.assertTrue(setup['qr'].startswith('data:image/svg+xml;base64,'))
        self.assertTrue(self.ok(client,SECURITY)['two_factor']['pending'])
        self.assertEqual(client.call(SECURITY+'/totp/confirm',{'code':'000000'})[0],403)
        self.assertEqual(client.call(SECURITY+'/totp/confirm',{'code':'nope'})[0],400)
        step = totp.step_now()
        codes = self.ok(client,SECURITY+'/totp/confirm',{'code':totp.code(setup['secret'],step)})['recovery_codes']
        self.assertEqual(len(codes),10)
        self.assertEqual(len(set(codes)),10)
        state = self.ok(client,SECURITY)
        self.assertTrue(state['two_factor']['enabled'])
        self.assertEqual(state['recovery'],{'left':10,'total':10})
        # Setting it up again is refused, and the recovery codes are never stored in the clear.
        self.assertEqual(client.call(SECURITY+'/totp/setup',{'password':PASSWORD})[0],409)
        with D.control() as cd:
            stored = json.dumps([dict(r) for r in cd.execute('SELECT * FROM customer_recovery_codes')])
            for code in codes:
                self.assertNotIn(code.replace('-',''),stored)
            self.assertEqual(cd.execute('SELECT last_step FROM customer_totp').fetchone()[0],step)

    def test_adding_a_way_into_the_account_costs_the_password_too(self):
        """A screen someone walked away from must be able to add a way in no more easily than take one away:
        starting two-factor sign-in and starting a passkey both ask for the password first. Otherwise a borrowed
        session could enrol a second factor only it holds, or leave a passkey behind that outlives a sign-out."""
        borrowed = self.customer()
        for path in (SECURITY+'/totp/setup',SECURITY+'/passkeys/options'):
            self.assertEqual(borrowed.call(path,{})[0],400,path)
            self.assertEqual(borrowed.call(path,{'password':'wrong-password'})[0],403,path)
        state = self.ok(borrowed,SECURITY)
        self.assertFalse(state['two_factor']['pending'] or state['two_factor']['enabled'])
        # No challenge was handed out, so a credential made up on the spot has nothing to answer.
        soft = SoftwareAuthenticator()
        invented = {'challenge':b64(secrets.token_bytes(32)),'rp':{'id':'127.0.0.1'}}
        self.assertEqual(borrowed.call(SECURITY+'/passkeys',{'credential':soft.create(invented,self.origin)})[0],403)
        self.assertEqual(self.ok(borrowed,SECURITY+'/passkeys')['passkeys'],[])
        # With the password both ceremonies go ahead as before (a code counts instead once two-factor is on).
        self.enable_totp(borrowed)
        self.add_passkey(borrowed)
        self.assertEqual(len(self.ok(borrowed,SECURITY+'/passkeys')['passkeys']),1)

    def test_a_password_reset_takes_the_passkeys_with_it(self):
        """The emailed reset is a clean slate: a passkey added from a borrowed screen dies with the old password,
        instead of outliving both the reset and signing out everywhere."""
        client = self.customer()
        soft,_ = self.add_passkey(client)
        rate_limit.RATES.clear()
        visitor = Client(self.base)
        self.assertEqual(visitor.call('/api/customer/forgot',{'email':'visitor@example.com'})[0],202)
        self.ok(visitor,'/api/customer/reset',{'token':self.mail_link('reset'),'password':'New-customer-pass-1'})
        visitor.customer_csrf = self.ok(visitor,'/api/customer/account')['csrf']
        self.assertEqual(self.ok(visitor,SECURITY+'/passkeys')['passkeys'],[])
        rate_limit.RATES.clear()
        thief = Client(self.base)
        options = self.ok(thief,'/api/customer/passkey/options',{})
        self.assertEqual(thief.call('/api/customer/passkey/login',{'credential':soft.get(options,self.origin)})[0],403)
        self.assertFalse(self.ok(thief,'/api/customer/account')['signed_in'])
        self.assertIn('passkeys_cleared',[item['action'] for item in self.ok(visitor,SECURITY+'/activity')['items']])

    def test_the_second_step_of_a_sign_in_uses_a_code_once_and_then_gives_up(self):
        first = self.customer()
        secret,codes = self.enable_totp(first)
        client,(status,answer) = self.sign_in()
        self.assertEqual((status,answer['two_factor']),(200,True))
        self.assertEqual(sorted(answer['methods']),['recovery','totp'])
        self.assertNotIn('signed_in',answer)
        # The waiting sign-in is a cookie the page cannot read, and it is not the session cookie.
        waiting = next(c for c in client.jar if c.name=='bookdose_2fa')
        self.assertTrue(waiting.has_nonstandard_attr('HttpOnly'))
        self.assertNotIn('bookdose_account',[c.name for c in client.jar])
        # Nothing is signed in yet.
        self.assertFalse(self.ok(client,'/api/customer/account')['signed_in'])
        self.assertEqual(client.call('/api/customer/overview')[0],401)
        self.assertEqual(client.call('/api/customer/login/verify',{'code':'000000'})[0],403)
        code = self.code_now(secret)
        self.ok(client,'/api/customer/login/verify',{'code':code})
        self.assertTrue(self.ok(client,'/api/customer/account')['signed_in'])
        # The same code cannot be used again, even on a new challenge: its step is spent.
        again,(status,_) = self.sign_in()
        self.assertEqual(status,200)
        self.assertEqual(again.call('/api/customer/login/verify',{'code':code})[0],403)
        self.rewind()
        self.assertEqual(again.call('/api/customer/login/verify',{'code':code})[0],200)
        # Five wrong tries throw the challenge away.
        worn,_ = self.sign_in()
        self.rewind()
        for _ in range(5):
            self.assertEqual(worn.call('/api/customer/login/verify',{'code':'111111'})[0],403)
        self.assertEqual(worn.call('/api/customer/login/verify',{'code':self.code_now(secret)})[0],401)
        self.assertEqual(len(codes),10)

    def test_recovery_codes_work_once_and_can_be_made_again(self):
        client = self.customer()
        secret,codes = self.enable_totp(client)
        second,_ = self.sign_in()
        self.ok(second,'/api/customer/login/verify',{'recovery_code':codes[0].lower()})
        self.assertEqual(self.ok(second,SECURITY)['recovery'],{'left':9,'total':10})
        third,_ = self.sign_in()
        self.assertEqual(third.call('/api/customer/login/verify',{'recovery_code':codes[0]})[0],403)
        self.ok(third,'/api/customer/login/verify',{'recovery_code':codes[1].replace('-','')})
        fresh = self.ok(client,SECURITY+'/recovery-codes',{'password':PASSWORD})['recovery_codes']
        self.assertEqual(len(set(fresh)&set(codes)),0)
        fourth,_ = self.sign_in()
        self.assertEqual(fourth.call('/api/customer/login/verify',{'recovery_code':codes[2]})[0],403)
        self.ok(fourth,'/api/customer/login/verify',{'recovery_code':fresh[0]})
        self.assertEqual(client.call(SECURITY+'/recovery-codes',{'password':'wrong-password'})[0],403)

    def test_turning_two_factor_off_needs_the_password_and_a_code(self):
        client = self.customer()
        secret,codes = self.enable_totp(client)
        self.assertEqual(client.call(SECURITY+'/totp/disable',{'password':PASSWORD,'code':'000000'})[0],403)
        self.assertEqual(client.call(SECURITY+'/totp/disable',{'password':'wrong-password','code':self.code_now(secret)})[0],403)
        self.ok(client,SECURITY+'/totp/disable',{'password':PASSWORD,'code':self.code_now(secret)})
        state = self.ok(client,SECURITY)
        self.assertFalse(state['two_factor']['enabled'])
        self.assertEqual(state['recovery'],{'left':0,'total':0})
        plain,(status,answer) = self.sign_in()
        self.assertEqual((status,answer.get('signed_in')),(200,True))
        self.assertTrue(self.ok(plain,'/api/customer/account')['signed_in'])

    def test_a_reset_link_on_a_two_factor_account_still_asks_for_the_code(self):
        client = self.customer()
        secret,_ = self.enable_totp(client)
        rate_limit.RATES.clear()
        visitor = Client(self.base)
        self.assertEqual(visitor.call('/api/customer/forgot',{'email':'visitor@example.com'})[0],202)
        status,answer = visitor.call('/api/customer/reset',{'token':self.mail_link('reset'),'password':'New-customer-pass-1'})
        self.assertEqual((status,answer['two_factor']),(200,True))
        # The new password is in force, and the old sessions are gone, but the link alone signs nobody in.
        self.assertEqual(visitor.call('/api/customer/overview')[0],401)
        self.assertEqual(client.call('/api/customer/overview')[0],401)
        self.ok(visitor,'/api/customer/login/verify',{'code':self.code_now(secret)})
        self.assertTrue(self.ok(visitor,'/api/customer/account')['signed_in'])
        rate_limit.RATES.clear()
        self.assertEqual(Client(self.base).call('/api/customer/login',{'email':'visitor@example.com','password':PASSWORD})[0],401)

    # Passkeys
    def test_a_passkey_registers_and_signs_in_without_a_password(self):
        client = self.customer()
        soft,options = self.add_passkey(client)
        self.assertEqual(options['authenticatorSelection'],
                         {'residentKey':'required','requireResidentKey':True,'userVerification':'required'})
        self.assertEqual([p['alg'] for p in options['pubKeyCredParams']],[-7,-257])
        listed = self.ok(client,SECURITY+'/passkeys')['passkeys']
        self.assertEqual([(p['name'],p['alg']) for p in listed],[('กุญแจทดสอบ',-7)])
        self.assertIsNone(listed[0]['last_used_at'])
        # A second registration of the same credential is refused, and the key is offered to exclude.
        again = self.ok(client,SECURITY+'/passkeys/options',{'password':PASSWORD})
        self.assertEqual([c['id'] for c in again['excludeCredentials']],[b64(soft.credential_id)])
        self.assertEqual(client.call(SECURITY+'/passkeys',{'credential':soft.create(again,self.origin)})[0],409)
        rate_limit.RATES.clear()
        visitor = Client(self.base)
        sign_in = self.ok(visitor,'/api/customer/passkey/options',{})
        self.ok(visitor,'/api/customer/passkey/login',{'credential':soft.get(sign_in,self.origin)})
        self.assertEqual(self.ok(visitor,'/api/customer/account')['email'],'visitor@example.com')
        self.assertIsNotNone(self.ok(visitor,SECURITY+'/passkeys')['passkeys'][0]['last_used_at'])

    def test_a_windows_hello_style_rsa_passkey_works_too(self):
        client = self.customer()
        soft,_ = self.add_passkey(client,SoftwareAuthenticator(rsa=True),name='Windows Hello')
        self.assertEqual(self.ok(client,SECURITY+'/passkeys')['passkeys'][0]['alg'],-257)
        rate_limit.RATES.clear()
        visitor = Client(self.base)
        options = self.ok(visitor,'/api/customer/passkey/options',{})
        self.assertEqual(visitor.call('/api/customer/passkey/login',{'credential':soft.get(options,self.origin,broken=True)})[0],403)
        rate_limit.RATES.clear()
        options = self.ok(visitor,'/api/customer/passkey/options',{})
        self.ok(visitor,'/api/customer/passkey/login',{'credential':soft.get(options,self.origin)})
        self.assertTrue(self.ok(visitor,'/api/customer/account')['signed_in'])

    def test_a_passkey_is_refused_for_the_wrong_origin_challenge_rp_or_flags(self):
        client = self.customer()
        soft = SoftwareAuthenticator()
        stale = self.ok(client,SECURITY+'/passkeys/options',{'password':PASSWORD})
        for changes in ({'origin':'https://evil.example'},{'rp_id':'evil.example'},{'flags':0x41},{'flags':0x44},
                        {'kind':'webauthn.get'},{'challenge':b64(secrets.token_bytes(32))}):
            options = self.ok(client,SECURITY+'/passkeys/options',{'password':PASSWORD})
            arguments = {'origin':self.origin,**changes}
            status,answer = client.call(SECURITY+'/passkeys',{'credential':soft.create(options,**arguments)})
            self.assertIn(status,(400,403),(changes,answer))
        self.assertEqual(self.ok(client,SECURITY+'/passkeys')['passkeys'],[])
        # A challenge answers exactly once: the very first one is long spent even though it was never wrong.
        self.ok(client,SECURITY+'/passkeys',{'credential':soft.create(stale,self.origin)})
        self.assertEqual(client.call(SECURITY+'/passkeys',{'credential':soft.create(stale,self.origin)})[0],403)
        # The same refusals on the way in.
        rate_limit.RATES.clear()
        for changes in ({'origin':'https://evil.example'},{'rp_id':'evil.example'},{'flags':0x01},
                        {'kind':'webauthn.create'},{'challenge':b64(secrets.token_bytes(32))},{'broken':True}):
            visitor = Client(self.base)
            options = self.ok(visitor,'/api/customer/passkey/options',{})
            status,answer = visitor.call('/api/customer/passkey/login',{'credential':soft.get(options,**{'origin':self.origin,**changes})})
            self.assertIn(status,(400,403),(changes,answer))
            self.assertFalse(self.ok(visitor,'/api/customer/account')['signed_in'])

    def test_a_sign_count_that_goes_backwards_is_refused_and_recorded(self):
        client = self.customer()
        soft,_ = self.add_passkey(client)
        rate_limit.RATES.clear()
        visitor = Client(self.base)
        self.ok(visitor,'/api/customer/passkey/login',
                {'credential':soft.get(self.ok(visitor,'/api/customer/passkey/options',{}),self.origin,count=7)})
        copy = Client(self.base)
        options = self.ok(copy,'/api/customer/passkey/options',{})
        status,answer = copy.call('/api/customer/passkey/login',{'credential':soft.get(options,self.origin,count=5)})
        self.assertEqual(status,403,answer)
        self.assertIn('สำเนา',answer['error'])
        self.assertFalse(self.ok(copy,'/api/customer/account')['signed_in'])
        actions = [item['action'] for item in self.ok(client,SECURITY+'/activity')['items']]
        self.assertIn('passkey_refused',actions)
        # The honest device carries on from where it was.
        rate_limit.RATES.clear()
        again = Client(self.base)
        self.ok(again,'/api/customer/passkey/login',
                {'credential':soft.get(self.ok(again,'/api/customer/passkey/options',{}),self.origin,count=8)})

    def test_renaming_and_removing_a_passkey_and_who_may(self):
        client = self.customer()
        soft,_ = self.add_passkey(client)
        passkey_id = self.ok(client,SECURITY+'/passkeys')['passkeys'][0]['id']
        self.ok(client,f'{SECURITY}/passkeys/{passkey_id}',{'name':'โน้ตบุ๊กที่ทำงาน'})
        self.assertEqual(self.ok(client,SECURITY+'/passkeys')['passkeys'][0]['name'],'โน้ตบุ๊กที่ทำงาน')
        self.assertEqual(client.call(f'{SECURITY}/passkeys/{passkey_id}',{'name':''})[0],400)
        self.assertEqual(client.call(f'{SECURITY}/passkeys/{"0"*32}',{'name':'x'})[0],404)
        # Removing needs the password (or, with two-factor on, a code).
        self.assertEqual(client.call(f'{SECURITY}/passkeys/{passkey_id}/remove',{})[0],400)
        self.assertEqual(client.call(f'{SECURITY}/passkeys/{passkey_id}/remove',{'password':'wrong-password'})[0],403)
        self.ok(client,f'{SECURITY}/passkeys/{passkey_id}/remove',{'password':PASSWORD})
        self.assertEqual(self.ok(client,SECURITY+'/passkeys')['passkeys'],[])
        rate_limit.RATES.clear()
        visitor = Client(self.base)
        options = self.ok(visitor,'/api/customer/passkey/options',{})
        self.assertEqual(visitor.call('/api/customer/passkey/login',{'credential':soft.get(options,self.origin)})[0],403)
        # Another account never sees or removes someone else's passkey.
        other = self.customer(email='other@example.com',name='ลูกค้าอีกคน')
        soft2,_ = self.add_passkey(other,SoftwareAuthenticator(),name='ของอีกคน')
        theirs = self.ok(other,SECURITY+'/passkeys')['passkeys'][0]['id']
        self.assertEqual(client.call(f'{SECURITY}/passkeys/{theirs}/remove',{'password':PASSWORD})[0],404)

    # Sessions and the activity log
    def test_signed_in_devices_are_listed_and_can_be_signed_out(self):
        client = self.customer()
        rate_limit.RATES.clear()
        second = Client(self.base)
        self.ok(second,'/api/customer/login',{'email':'visitor@example.com','password':PASSWORD})
        second.customer_csrf = self.ok(second,'/api/customer/account')['csrf']
        sessions = self.ok(client,SECURITY+'/sessions')['sessions']
        self.assertEqual(len(sessions),2)
        self.assertEqual([s['current'] for s in sessions].count(True),1)
        self.assertTrue(all(s['ip'] and s['device'] for s in sessions))
        self.assertNotIn('token_hash',json.dumps(sessions))
        other = next(s for s in sessions if not s['current'])
        self.ok(client,f"{SECURITY}/sessions/{other['id']}",None,'DELETE')
        self.assertEqual(second.call('/api/customer/overview')[0],401)
        self.assertEqual(client.call(f"{SECURITY}/sessions/{other['id']}",None,'DELETE')[0],404)
        # Sign out everywhere, keeping this browser, then everywhere at all.
        rate_limit.RATES.clear()
        third = Client(self.base)
        self.ok(third,'/api/customer/login',{'email':'visitor@example.com','password':PASSWORD})
        self.ok(client,SECURITY+'/sessions/sign-out-all',{'keep_current':True})
        self.assertEqual(third.call('/api/customer/overview')[0],401)
        self.assertEqual(len(self.ok(client,SECURITY+'/sessions')['sessions']),1)
        self.ok(client,SECURITY+'/sessions/sign-out-all',{'keep_current':False})
        self.assertEqual(client.call('/api/customer/overview')[0],401)

    def test_the_activity_log_gathers_what_happened_to_the_account(self):
        client = self.customer()
        rate_limit.RATES.clear()
        wrong = Client(self.base)
        self.assertEqual(wrong.call('/api/customer/login',{'email':'visitor@example.com','password':'not-the-password'})[0],401)
        self.assertEqual(wrong.call('/api/customer/login',{'email':'nobody@example.com','password':'not-the-password'})[0],401)
        self.ok(Client(self.base),'/api/customer/login',{'email':'visitor@example.com','password':PASSWORD})
        secret,_ = self.enable_totp(client)
        self.add_passkey(client)
        self.ok(client,'/api/customer/profile',{'name':'ลูกค้าทดสอบ','phone':'081-234-5678'})
        page = self.ok(client,SECURITY+'/activity')
        actions = [item['action'] for item in page['items']]
        for expected in ('login','login_failed','totp_on','passkey_added','profile'):
            self.assertIn(expected,actions)
        self.assertTrue(all(item['label'] for item in page['items']))
        first = page['items'][0]
        self.assertTrue(first['ip'] and first['device'])
        self.assertNotIn(secret,json.dumps(page))
        # Only this account's history, and the guess at an unknown email left nothing behind.
        with D.control() as cd:
            self.assertEqual(cd.execute("SELECT COUNT(*) FROM customer_activity WHERE account_id=''").fetchone()[0],0)
            accounts = {row[0] for row in cd.execute('SELECT DISTINCT account_id FROM customer_activity')}
        self.assertEqual(len(accounts),1)
        # ?page= is plain ASCII digits: ², ① and ٣ are digits to str.isdigit() but not to int(), and must be the
        # first page rather than a 500.
        for odd in ('%C2%B2','%E2%91%A0','%D9%A3','abc','-1','1234567'):
            self.assertEqual(self.ok(client,SECURITY+'/activity?page='+odd)['page'],0,odd)
        # Paging: the second page carries on where the first stopped.
        if page['has_more']:
            second = self.ok(client,SECURITY+'/activity?page=1')
            self.assertEqual(second['page'],1)
            self.assertNotEqual(second['items'],page['items'])

    def test_none_of_this_is_open_to_a_visitor_or_another_account(self):
        client = self.customer()
        rate_limit.RATES.clear()
        anonymous = Client(self.base)
        for path,body,method in ((SECURITY,None,None),(SECURITY+'/totp/setup',{},None),(SECURITY+'/sessions',None,None),
                                 (SECURITY+'/activity',None,None),(SECURITY+'/passkeys/options',{},None)):
            self.assertEqual(anonymous.call(path,body,method)[0],401,path)
        # A change without the session's CSRF token is refused.
        self.assertEqual(client.call(SECURITY+'/totp/setup',{},headers={'X-Customer-CSRF':''})[0],403)
        # Staff sign-in is untouched by any of this.
        self.assertEqual(self.admin.call('/api/customer/login/verify',{'code':'123456'})[0],401)
        self.assertTrue(self.ok(self.admin,'/api/workspace')['tenant']['slug'])


if __name__=='__main__':
    unittest.main(verbosity=2)
