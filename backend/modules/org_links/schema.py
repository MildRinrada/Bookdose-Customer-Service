"""The invite-link form, and the id and token in the URLs."""
import re

from backend.utils.dates import after
from backend.utils.validation import field, require

ID = re.compile(r'[a-f0-9]{32}')
TOKEN = re.compile(r'[A-Za-z0-9_-]{16,64}')
MAX_DAYS = 365
MAX_USES = 1000
LINK_GONE = 'ลิงก์นี้ใช้ไม่ได้แล้ว กรุณาขอลิงก์ใหม่จากองค์กร'


def link_id(value):
    require(isinstance(value,str) and ID.fullmatch(value),'ไม่พบลิงก์นี้',404)
    return value


def token(value):
    """The token in /join/<token>: a wrong shape is answered like an unknown link (it says nothing either way)."""
    require(isinstance(value,str) and TOKEN.fullmatch(value),LINK_GONE,404)
    return value


def _count(body, name, maximum, what):
    """A whole number 0-maximum (0 or nothing: no limit)."""
    value = body.get(name) or 0
    require(isinstance(value,int) and not isinstance(value,bool) and 0<=value<=maximum,f'{what}ต้องเป็นจำนวนเต็ม 0-{maximum}')
    return value


def link_form(body):
    """(label, when it expires or None, how many accounts may use it or None): days 1-365 and max_uses 1-1000,
    0 or nothing meaning no limit."""
    label = field(body,'label',60,False)
    days = _count(body,'days',MAX_DAYS,'อายุลิงก์ (วัน)')
    uses = _count(body,'max_uses',MAX_USES,'จำนวนผู้ใช้ลิงก์')
    return label,(after(days=days) if days else None),(uses or None)
