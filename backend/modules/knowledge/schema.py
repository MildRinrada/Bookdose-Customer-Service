"""Article form validation."""
from backend.modules.knowledge.model import PINS_MAX, USE_KINDS, VISIBILITIES
from backend.utils.routing import ID
from backend.utils.validation import require, field
import re

ARTICLE_ID = re.compile(ID)


def visibility(body):
    value = body.get('visibility','internal')
    require(value in VISIBILITIES,'สิทธิ์การอ่านไม่ถูกต้อง')
    return value


def article_fields(body):
    """(title, category, body)"""
    return field(body,'title',200),field(body,'category',80),field(body,'body',50000)


def use_kind(body):
    value = body.get('kind')
    require(value in USE_KINDS,'รูปแบบการใช้บทความไม่ถูกต้อง')
    return value


def vote(body):
    value = body.get('vote')
    require(type(value) is int and value in (-1,0,1),'คะแนนต้องเป็น 1 (ช่วยได้), -1 (ไม่ช่วย) หรือ 0 (ยกเลิก)')
    return value


def pins(body):
    """The article ids to pin, in order, without repeats."""
    value = body.get('ids')
    require(isinstance(value,list) and all(isinstance(i,str) and ARTICLE_ID.fullmatch(i) for i in value),'รายการบทความที่ปักหมุดไม่ถูกต้อง')
    require(len(value)==len(set(value)),'มีบทความซ้ำในรายการปักหมุด')
    require(len(value)<=PINS_MAX,f'ปักหมุดได้สูงสุด {PINS_MAX} บทความ')
    return value
