"""Signature checks for passkeys, with the standard library alone: ECDSA on NIST P-256 (COSE alg -7, ES256) and
RSA PKCS#1 v1.5 with SHA-256 (COSE alg -257, RS256, what Windows Hello uses). Verification only - no key is ever
made or stored here, so there is no secret to protect; every function answers True or False and never raises on a
malformed signature."""
import hashlib
import hmac

# secp256r1 (FIPS 186-4 D.1.2.3): the prime field, the curve y^2 = x^3 + ax + b, the base point and its order.
_P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff
_A = _P-3
_B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b
_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551
_G = (0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296,
      0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5)

# DigestInfo of SHA-256 (RFC 8017 §9.2), the bytes an RS256 signature wraps around the digest.
SHA256_PREFIX = bytes.fromhex('3031300d060960864801650304020105000420')


def _inverse(value):
    return pow(value,_P-2,_P)


def _add(p, q):
    """The group law in affine coordinates; None is the point at infinity."""
    if p is None:
        return q
    if q is None:
        return p
    (x1,y1),(x2,y2) = p,q
    if x1==x2:
        if (y1+y2)%_P==0:
            return None
        slope = (3*x1*x1+_A)*_inverse(2*y1)%_P
    else:
        slope = (y2-y1)*_inverse(x2-x1)%_P
    x = (slope*slope-x1-x2)%_P
    return (x,(slope*(x1-x)-y1)%_P)


def _multiply(point, scalar):
    result,addend = None,point
    while scalar>0:
        if scalar&1:
            result = _add(result,addend)
        addend = _add(addend,addend)
        scalar >>= 1
    return result


def on_curve(x, y):
    """y^2 = x^3 + ax + b over the field. P-256 has cofactor 1, so a point on the curve is already in the group."""
    return 0<=x<_P and 0<y<_P and (y*y-x*x*x-_A*x-_B)%_P==0


def signature_parts(der):
    """(r, s) of a DER SEQUENCE { INTEGER r, INTEGER s } as WebAuthn sends an ES256 signature, or None."""
    try:
        if len(der)<8 or der[0]!=0x30:
            return None
        body,offset = der[2:2+der[1]],0
        if der[1]!=len(der)-2 or der[1]>=0x80:
            return None
        parts = []
        for _ in range(2):
            if body[offset]!=0x02:
                return None
            length = body[offset+1]
            if length==0 or length>=0x80 or offset+2+length>len(body):
                return None
            value = body[offset+2:offset+2+length]
            # Minimal signed encoding: no needless leading zero byte, never negative.
            if value[0]&0x80 or (value[0]==0 and (len(value)==1 or not value[1]&0x80)):
                return None
            parts.append(int.from_bytes(value,'big'))
            offset += 2+length
        return tuple(parts) if offset==len(body) else None
    except IndexError:
        return None


def verify(public_key, message, signature):
    """ECDSA P-256 / SHA-256: public_key is (x, y), signature the DER bytes of the authenticator."""
    parts = signature_parts(signature)
    if not parts or not on_curve(*public_key):
        return False
    r,s = parts
    if not (0<r<_N and 0<s<_N):
        return False
    digest = int.from_bytes(hashlib.sha256(message).digest(),'big')
    w = pow(s,_N-2,_N)
    point = _add(_multiply(_G,digest*w%_N),_multiply(public_key,r*w%_N))
    return point is not None and point[0]%_N==r


def rsa_verify(public_key, message, signature):
    """RSA PKCS#1 v1.5 with SHA-256: public_key is (modulus, exponent). The padded block is rebuilt and compared
    whole, so no part of the encoding can be skipped."""
    modulus,exponent = public_key
    size = (modulus.bit_length()+7)//8
    padding = size-3-len(SHA256_PREFIX)-32
    if size<128 or exponent<3 or len(signature)!=size or padding<8:
        return False
    value = int.from_bytes(signature,'big')
    if value>=modulus:
        return False
    block = pow(value,exponent,modulus).to_bytes(size,'big')
    expected = b'\x00\x01'+b'\xff'*padding+b'\x00'+SHA256_PREFIX+hashlib.sha256(message).digest()
    return hmac.compare_digest(block,expected)
