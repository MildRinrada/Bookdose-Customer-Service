"""Contact form validation."""
import re

from backend.modules.contacts.model import (CONSENTS, HOURS_MAX, LANGUAGES, PREFERRED_CHANNELS, TAG_MAX, TAGS_MAX,
                                            WARNING_MAX)
from backend.utils.validation import require, field, email_field, person_name


def contact_values(body):
    """Validated (name, email, phone, company, notes) plus (first name, last name). Accepts split or single-field names."""
    split = 'first_name' in body or 'last_name' in body
    first = person_name(body,'first_name') if split else person_name(body)
    last = person_name(body,'last_name',False) if split else ''
    name = (first+' '+last).strip()
    require(len(name)<=100,'ชื่อและนามสกุลรวมต้องไม่เกิน 100 ตัวอักษร')
    email = email_field(body) if field(body,'email',254,False) else ''
    phone = field(body,'phone',40,False)
    require(not phone or re.fullmatch(r'[0-9+() .-]{3,40}',phone),'โทรศัพท์ใช้ตัวเลข + ( ) จุด เว้นวรรค และขีด เช่น 081-234-5678')
    return (name,email,phone,field(body,'company',150,False),field(body,'notes',3000,False)),(first,last)


PROFILE_KEYS = ('preferred_channel','contact_hours','language','tags','warning','consent','deletion_requested')
CONTROL = re.compile(r'[\x00-\x1f\x7f]')


def _choice(body, name, allowed, label):
    value = body.get(name,'')
    require(value=='' or value in allowed,f'{label}ไม่ถูกต้อง')
    return value


def _line(body, name, maximum, label):
    value = field(body,name,maximum,False)
    require(not CONTROL.search(value),f'{label}ต้องเป็นข้อความบรรทัดเดียว')
    return value


def profile_values(body):
    """The care profile sent with the contact form, or None when the form sent none of it (older callers keep what
    is saved). Tags: up to TAGS_MAX distinct one-line labels; deletion_requested: true / false."""
    if not any(key in body for key in PROFILE_KEYS):
        return None
    tags = body.get('tags',[])
    require(isinstance(tags,list) and all(isinstance(t,str) for t in tags),'แท็กไม่ถูกต้อง')
    tags = list(dict.fromkeys(t.strip() for t in tags if t.strip()))
    require(len(tags)<=TAGS_MAX,f'ใส่แท็กได้สูงสุด {TAGS_MAX} แท็ก')
    require(all(len(t)<=TAG_MAX and not CONTROL.search(t) and ',' not in t for t in tags),f'แต่ละแท็กยาวไม่เกิน {TAG_MAX} ตัวอักษร และไม่มีจุลภาค')
    warning = field(body,'warning',WARNING_MAX,False)
    require(not re.search(r'[\x00-\x09\x0b-\x1f\x7f]',warning),'คำเตือนถึงทีมมีอักขระที่ใช้ไม่ได้')
    deletion = body.get('deletion_requested',False)
    require(type(deletion) is bool,'คำขอลบข้อมูลต้องเป็นใช่หรือไม่')
    return {'preferred_channel':_choice(body,'preferred_channel',PREFERRED_CHANNELS,'ช่องทางที่สะดวก'),
            'contact_hours':_line(body,'contact_hours',HOURS_MAX,'ช่วงเวลาที่สะดวก'),
            'language':_choice(body,'language',LANGUAGES,'ภาษาที่ใช้ตอบ'),
            'tags':tags,'warning':warning,
            'consent':_choice(body,'consent',CONSENTS,'การยินยอมให้ติดต่อกลับ'),
            'deletion_requested':deletion}


def merge_sources(body, target_id):
    """Ids of the contacts to merge into target_id: 1-20 distinct ids, not including the target."""
    ids = body.get('contact_ids')
    require(isinstance(ids,list) and 0<len(ids)<=20 and all(isinstance(i,str) and 0<len(i)<=32 for i in ids),'กรุณาเลือกข้อมูลลูกค้าที่จะรวม')
    require(target_id not in ids,'รายชื่อที่เก็บไว้ต้องไม่อยู่ในรายชื่อที่จะรวม')
    return list(dict.fromkeys(ids))
