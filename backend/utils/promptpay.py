"""PromptPay "Thai QR Payment" text (EMVCo merchant-presented QR) for a transfer of a fixed amount to a mobile number
or a 13-digit tax / national ID. Thai banking apps read it and fill in the receiver and the amount."""
import re
from decimal import Decimal


def digits(value):
    return re.sub(r'\D','',value or '')


def target_kind(value):
    """'phone' (10 digits starting with 0), 'id' (13 digits) or None."""
    found = digits(value)
    if len(found)==10 and found.startswith('0'):
        return 'phone'
    if len(found)==13:
        return 'id'
    return None


def _tlv(tag, value):
    return f'{tag}{len(value):02d}{value}'


def crc16(text):
    """CRC-16/CCITT-FALSE, as four upper-case hex digits."""
    crc = 0xFFFF
    for byte in text.encode('ascii'):
        crc ^= byte<<8
        for _ in range(8):
            crc = ((crc<<1)^0x1021 if crc&0x8000 else crc<<1)&0xFFFF
    return f'{crc:04X}'


def payload(target, amount):
    kind,number = target_kind(target),digits(target)
    if kind is None:
        raise ValueError('พร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขประจำตัว 13 หลัก')
    account = _tlv('01','0066'+number[1:]) if kind=='phone' else _tlv('02',number)
    text = (_tlv('00','01')+_tlv('01','12')+_tlv('29',_tlv('00','A000000677010111')+account)
            +_tlv('53','764')+_tlv('54',f'{Decimal(amount):.2f}')+_tlv('58','TH')+'6304')
    return text+crc16(text)
