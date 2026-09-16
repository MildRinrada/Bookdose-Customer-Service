"""WebAuthn (passkey) checks, with the standard library alone: COSE public keys, authenticator data, and what a
registration and a sign-in must prove.

Every check the specification calls for is made here and none is optional: the client data is the right ceremony
(webauthn.create / webauthn.get), carries exactly the challenge the server handed out (one-time, kept elsewhere) and
comes from this page's origin; the authenticator data hashes this rpId, has the user-present and user-verified flags
(a passkey with UV counts as both factors), and its counter never goes backwards. Attestation is not asked for and
never trusted: the statement is ignored whatever its format. Nothing here touches the database, so it can be tested
against a software authenticator."""
import base64
import hashlib
import hmac
import json
import re

from backend.modules.customer_security import cbor, p256
from backend.utils.validation import require

UP,UV,AT = 0x01,0x04,0x40   # authenticator data flags: user present, user verified, attested credential data
ES256,RS256 = -7,-257       # the COSE algorithms a browser may pick (pubKeyCredParams)
ALGORITHMS = (ES256,RS256)
MAX_CREDENTIAL = 1023       # a credential id is at most 1023 bytes (WebAuthn §5.8.3)
BAD = 'ข้อมูลจาก Passkey ไม่ถูกต้อง กรุณาลองใหม่'
B64URL = re.compile(r'[A-Za-z0-9_-]+={0,2}')


def b64url(raw):
    return base64.urlsafe_b64encode(raw).decode().rstrip('=')


def unb64url(value, message=BAD, maximum=8192):
    """The bytes of a base64url string from the browser (padding optional); 400 for anything else."""
    require(isinstance(value,str) and 0<len(value)<=maximum and B64URL.fullmatch(value),message)
    try:
        return base64.urlsafe_b64decode(value.rstrip('=')+'='*(-len(value.rstrip('='))%4))
    except (ValueError,TypeError):
        raise_bad(message)


def raise_bad(message):
    require(False,message)


def cose_key(raw):
    """(alg, key) of a COSE public key: ES256 -> the point (x, y), RS256 -> (modulus, exponent)."""
    try:
        key = cbor.loads(raw)
    except cbor.CBORError:
        raise_bad(BAD)
    require(isinstance(key,dict) and key.get(3) in ALGORITHMS,'ชนิดกุญแจของ Passkey นี้ยังไม่รองรับ')
    alg = key[3]
    if alg==ES256:
        require(key.get(1)==2 and key.get(-1)==1,'ชนิดกุญแจของ Passkey นี้ยังไม่รองรับ')
        x,y = key.get(-2),key.get(-3)
        require(isinstance(x,bytes) and isinstance(y,bytes) and len(x)==32 and len(y)==32,BAD)
        point = (int.from_bytes(x,'big'),int.from_bytes(y,'big'))
        require(p256.on_curve(*point),BAD)
        return alg,point
    require(key.get(1)==3,'ชนิดกุญแจของ Passkey นี้ยังไม่รองรับ')
    modulus,exponent = key.get(-1),key.get(-2)
    require(isinstance(modulus,bytes) and isinstance(exponent,bytes) and 128<=len(modulus)<=1024 and 1<=len(exponent)<=8,BAD)
    return alg,(int.from_bytes(modulus,'big'),int.from_bytes(exponent,'big'))


def verify_signature(raw_key, message, signature):
    """True when `signature` was made over `message` with this stored COSE key."""
    alg,key = cose_key(raw_key)
    return p256.verify(key,message,signature) if alg==ES256 else p256.rsa_verify(key,message,signature)


def _client_data(raw, kind, challenge, origin):
    """The browser's clientDataJSON: the ceremony, the server's own challenge and this page's origin."""
    try:
        data = json.loads(raw)
    except (ValueError,UnicodeDecodeError):
        raise_bad(BAD)
    require(isinstance(data,dict) and data.get('type')==kind,BAD)
    sent = data.get('challenge')
    require(isinstance(sent,str) and hmac.compare_digest(sent,challenge),'คำขอนี้หมดอายุหรือถูกใช้ไปแล้ว กรุณาลองใหม่')
    require(data.get('origin')==origin,'คำขอมาจากที่อยู่อื่น กรุณาเปิดจากหน้าเว็บของระบบโดยตรง',403)
    require(data.get('crossOrigin') is not True,'คำขอมาจากที่อยู่อื่น กรุณาเปิดจากหน้าเว็บของระบบโดยตรง',403)


def _authenticator_data(raw, rp_id):
    """(flags, sign count, what follows the fixed part) of authenticator data, with rpId and both flags checked."""
    require(len(raw)>=37,BAD)
    require(hmac.compare_digest(raw[:32],hashlib.sha256(rp_id.encode()).digest()),'Passkey นี้เป็นของเว็บไซต์อื่น',403)
    flags = raw[32]
    require(flags&UP,'อุปกรณ์ยังไม่ได้ยืนยันการใช้งาน กรุณาลองใหม่',403)
    require(flags&UV,'ต้องปลดล็อกอุปกรณ์ด้วย PIN ลายนิ้วมือ หรือใบหน้า ก่อนใช้ Passkey',403)
    return flags,int.from_bytes(raw[33:37],'big'),raw[37:]


def _response(credential, field):
    """The named part of navigator.credentials' answer, as bytes."""
    require(isinstance(credential,dict),BAD)
    answer = credential.get('response')
    require(isinstance(answer,dict),BAD)
    return unb64url(answer.get(field),BAD,1<<16)


def transports(credential):
    """['internal','hybrid',...] as the browser reported them, kept only to help the next sign-in."""
    answer = credential.get('response') if isinstance(credential,dict) else None
    found = (answer or {}).get('transports')
    if not isinstance(found,list):
        return []
    return [t for t in found if isinstance(t,str) and t.isalpha() and len(t)<=20][:8]


def claimed_challenge(credential):
    """The challenge the browser says it answered. It is a lookup key only - what the stored row then says (whose
    challenge it was, for which origin and rpId) is what every check uses, and reading it deletes the row."""
    try:
        data = json.loads(_response(credential,'clientDataJSON'))
    except (ValueError,UnicodeDecodeError):
        raise_bad(BAD)
    value = data.get('challenge') if isinstance(data,dict) else None
    require(isinstance(value,str) and 0<len(value)<=200 and B64URL.fullmatch(value),
            'คำขอนี้หมดอายุหรือถูกใช้ไปแล้ว กรุณาลองใหม่')
    return value


def verify_registration(credential, challenge, origin, rp_id):
    """A new passkey: {'credential_id','public_key' (the COSE bytes), 'alg', 'sign_count', 'transports'}.
    The attestation statement is not examined - none is asked for, so nothing about the device is believed."""
    _client_data(_response(credential,'clientDataJSON'),'webauthn.create',challenge,origin)
    try:
        attestation = cbor.loads(_response(credential,'attestationObject'))
    except cbor.CBORError:
        raise_bad(BAD)
    require(isinstance(attestation,dict) and isinstance(attestation.get('authData'),bytes),BAD)
    flags,count,rest = _authenticator_data(attestation['authData'],rp_id)
    require(flags&AT and len(rest)>=18,BAD)
    length = int.from_bytes(rest[16:18],'big')
    require(0<length<=MAX_CREDENTIAL and len(rest)>=18+length,BAD)
    credential_id,key_start = rest[18:18+length],rest[18+length:]
    try:
        _,used = cbor.decode(key_start,0)
    except cbor.CBORError:
        raise_bad(BAD)
    alg,_ = cose_key(key_start[:used])
    return {'credential_id':b64url(credential_id),'public_key':b64url(key_start[:used]),'alg':alg,
            'sign_count':count,'transports':transports(credential)}


def verify_assertion(credential, challenge, origin, rp_id, stored):
    """A sign-in with a stored passkey; returns the new sign count. `stored` is the saved row (public_key, alg,
    sign_count). A counter that does not move forward means the credential was copied: refuse."""
    client_data = _response(credential,'clientDataJSON')
    _client_data(client_data,'webauthn.get',challenge,origin)
    raw = _response(credential,'authenticatorData')
    _,count,_rest = _authenticator_data(raw,rp_id)
    signature = _response(credential,'signature')
    message = raw+hashlib.sha256(client_data).digest()
    require(verify_signature(unb64url(stored['public_key']),message,signature),'ลายเซ็นของ Passkey ไม่ถูกต้อง',403)
    # A counter of 0 on both sides means the authenticator does not count; anything else must go up.
    require(count>stored['sign_count'] or (count==0 and stored['sign_count']==0),
            'Passkey นี้ถูกปฏิเสธเพราะอาจถูกทำสำเนา กรุณาลบแล้วเพิ่มใหม่',403)
    return count
