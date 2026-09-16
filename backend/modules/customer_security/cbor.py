"""The part of CBOR (RFC 8949) WebAuthn needs, with the standard library alone: the attestation object and COSE
public keys. Definite lengths only - indefinite lengths, tags and floats are refused, because an authenticator never
sends them and a decoder that accepts more is a decoder that can be surprised. decode() also reports where the value
ended, which is how the bytes after a COSE key inside authenticator data are found."""

MAX_ITEMS = 1000   # A passkey's structures are tiny; anything larger is not one.
MAX_DEPTH = 8      # ...and never nested deeper than this, so nesting can never run the interpreter out of stack.


class CBORError(ValueError):
    """Malformed or unsupported CBOR."""


def _argument(data, offset):
    """(the value of the head's argument, offset after the head)."""
    if offset>=len(data):
        raise CBORError('CBOR สั้นเกินไป')
    info = data[offset]&0x1F
    offset += 1
    if info<24:
        return info,offset
    if info in (24,25,26,27):
        size = 1<<(info-24)
        if offset+size>len(data):
            raise CBORError('CBOR สั้นเกินไป')
        return int.from_bytes(data[offset:offset+size],'big'),offset+size
    raise CBORError('CBOR ไม่รองรับความยาวแบบไม่กำหนด')


def decode(data, offset=0, depth=0):
    """(value, offset after it). Maps become dicts (keys: integers or text), arrays lists, byte strings bytes.
    Containers may nest MAX_DEPTH deep: a deeper one is refused here, as CBOR that a passkey never sends, rather
    than left to run this recursion out of stack (which would be a 500, not the 400 the caller means)."""
    if offset>=len(data):
        raise CBORError('CBOR สั้นเกินไป')
    major = data[offset]>>5
    argument,offset = _argument(data,offset)
    if major==0:
        return argument,offset
    if major==1:
        return -1-argument,offset
    if major in (2,3):
        if argument>len(data)-offset:
            raise CBORError('CBOR สั้นเกินไป')
        raw = data[offset:offset+argument]
        offset += argument
        if major==2:
            return bytes(raw),offset
        try:
            return raw.decode(),offset
        except UnicodeDecodeError:
            raise CBORError('CBOR มีข้อความที่ไม่ใช่ UTF-8') from None
    if major in (4,5):
        if argument>MAX_ITEMS or depth>=MAX_DEPTH:
            raise CBORError('CBOR ใหญ่เกินไป')
        if major==4:
            items = []
            for _ in range(argument):
                value,offset = decode(data,offset,depth+1)
                items.append(value)
            return items,offset
        found = {}
        for _ in range(argument):
            key,offset = decode(data,offset,depth+1)
            value,offset = decode(data,offset,depth+1)
            if not isinstance(key,(int,str)) or key in found:
                raise CBORError('CBOR มีคีย์ซ้ำหรือชนิดที่ไม่รองรับ')
            found[key] = value
        return found,offset
    if major==7 and argument in (20,21,22):
        return (False,True,None)[argument-20],offset
    raise CBORError('CBOR ชนิดที่ไม่รองรับ')


def loads(data):
    """One CBOR value that uses the whole buffer."""
    value,offset = decode(data,0)
    if offset!=len(data):
        raise CBORError('CBOR มีข้อมูลเกินมา')
    return value
