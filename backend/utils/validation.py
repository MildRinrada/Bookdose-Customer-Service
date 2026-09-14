"""Field checks shared by every module's schema: required text, email, person name, organization code, password."""
import re
import unicodedata

from backend.exceptions.errors import APIError
from backend.utils.security import password_hash


def require(condition, message, status=400):
    if not condition:
        raise APIError(status, message)


def field(body, name, maximum=500, required=True):
    value = body.get(name, '')
    require(isinstance(value, str), f'ข้อมูล {name} ไม่ถูกต้อง')
    value = value.strip()
    require((not required or value) and len(value) <= maximum, f'กรุณาระบุ {name} (ไม่เกิน {maximum} ตัวอักษร)')
    return value


def email_field(body):
    email = field(body,'email',254).lower()
    require(re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+",email)
            and '..' not in email.split('@')[0] and not email.startswith('.') and '.@' not in email,
            'กรุณาระบุอีเมลให้ถูกต้อง เช่น name@example.com')
    return email


def person_name(body,key='name',required=True):
    value = field(body,key,100,required)
    require(not value or (any(unicodedata.category(c).startswith('L') for c in value)
            and all(unicodedata.category(c)[0] in ('L','M') or c in " .-'’·" for c in value)),
            'ชื่อใช้ตัวอักษรไทยหรือต่างประเทศ เว้นวรรค จุด ขีด และอัญประกาศได้ ไม่รองรับสัญลักษณ์หรือสคริปต์')
    return value


def slug_field(body):
    """Organization code used in support-page URLs (a-z, 0-9 and single hyphens)."""
    slug = field(body,'slug',60)
    require(re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*',slug),'รหัสองค์กรใช้ a-z, 0-9 และขีดกลาง')
    return slug


def new_password(body):
    value = body.get('password','')
    require(isinstance(value,str) and 10 <= len(value) <= 200, 'รหัสผ่านต้องมี 10-200 ตัวอักษร')
    return password_hash(value)


def existing_password(body, name='password'):
    value = body.get(name,'')
    require(isinstance(value,str) and 1<=len(value)<=200,'กรุณาระบุรหัสผ่าน')
    return value
